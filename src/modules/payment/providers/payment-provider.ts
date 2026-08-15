/**
 * PaymentProvider port (IMP-033, contract strengthened by IMP-034-FIX /
 * CR-034-01, CR-034-02). The outbound abstraction a future external
 * payment provider (Stripe, PayPal, or otherwise) will implement —
 * analogous to `PaymentRepository`, but for talking to an external
 * payment gateway instead of persisting to Postgres. Framework independent
 * and provider independent: no Prisma, no Next.js, no provider SDK, no
 * HTTP client, no import of any kind — this file has zero dependencies,
 * including on Payment's own domain module, so it cannot accidentally pick
 * up a provider-specific concept by association.
 *
 * IMP-033 defines the port only. No concrete implementation (Stripe,
 * PayPal, or otherwise) exists yet, nothing in the application layer
 * depends on this interface, and no infrastructure adapter is created —
 * exactly like `changeOrderStatus`'s atomic transition primitive (IMP-030)
 * and `PaymentRepository.updateStatusIfCurrent` (IMP-032) were established
 * ahead of their first real caller. A future milestone supplies the first
 * adapter and wires it into `initializePayment` or a successor.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * PROVIDER-SIDE IDEMPOTENCY INVARIANT (IMP-034-FIX)
 * ═══════════════════════════════════════════════════════════════════════
 * `StartPaymentInput.paymentId` is the stable idempotency identity for
 * the *logical* provider-start operation it represents. A compliant
 * `PaymentProvider` implementation MUST treat every `startPayment` call
 * carrying the same `paymentId` as a request to observe or continue the
 * SAME external operation, never to create a second one — regardless of
 * why the call is repeated:
 *
 *   - two `processPayment()` calls raced each other at the application
 *     layer (CR-034-01) — Postgres alone cannot prevent this, since it
 *     only guarantees one *persisted* `providerReference`, not one
 *     external side effect; the provider itself must be safe to invoke
 *     twice for the same `paymentId`;
 *   - `startPayment` succeeded but the subsequent local
 *     `setProviderReferenceIfPending` write failed or the process crashed
 *     before it ran (CR-034-02) — a later retry calling `startPayment`
 *     again with the identical `paymentId` must receive back the SAME
 *     `providerReference` the first call already created, not a new one.
 *
 * This is why `StartPaymentInput` has no separate idempotency-key field:
 * `paymentId` already is that key, and there is deliberately no way for
 * a caller to supply a different one for the same Payment — removing the
 * entire class of bug where a retry accidentally varies its idempotency
 * key. PostgreSQL's role is narrower and complementary: it guarantees
 * that only ONE `providerReference` is ever persisted locally
 * (`PaymentRepository.setProviderReferenceIfPending`); it makes no claim
 * about, and cannot make atomic, what happens on the provider's side.
 * The two guarantees together — provider-side idempotency by `paymentId`,
 * local uniqueness by database constraint — are what make it safe for two
 * concurrent `processPayment()` calls to both reach this port.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * SAFETY OVER LIVENESS BEYOND NATIVE RETENTION (IMP-035-FIX-2)
 * ═══════════════════════════════════════════════════════════════════════
 * A REAL provider's own native idempotency mechanism (e.g. Stripe's
 * `Idempotency-Key`) is not permanent — it may stop being honored after
 * some provider-specific retention window, after which a naive retry
 * could create a genuinely second external operation. `StartPaymentInput.providerStartAttemptedAt`
 * exists so an implementation can tell how long ago a start was FIRST
 * durably attempted for this `paymentId`, and decide for itself — using
 * ITS OWN provider's specific retention guarantee, which this
 * provider-neutral port has no opinion on — whether it may still trust its
 * native idempotency mechanism alone, or whether it must instead positively
 * RECONCILE against the provider's own records before creating anything.
 *
 * The overriding rule for every implementation: if it cannot PROVE that
 * starting a new external operation is safe, it MUST NOT start one — a
 * caller receiving `{ ok: false, error: "PROVIDER_ERROR" }` because the
 * implementation couldn't safely determine whether an operation already
 * exists is the CORRECT, intended outcome, not a bug to route around.
 * Silently creating a second external operation because a reconciliation
 * check merely came back empty is never acceptable — reconciliation
 * mechanisms are frequently eventually consistent (a real provider's own
 * search/list API may not yet reflect a very recent write), and an empty
 * result does not prove a negative.
 */

/**
 * What a provider needs to start processing a payment — derived from the
 * authoritative, already-persisted `Payment` record, never from client
 * input. `paymentId` is this system's own internal Payment id (never a
 * provider-issued identifier) and doubles as the provider-side idempotency
 * identity described above — included so a future caller can correlate
 * the provider's response back to the right `Payment` row, and so a
 * compliant provider can recognize a repeated call as the same logical
 * operation.
 *
 * Deliberately minimal: no customer PII, no return/redirect URLs, no
 * payment-method details, and — deliberately — no separate idempotency
 * key. Inventing a second identifier alongside `paymentId` would only
 * create a way for two calls about the same Payment to accidentally use
 * different keys; `paymentId` alone is both simpler and strictly safer.
 */
export interface StartPaymentInput {
  paymentId: string;
  amountMinor: number;
  currency: string;
  /**
   * When a provider-start was first durably attempted for this Payment
   * (IMP-035-FIX-2) — always a real, already-persisted timestamp by the
   * time a `PaymentProvider` sees it, since `processPayment` always claims
   * it (`PaymentRepository.claimProviderStartAttempt`) before ever calling
   * this port. Provider-neutral: carries no opinion about any specific
   * provider's own retention guarantees. See the "SAFETY OVER LIVENESS"
   * invariant documented above for how an implementation is expected to
   * use it.
   */
  providerStartAttemptedAt: Date;
}

/**
 * The outcome of asking a provider to start a payment. `providerReference`
 * is an opaque string — the same provider-neutral concept already reserved
 * on `Payment.providerReference` (IMP-032): a future caller is expected to
 * record it there, but this port itself never touches persistence. A
 * compliant provider returns the SAME `providerReference` for every call
 * sharing the same `paymentId` (see the idempotency invariant above) —
 * this result type has no field a provider could use to report a
 * *different* one under a different name.
 *
 * Deliberately never carries authoritative `amountMinor`, `currency`,
 * Payment status, or Order status — the Payment remains authoritative
 * locally; nothing about this result can influence any of those. The
 * only thing a caller may ever do with a successful result is attempt to
 * record `providerReference` via `PaymentRepository.setProviderReferenceIfPending`.
 *
 * Failure is collapsed to a single `PROVIDER_ERROR` rather than an
 * open-ended set of provider-specific failure codes (a declined card, an
 * expired session, a network timeout, ...) — the real taxonomy of failures
 * is provider-specific and cannot be designed correctly in the abstract;
 * a future adapter and its caller are the right place to refine this once
 * a real provider exists to observe.
 */
export type StartPaymentResult =
  { ok: true; providerReference: string } | { ok: false; error: "PROVIDER_ERROR" };

/**
 * A single capability: start a payment, idempotently by `paymentId`, and
 * safely (never creating a duplicate external operation even when its own
 * native idempotency mechanism can no longer be trusted — see "SAFETY OVER
 * LIVENESS" above) (see the invariants documented above `StartPaymentInput`).
 * No `confirmPayment`,
 * `refund`, `cancelPayment`, or webhook-handling method — each of those
 * depends on details (synchronous vs. asynchronous confirmation, whether
 * refunds are even supported, how a webhook payload is shaped) that
 * differ per provider and are explicitly out of scope. Keeping this port
 * to the one operation actually needed avoids guessing at a shape a real
 * provider integration would likely have to change anyway.
 */
export interface PaymentProvider {
  startPayment(input: StartPaymentInput): Promise<StartPaymentResult>;
}
