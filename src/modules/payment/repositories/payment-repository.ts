import type { Payment, PaymentStatus } from "@/modules/payment/domain/payment";

/**
 * The immutable payable snapshot a Payment is initialized with — derived
 * from the authoritative Order server-side by the application layer, never
 * accepted directly from a client. `status` is deliberately not part of
 * this input: the repository's `create` always initializes a new Payment
 * as `PENDING`, the same way `createOrderFromCheckout` never lets a caller
 * choose an Order's initial status.
 */
export interface NewPaymentInput {
  orderId: string;
  amountMinor: number;
  currency: string;
}

export type CreatePaymentResult =
  { outcome: "created"; payment: Payment } | { outcome: "duplicate"; payment: Payment };

/**
 * Read/write abstraction the Payment application layer depends on. It
 * never depends on the Prisma implementation directly — only on this
 * interface, matching `OrderRepository`'s established pattern.
 *
 * Intentionally small (IMP-032 §9): only the four operations this
 * milestone's foundation actually needs. Not a generic CRUD repository —
 * there is no `delete`, no `update` beyond the one conditional status
 * transition, and no listing/pagination (nothing yet needs to list
 * Payments).
 */
export interface PaymentRepository {
  /**
   * Atomic create-or-detect-duplicate (IMP-032 §12/§13), mirroring
   * `OrderRepository.createIdempotent`'s proven pattern exactly: a single
   * `INSERT`, never a "check if it exists, then insert" sequence. Postgres's
   * own unique constraint on `orderId` is the sole arbiter of which caller
   * "wins" when two concurrent calls target the same Order — the loser
   * observes the constraint violation and this method resolves it into
   * `"duplicate"` by re-reading the row that actually got persisted, never
   * by re-deciding based on its own stale view of "does it exist yet".
   *
   * - `"created"`: no Payment existed for this Order; this call's Payment
   *   was persisted, as `PENDING`.
   * - `"duplicate"`: a Payment already exists for this Order. Returns that
   *   existing Payment; nothing new was persisted. The caller must treat
   *   this as "a Payment already exists", never silently re-create.
   */
  create(input: NewPaymentInput): Promise<CreatePaymentResult>;

  findById(paymentId: string): Promise<Payment | null>;

  /** The one-Payment-per-Order lookup (IMP-032 §8) — `null` if the Order has no Payment yet. */
  findByOrderId(orderId: string): Promise<Payment | null>;

  /**
   * Atomic conditional status update, following the exact same
   * database-conditional-write principle CR-030 established for
   * `OrderRepository.updateStatusIfCurrent` — only writes when the
   * database's *current* status still matches `expectedStatus` at the
   * moment the statement executes. Not called by anything in IMP-032
   * itself (no provider exists yet to report a result); established now,
   * alongside the domain transition policy, so a future payment-processing
   * milestone has the atomic primitive ready without redesigning this
   * repository.
   */
  updateStatusIfCurrent(
    paymentId: string,
    expectedStatus: PaymentStatus,
    nextStatus: PaymentStatus,
  ): Promise<Payment | null>;

  /**
   * Atomically attaches a provider-issued reference to a still-`PENDING`
   * Payment that doesn't already have one (IMP-034) —
   * `WHERE id = ? AND status = 'PENDING' AND providerReference IS NULL`,
   * the same database-conditional-write principle CR-030/IMP-032 already
   * established for `updateStatusIfCurrent`/`create`: never a prior "does
   * it already have a reference?" read as authority. Two concurrent calls
   * for the same Payment both reach this statement; Postgres allows
   * exactly one to actually write, so a provider reference can never be
   * silently overwritten by a second, differently-valued call.
   *
   * Deliberately does not change `status` — attaching a provider
   * reference is not the same as the Payment being confirmed successful;
   * it stays `PENDING`. Only a future milestone, once a provider
   * genuinely reports a final result, is responsible for any status
   * transition (via `updateStatusIfCurrent` above, unmodified by this
   * addition).
   *
   * Returns the updated Payment if the write applied, or `null` if it
   * didn't — either the Payment was no longer `PENDING`, or another call
   * already attached a reference first. The caller must not treat a
   * `null` result as this call's own reference having been persisted.
   *
   * IMP-034-FIX: this alone only guarantees ONE `providerReference` is
   * ever persisted — it says nothing about, and cannot make atomic,
   * whether the external provider call itself happened once or twice.
   * Safety under concurrent callers additionally depends on
   * `PaymentProvider`'s own idempotency contract (see
   * `@/modules/payment/providers/payment-provider.ts`): a compliant
   * provider treats repeated `startPayment` calls carrying the same
   * `paymentId` as the same logical external operation. This method and
   * that contract are two independent, complementary guarantees — this
   * one alone is not sufficient to make the whole flow safe.
   */
  setProviderReferenceIfPending(
    paymentId: string,
    providerReference: string,
  ): Promise<Payment | null>;

  /**
   * Atomically durably marks that a provider-start attempt is being made
   * for this Payment (IMP-035-FIX-2), if none has been marked yet —
   * `WHERE id = ? AND status = 'PENDING' AND providerStartAttemptedAt IS NULL`,
   * the same database-conditional-write principle already established for
   * `create`/`updateStatusIfCurrent`/`setProviderReferenceIfPending`. This
   * is the atomic "first-start claim" primitive `processPayment` calls
   * BEFORE ever contacting a `PaymentProvider`, so that even a process
   * crash between this write and the provider call still leaves a durable
   * record that an attempt may have happened.
   *
   * Unlike the other conditional-write methods above, this ALWAYS returns
   * the current row (never `null` because the condition didn't match) —
   * the caller needs `providerStartAttemptedAt`'s authoritative value
   * regardless of whether THIS call is the one that set it or an earlier
   * call already did, since a `PaymentProvider` implementation decides its
   * own safe-retry behavior based on that timestamp's age, not on who set
   * it. Only returns `null` if the Payment doesn't exist, or has moved
   * away from `PENDING` since the caller's own read (mirroring
   * `updateStatusIfCurrent`'s null-for-no-longer-matching convention).
   *
   * Two concurrent calls for the same Payment both reach this statement;
   * Postgres allows exactly one to actually write the timestamp, and both
   * calls then observe the SAME resulting value — there is never a
   * scenario where two different `providerStartAttemptedAt` values exist
   * for one Payment.
   */
  claimProviderStartAttempt(paymentId: string): Promise<Payment | null>;
}
