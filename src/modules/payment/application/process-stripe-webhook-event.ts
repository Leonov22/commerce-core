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
  | { outcome: "alreadyAtTarget"; payment: Payment };

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
