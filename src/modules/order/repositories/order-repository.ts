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
}
