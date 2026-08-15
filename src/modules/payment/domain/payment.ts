/**
 * Payment domain entity (IMP-032). Framework independent: no Prisma,
 * React, Next.js, provider SDKs, or persistence details — infrastructure
 * maps its own (Prisma-generated) representation onto this shape, never
 * the other way around.
 *
 * A Payment represents "the payment that pays for an Order" — provider
 * neutral. No external payment provider is integrated by this milestone;
 * `providerReference` exists only so a future provider integration has
 * somewhere to record its own opaque id without a schema change.
 */

export type PaymentStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

/**
 * The Payment lifecycle (IMP-032). Mirrors Order's lifecycle policy
 * (`isValidOrderStatusTransition` in `@/modules/order`) exactly: an
 * explicit per-status allow-list rather than a generic state-machine
 * abstraction. `PENDING` is the only non-terminal status — a Payment is
 * initialized as `PENDING` and, once a future milestone actually processes
 * it, moves exactly once to one of the three terminal states below. None
 * of `SUCCEEDED`/`FAILED`/`CANCELLED` has any outgoing transition, by
 * omission from this map rather than a separate "is terminal" check.
 *
 * Nothing in IMP-032 actually calls a transition — no provider exists yet
 * to report success/failure — but the policy is established now so a
 * future payment-processing milestone can build on it without redesigning
 * this domain, exactly as IMP-030 established `changeOrderStatus` before
 * anything customer-facing called it.
 */
const ALLOWED_PAYMENT_STATUS_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ["SUCCEEDED", "FAILED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
};

export function isValidPaymentStatusTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return ALLOWED_PAYMENT_STATUS_TRANSITIONS[from].includes(to);
}

export interface Payment {
  id: string;
  /** The Order this Payment pays for — exactly one Payment per Order (IMP-032). */
  orderId: string;
  status: PaymentStatus;
  /**
   * Integer minor units (e.g. $240.00 -> 24000), copied from the Order's
   * `totalAmountMinor` at initialization time — never a float, never
   * client-supplied, never re-derived from a later Order read.
   */
  amountMinor: number;
  currency: string;
  /** Opaque future-provider reference; always `null` until a provider integration exists. */
  providerReference: string | null;
  /**
   * When a provider-start was first durably attempted for this Payment
   * (IMP-035-FIX-2) — `null` means definitely never attempted; once set,
   * it is never reset, regardless of whether `providerReference` ever
   * ends up persisted. This is what lets the system tell "never started"
   * apart from "may have started, but we lost the reference" after a
   * crash — `providerReference` alone cannot, since it stays `null` in
   * both cases. See `PaymentRepository.claimProviderStartAttempt`.
   */
  providerStartAttemptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
