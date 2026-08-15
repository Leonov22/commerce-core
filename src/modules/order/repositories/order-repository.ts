import type { Order, OrderStatus } from "@/modules/order/domain/order";

export interface NewOrderItemInput {
  productId: string;
  productName: string;
  unitPriceAmountMinor: number;
  quantity: number;
  lineTotalAmountMinor: number;
  currency: string;
}

export interface NewOrderInput {
  /** Defaults to `PENDING` at the infrastructure layer if omitted. */
  status?: OrderStatus;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** The authenticated customer, or `null` for a guest order (IMP-029). */
  userId: string | null;
  subtotalAmountMinor: number;
  deliveryAmountMinor: number;
  totalAmountMinor: number;
  currency: string;
  items: NewOrderItemInput[];
}

/**
 * One page of a customer's order history, newest first. `nextCursor` is the
 * last returned Order's id — pass it back as `cursor` to fetch the next
 * page; `null` means there is no next page.
 */
export interface OrderListPage {
  orders: Order[];
  nextCursor: string | null;
}

export interface FindManyByUserIdOptions {
  /** The previous page's `nextCursor` — omit for the first page. */
  cursor?: string;
  take: number;
}

/**
 * Checkout submission idempotency (IMP-031). `idempotencyKey` is the
 * client-supplied `Idempotency-Key` header value; `idempotencyRequestHash`
 * is a hash of the logical checkout submission (see
 * `computeCheckoutRequestFingerprint` in the application layer) computed
 * once, before the first attempt to persist — never recomputed from the
 * eventually-stored row.
 */
export interface CreateIdempotentOrderInput extends NewOrderInput {
  idempotencyKey: string;
  idempotencyRequestHash: string;
}

export type CreateIdempotentOrderResult =
  | { outcome: "created"; order: Order }
  | { outcome: "duplicate"; order: Order }
  | { outcome: "conflict" };

/** An existing idempotency claim: the Order it produced and the fingerprint it was claimed under. */
export interface IdempotencyRecord {
  order: Order;
  idempotencyRequestHash: string;
}

/**
 * Read/write abstraction the Order application layer depends on. It never
 * depends on the Prisma implementation directly — only on this interface.
 *
 * `findManyByUserId`/`findByIdForUser` (IMP-029) both take `userId` as a
 * required, server-derived argument and apply it directly in the
 * underlying query's `WHERE` clause — never as a post-fetch filter — so
 * that ownership is enforced by the database itself, not by application
 * code that could be bypassed or gotten wrong.
 */
export interface OrderRepository {
  create(input: NewOrderInput): Promise<Order>;
  findManyByUserId(userId: string, options: FindManyByUserIdOptions): Promise<OrderListPage>;
  /** Returns `null` both when the order doesn't exist and when it belongs to a different user — the two cases must be indistinguishable to the caller. */
  findByIdForUser(orderId: string, userId: string): Promise<Order | null>;
  /**
   * Unscoped by owner (IMP-030) — for internal application use by
   * `changeOrderStatus`, not a customer-facing lookup. Never expose this
   * through a customer-facing transport without adding the same ownership
   * check `findByIdForUser` already has.
   */
  findById(orderId: string): Promise<Order | null>;
  /**
   * Atomic conditional status update (CR-030). Only writes when the
   * database's *current* status still matches `expectedStatus` at the
   * moment the statement executes — the check and the write happen as one
   * database operation, so a stale status read earlier by the application
   * can never overwrite a status another concurrent caller already
   * changed. Returns the updated `Order` if the write applied, or `null`
   * if it didn't (the row's status was no longer `expectedStatus`).
   *
   * This is the only sanctioned way to persist an Order status change —
   * there is deliberately no unconditional "just set the status" method,
   * so a future caller cannot accidentally bypass this guarantee.
   */
  updateStatusIfCurrent(
    orderId: string,
    expectedStatus: OrderStatus,
    nextStatus: OrderStatus,
  ): Promise<Order | null>;

  /**
   * Atomic idempotent create (IMP-031). Attempts to persist a new Order
   * under `idempotencyKey` as a single database operation — never a
   * "check if it exists, then insert" sequence, which cannot rule out two
   * concurrent callers both passing the check before either insert lands.
   * Postgres's own unique constraint on `idempotencyKey` is the sole
   * arbiter of which caller "wins" when two concurrent calls use the same
   * key: exactly one insert succeeds; the other observes the constraint
   * violation and this method resolves it into `"duplicate"` or
   * `"conflict"` by comparing `idempotencyRequestHash` against the row
   * that actually got persisted, never by re-deciding based on its own
   * stale view of "does it exist yet".
   *
   * - `"created"`: no prior Order existed under this key; this call's
   *   Order was persisted.
   * - `"duplicate"`: an Order already exists under this key with the same
   *   `idempotencyRequestHash` — the same logical submission being
   *   retried. Returns that existing Order; nothing new was persisted.
   * - `"conflict"`: an Order already exists under this key with a
   *   *different* `idempotencyRequestHash` — the same key reused for a
   *   materially different submission (including a different resolved
   *   user). No Order is returned; the caller must treat this as a
   *   rejected request, never fall back to returning the mismatched Order.
   */
  createIdempotent(input: CreateIdempotentOrderInput): Promise<CreateIdempotentOrderResult>;

  /**
   * CR-031-02: looks up an existing idempotency claim by key alone — no
   * Catalog resolution, no monetary calculation, nothing beyond a single
   * read of already-persisted data. This is what lets `createOrderFromCheckout`
   * recognize a replay *before* touching Catalog, so a submission that
   * succeeded once keeps replaying successfully even if the Catalog state
   * that produced its (historical, snapshot) Order later changes in a way
   * that would make a *fresh* resolution fail (e.g. the product becomes
   * unavailable). Returns `null` when no Order has ever been created under
   * this key — including "brand new key" and "not an idempotent request at
   * all" — in which case the caller proceeds with the normal creation path.
   *
   * This is a plain read, not part of the atomicity guarantee itself — the
   * guarantee under real concurrency still lives entirely in
   * `createIdempotent`'s single, constraint-enforced `INSERT`. Two
   * concurrent *first* requests for a brand-new key both see `null` here
   * and both proceed to `createIdempotent`, which resolves the race exactly
   * as before.
   */
  findIdempotencyRecord(idempotencyKey: string): Promise<IdempotencyRecord | null>;
}
