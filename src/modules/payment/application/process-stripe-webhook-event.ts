import { changePaymentStatus } from "@/modules/payment/application/payment-status";
import type { PaymentRepository } from "@/modules/payment/repositories/payment-repository";
import type { PaymentWebhookEventRepository } from "@/modules/payment/repositories/payment-webhook-event-repository";
import type { VerifyStripeWebhookResult } from "@/modules/payment/providers/stripe-webhook";
import type { Payment, PaymentStatus } from "@/modules/payment/domain/payment";

/**
 * The one Order transition this milestone's webhook path is allowed to
 * cause — kept as narrow as the injected function itself needs to be. The
 * real implementation is `@/modules/order`'s `changeOrderStatus`; Payment
 * depends only on this shape, never on `@/modules/order` directly (mirrors
 * `initializePayment`'s injected `GetOrderById`), so Payment stays
 * ignorant of Order's own Prisma/repository internals.
 */
export type ChangeOrderStatusFn = (
  orderId: string,
  nextStatus: "PAID",
) => Promise<{ ok: true } | { ok: false; error: string }>;

export type ProcessStripeWebhookEventResult =
  | { outcome: "invalidSignature" }
  | { outcome: "ignored" }
  | { outcome: "unknownPayment" }
  | { outcome: "conflict"; payment: Payment }
  | { outcome: "applied"; payment: Payment }
  | { outcome: "alreadyAtTarget"; payment: Payment }
  /**
   * IMP-041-FIX (PR1-F01): a `payment_intent.payment_failed` event whose
   * PaymentIntent remains retryable — no transition happened at all, the
   * Payment is exactly as it was before this event, still `PENDING` and
   * still payable through its existing `providerReference`/client secret.
   */
  | { outcome: "retryableFailure"; payment: Payment }
  /**
   * IMP-041-FIX (PR1-F03): a `payment_intent.succeeded` event whose
   * settled amount/currency does NOT match the authoritative, persisted
   * Payment — refused, never applied. The Payment is untouched (still
   * whatever it was before this event).
   */
  | { outcome: "amountMismatch"; payment: Payment };

interface SettleResult {
  outcome: "applied" | "alreadyAtTarget" | "conflict";
  payment: Payment;
}

/**
 * Resolves whatever remains to be done for `payment` reaching
 * `targetStatus`, treating "already there" and "genuinely conflicting" as
 * two distinct, safe-to-acknowledge outcomes — never a corruption of an
 * existing terminal status (Step 2: "preserve terminal-state guarantees").
 *
 * This is deliberately independent of whether THIS specific event was
 * previously seen (see `process-stripe-webhook-event`'s own doc comment):
 * it always re-derives the answer from Payment's own current persisted
 * state via `changePaymentStatus`'s atomic conditional write, which is what
 * makes a retry after a prior partial failure (e.g. this exact Payment
 * transition already applied, but the subsequent Order sync did not)
 * self-healing without needing a cross-module database transaction.
 */
async function settlePaymentTransition(
  paymentRepository: PaymentRepository,
  payment: Payment,
  targetStatus: PaymentStatus,
): Promise<SettleResult> {
  if (payment.status === targetStatus) {
    return { outcome: "alreadyAtTarget", payment };
  }

  const result = await changePaymentStatus(paymentRepository, payment.id, targetStatus);
  if (result.ok) {
    return { outcome: "applied", payment: result.payment };
  }

  if (result.error === "PAYMENT_STATUS_CHANGED") {
    // Raced with a concurrent delivery (of this same event, or — in
    // principle — a different one) between our read and this write.
    // Re-fetch once to resolve against Payment's now-current state rather
    // than guessing.
    const fresh = await paymentRepository.findById(payment.id);
    if (fresh && fresh.status === targetStatus) {
      return { outcome: "alreadyAtTarget", payment: fresh };
    }
    return { outcome: "conflict", payment: fresh ?? payment };
  }

  // INVALID_STATUS_TRANSITION: `payment.status` was already a DIFFERENT
  // terminal status than `targetStatus` (not PENDING, not the target) — a
  // genuine anomaly, never forced. PAYMENT_NOT_FOUND cannot realistically
  // happen here (this Payment was just read moments earlier by the
  // caller), but is folded into the same safe "conflict, do not proceed"
  // outcome defensively rather than assumed away.
  return { outcome: "conflict", payment };
}

/**
 * Orchestrates one verified Stripe webhook delivery end to end (IMP-039):
 * resolve the internal Payment, settle its status transition, and — only
 * when the settled status is `SUCCEEDED` — synchronize the Order via the
 * existing, unmodified `changeOrderStatus` lifecycle rule. Every dependency
 * is injected (repositories, the Order-status function, and event
 * verification itself) so this function has no Prisma/Stripe SDK
 * dependency of its own — `@/modules/payment/index.ts` wires the real
 * implementations.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WHY THE DEDUP RECORD IS NOT THE CORRECTNESS GATE (transaction boundary)
 * ═══════════════════════════════════════════════════════════════════════
 * `webhookEventRepository.recordIfNew` is called for its own sake (a
 * durable, database-uniqueness-enforced audit/deduplication identity, per
 * Step 6) but its result is deliberately NOT branched on here. Payment and
 * Order are separate modules, each owning its own `PrismaClient` instance
 * (see both modules' `infrastructure/prisma-client.ts`) — there is no
 * existing abstraction that lets a single database transaction span both
 * without either leaking Prisma into an application layer or introducing a
 * new cross-module transaction primitive, and this milestone does not
 * invent one (see the Roadmap's IMP-039 entry, "Architectural Decisions",
 * for the full reasoning this comment summarizes).
 *
 * Instead, correctness comes from every step being independently safe to
 * (re)attempt from Payment's and Order's own current persisted state:
 * `settlePaymentTransition` re-derives what remains to be done from
 * Payment's row, and `changeOrderStatusFn` is Order's own already-atomic,
 * idempotent-safe conditional transition. If the Order sync step throws
 * (a genuine infrastructure failure) after the Payment transition already
 * committed, this function's exception propagates to the caller (the
 * webhook route), which must return a 5xx so Stripe retries the same
 * event — and that retry safely resumes exactly at the Order sync step,
 * because `settlePaymentTransition` will find the Payment already at its
 * target status and skip straight to it. Recording the dedup event BEFORE
 * this point (rather than after) means a plain redelivery of an
 * already-fully-processed event still short-circuits fast in the common
 * case, without weakening this retry-driven recovery path, since the
 * dedup result is never treated as proof that no work remains.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RETRYABLE FAILURES ARE A NO-OP (IMP-041-FIX, PR1-F01)
 * ═══════════════════════════════════════════════════════════════════════
 * `event.kind === "retryableFailure"` means Stripe reported one failed
 * payment ATTEMPT while the PaymentIntent itself remains open for retry
 * (see `stripe-webhook.ts`'s own doc comment). This function resolves the
 * Payment (for observability/dedup only) and returns WITHOUT ever calling
 * `settlePaymentTransition` — no write happens, the Payment stays exactly
 * as it was. This is what lets a genuinely later `payment_intent.succeeded`
 * for the same PaymentIntent still apply normally afterward.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * SETTLEMENT INTEGRITY BEFORE SUCCEEDED (IMP-041-FIX, PR1-F03)
 * ═══════════════════════════════════════════════════════════════════════
 * Before ever applying a `SUCCEEDED` transition, this function compares
 * the event's own `settledAmountMinor`/`settledCurrency` (Stripe's
 * `amount_received`/`currency` — see `stripe-webhook.ts`) against the
 * persisted, authoritative `Payment.amountMinor`/`currency`. A mismatch
 * fails closed: no Payment transition, no Order transition, logged with
 * identifiers and a mismatch category only (never a raw payload or any
 * secret). This is never retried automatically — a genuine mismatch is a
 * data anomaly a webhook retry cannot resolve, so it is acknowledged
 * (never a 5xx) exactly like the pre-existing `conflict` outcome already
 * is, to avoid an endless Stripe retry loop over something retrying can
 * never fix.
 */
export async function processStripeWebhookEvent(
  paymentRepository: PaymentRepository,
  webhookEventRepository: PaymentWebhookEventRepository,
  changeOrderStatusFn: ChangeOrderStatusFn,
  verifyEvent: (rawBody: string, signatureHeader: string) => VerifyStripeWebhookResult,
  rawBody: string,
  signatureHeader: string,
): Promise<ProcessStripeWebhookEventResult> {
  const verification = verifyEvent(rawBody, signatureHeader);
  if (!verification.ok) {
    return { outcome: "invalidSignature" };
  }

  const { event } = verification;
  if (event.kind === "ignored") {
    return { outcome: "ignored" };
  }

  const payment = await paymentRepository.findByProviderReference(event.providerReference);
  if (!payment) {
    console.warn("[payment/process-stripe-webhook-event] no Payment found for providerReference", {
      providerReference: event.providerReference,
      eventType: event.eventType,
    });
    await webhookEventRepository.recordIfNew({
      provider: "stripe",
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      paymentId: null,
    });
    return { outcome: "unknownPayment" };
  }

  await webhookEventRepository.recordIfNew({
    provider: "stripe",
    providerEventId: event.providerEventId,
    eventType: event.eventType,
    paymentId: payment.id,
  });

  if (event.kind === "retryableFailure") {
    console.warn(
      "[payment/process-stripe-webhook-event] retryable payment attempt failure — Payment remains PENDING for retry",
      { paymentId: payment.id, providerEventId: event.providerEventId },
    );
    return { outcome: "retryableFailure", payment };
  }

  if (
    event.outcome === "SUCCEEDED" &&
    (event.settledAmountMinor !== payment.amountMinor || event.settledCurrency !== payment.currency)
  ) {
    console.error(
      "[payment/process-stripe-webhook-event] settlement amount/currency mismatch — refusing to mark Payment SUCCEEDED",
      {
        paymentId: payment.id,
        providerEventId: event.providerEventId,
        mismatchType:
          event.settledAmountMinor !== payment.amountMinor &&
          event.settledCurrency !== payment.currency
            ? "amount_and_currency"
            : event.settledAmountMinor !== payment.amountMinor
              ? "amount"
              : "currency",
      },
    );
    return { outcome: "amountMismatch", payment };
  }

  const settled = await settlePaymentTransition(paymentRepository, payment, event.outcome);

  if (settled.outcome === "conflict") {
    console.warn(
      "[payment/process-stripe-webhook-event] Stripe event outcome conflicts with Payment's current terminal status",
      {
        paymentId: settled.payment.id,
        currentStatus: settled.payment.status,
        targetStatus: event.outcome,
        providerEventId: event.providerEventId,
      },
    );
    return { outcome: "conflict", payment: settled.payment };
  }

  if (event.outcome === "SUCCEEDED") {
    const orderResult = await changeOrderStatusFn(settled.payment.orderId, "PAID");
    if (!orderResult.ok) {
      // Never a hard failure: both possible errors here (`ORDER_STATUS_CHANGED`
      // and Order's own `INVALID_STATUS_TRANSITION`) indicate the Order is
      // already at a settled state — already PAID via a prior/concurrent
      // sync, or terminal in a way this webhook must never override
      // (Step 2's terminal-state guarantee extends to Order too). Logged
      // for visibility; `ORDER_NOT_FOUND` would indicate real data
      // inconsistency and is logged the same way for investigation.
      console.warn("[payment/process-stripe-webhook-event] Order synchronization did not apply", {
        orderId: settled.payment.orderId,
        paymentId: settled.payment.id,
        error: orderResult.error,
      });
    }
  }

  return { outcome: settled.outcome, payment: settled.payment };
}
