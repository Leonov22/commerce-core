import "server-only";
import type { PaymentRepository } from "@/modules/payment/repositories/payment-repository";
import type {
  PaymentProvider,
  StartPaymentInput,
} from "@/modules/payment/providers/payment-provider";
import type { Payment } from "@/modules/payment/domain/payment";

export type ProcessPaymentResult =
  | { ok: true; payment: Payment }
  | { ok: false; error: "PAYMENT_NOT_FOUND" }
  /** The Payment is already terminal (`SUCCEEDED`/`FAILED`/`CANCELLED`) — never re-sent to a provider. */
  | { ok: false; error: "PAYMENT_NOT_PENDING" }
  /**
   * The provider's `startPayment` itself reported failure
   * (`StartPaymentResult`'s `{ ok: false, error: "PROVIDER_ERROR" }`).
   * Nothing was persisted — the Payment is exactly as it was before this
   * call. Never a raw provider error, never a provider-specific code.
   */
  | { ok: false; error: "PROVIDER_ERROR" }
  /**
   * The provider call succeeded, but by the time this call tried to
   * persist the reference, `setProviderReferenceIfPending`'s conditional
   * write (`id = ? AND status = 'PENDING' AND providerReference IS NULL`)
   * no longer matched. The current Payment is returned so the caller
   * isn't left without a result; it must not be treated as this call's
   * own provider reference having been recorded.
   *
   * IMP-034-FIX: this collapses two distinct causes into one result,
   * deliberately, because today's architecture cannot actually produce
   * the second one — see `setProviderReferenceIfPending`'s own doc
   * comment for the full invariant this relies on:
   *
   *   1. A concurrently racing `processPayment()` call already attached a
   *      reference first (the expected, common case — see the
   *      "CONCURRENT processPayment() CALLS" note below).
   *   2. The Payment transitioned away from `PENDING` by some other path
   *      between this call's read and write. No such path exists yet
   *      (`updateStatusIfCurrent` has zero callers anywhere in this
   *      codebase); if one is ever introduced, revisit whether these two
   *      causes still deserve a single result code.
   */
  | { ok: false; error: "PROVIDER_REFERENCE_ALREADY_SET"; payment: Payment };

/**
 * Processes an existing Payment through a supplied, provider-neutral
 * `PaymentProvider` (IMP-034) — the use case connecting IMP-032's Payment
 * foundation to IMP-033's provider port. Both `PaymentRepository` and
 * `PaymentProvider` are injected as interfaces; this file imports neither
 * Prisma, Next.js, HTTP, nor any provider SDK, and depends on nothing
 * outside the Payment module.
 *
 * IMPORTANT SEMANTIC DECISION: a successful `startPayment()` call means
 * the provider has *started* processing the payment, not that it has
 * *succeeded*. This function therefore never transitions the Payment to
 * `SUCCEEDED` (or introduces any new intermediate status) — it only
 * attaches the opaque `providerReference` while the Payment remains
 * `PENDING`. Only a future milestone, once a provider genuinely reports a
 * final result (e.g. via a webhook), is responsible for the actual status
 * transition — through `PaymentRepository.updateStatusIfCurrent`, already
 * established by IMP-032 and completely unmodified here.
 *
 * Never exposed to a customer-facing transport in this milestone: no
 * route calls this. A future payment-provider milestone supplies the
 * first concrete `PaymentProvider` and decides how this gets invoked.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CONCURRENT processPayment() CALLS (IMP-034-FIX / CR-034-01)
 * ═══════════════════════════════════════════════════════════════════════
 * Two concurrent `processPayment(paymentId)` calls for the same Payment
 * CAN both reach `paymentProvider.startPayment(...)` — this function
 * deliberately does not add an application-level mutex/lock to prevent
 * that (see the architectural rule against unnecessary infrastructure).
 * This is safe only because both calls send the identical `paymentId` in
 * their `StartPaymentInput`, and `PaymentProvider`'s contract (see
 * `payment-provider.ts`) requires a compliant implementation to treat
 * repeated calls with the same `paymentId` as the SAME logical external
 * operation, never a second one. `setProviderReferenceIfPending`'s atomic
 * conditional write is what then guarantees only ONE of the two calls
 * actually *persists* a reference locally — the other observes `count: 0`
 * and returns `PROVIDER_REFERENCE_ALREADY_SET`. Two different guarantees,
 * from two different layers, are both required: PostgreSQL cannot make
 * the external call atomic, and the provider contract alone cannot
 * prevent a duplicate *local* write racing itself.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * PROVIDER SUCCESS + LOCAL PERSISTENCE FAILURE (IMP-034-FIX / CR-034-02)
 * ═══════════════════════════════════════════════════════════════════════
 * If `paymentProvider.startPayment(...)` succeeds but the following
 * `setProviderReferenceIfPending` call then throws (a transient database
 * error, a crash before it runs, etc.), this function does not attempt
 * any provider-specific recovery — it simply propagates the failure. The
 * recovery invariant lives entirely in the provider contract: a *later*
 * `processPayment(paymentId)` call resolves the same Payment and sends
 * the provider the identical `paymentId` again, so a compliant provider
 * returns the SAME `providerReference` it already created rather than
 * starting a second external operation — the local write then simply
 * succeeds on that later attempt. No provider-specific retry/recovery API
 * is introduced here; this is a property the contract requires of every
 * future adapter, not something this function orchestrates itself.
 */
export async function processPayment(
  paymentRepository: PaymentRepository,
  paymentProvider: PaymentProvider,
  paymentId: string,
): Promise<ProcessPaymentResult> {
  const payment = await paymentRepository.findById(paymentId);
  if (!payment) {
    return { ok: false, error: "PAYMENT_NOT_FOUND" };
  }

  // Terminal Payments are never re-sent to a provider — matches the
  // domain lifecycle (`isValidPaymentStatusTransition`): PENDING is the
  // only status with any outgoing transition at all.
  if (payment.status !== "PENDING") {
    return { ok: false, error: "PAYMENT_NOT_PENDING" };
  }

  // The provider receives exclusively the persisted Payment's own
  // authoritative values — this function accepts no amount/currency/
  // status/providerReference/user-data parameter at all, so there is no
  // input a caller could even attempt to override them with, and no
  // Order recalculation, Catalog, or Checkout involvement of any kind.
  const input: StartPaymentInput = {
    paymentId: payment.id,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
  };

  const result = await paymentProvider.startPayment(input);

  if (!result.ok) {
    // Preserve Payment state exactly as-is — no repository write at all.
    return { ok: false, error: "PROVIDER_ERROR" };
  }

  // The provider result contributes exactly one persisted value: the
  // opaque `providerReference`. It can never replace `amountMinor` or
  // `currency` — `StartPaymentResult`'s success case has no such fields.
  const updated = await paymentRepository.setProviderReferenceIfPending(
    payment.id,
    result.providerReference,
  );

  if (!updated) {
    // Lost the race (or the Payment changed state some other way) — the
    // row this call itself just read is stale; re-fetch rather than
    // fabricate a result from it. The row cannot have been deleted
    // between these two calls (Payments are never deleted), so this is
    // always non-null in practice.
    const current = await paymentRepository.findById(payment.id);
    return { ok: false, error: "PROVIDER_REFERENCE_ALREADY_SET", payment: current! };
  }

  return { ok: true, payment: updated };
}
