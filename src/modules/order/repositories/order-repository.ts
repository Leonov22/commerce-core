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
}
