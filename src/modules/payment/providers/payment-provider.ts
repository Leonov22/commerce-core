/**
 * PaymentProvider port (IMP-033). The outbound abstraction a future
 * external payment provider (Stripe, PayPal, or otherwise) will implement
 * — analogous to `PaymentRepository`, but for talking to an external
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
 */

/**
 * What a provider needs to start processing a payment — derived from the
 * authoritative, already-persisted `Payment` record, never from client
 * input. `paymentId` is this system's own internal Payment id (never a
 * provider-issued identifier), included so a future caller can correlate
 * the provider's response back to the right `Payment` row.
 *
 * Deliberately minimal: no customer PII, no return/redirect URLs, no
 * payment-method details — none of those are true of every provider, and
 * inventing one now would bake a single future provider's shape into a
 * port that must stay usable by any of them.
 */
export interface StartPaymentInput {
  paymentId: string;
  amountMinor: number;
  currency: string;
}

/**
 * The outcome of asking a provider to start a payment. `providerReference`
 * is an opaque string — the same provider-neutral concept already reserved
 * on `Payment.providerReference` (IMP-032): a future caller is expected to
 * record it there, but this port itself never touches persistence.
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
 * A single capability: start a payment. No `confirmPayment`, `refund`,
 * `cancelPayment`, or webhook-handling method — each of those depends on
 * details (synchronous vs. asynchronous confirmation, whether refunds are
 * even supported, how a webhook payload is shaped) that differ per
 * provider and are explicitly out of IMP-033's scope. Keeping this port to
 * the one operation this milestone actually needs to establish avoids
 * guessing at a shape a real provider integration would likely have to
 * change anyway.
 */
export interface PaymentProvider {
  startPayment(input: StartPaymentInput): Promise<StartPaymentResult>;
}
