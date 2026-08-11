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
  subtotalAmountMinor: number;
  deliveryAmountMinor: number;
  totalAmountMinor: number;
  currency: string;
  items: NewOrderItemInput[];
}

/**
 * Read/write abstraction the Order application layer depends on. It never
 * depends on the Prisma implementation directly — only on this interface.
 * Deliberately minimal: `create` is the one operation this foundation
 * actually needs to prove the persistence model works end to end. Further
 * methods (lookup, status transitions, listing) belong to whichever future
 * milestone first needs them.
 */
export interface OrderRepository {
  create(input: NewOrderInput): Promise<Order>;
}
