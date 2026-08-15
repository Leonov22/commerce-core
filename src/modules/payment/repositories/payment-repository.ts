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
}
