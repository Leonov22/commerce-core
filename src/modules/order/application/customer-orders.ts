import type { OrderRepository, OrderListPage } from "@/modules/order/repositories/order-repository";
import type { Order } from "@/modules/order/domain/order";

/**
 * Customer order-history use cases (IMP-029). Orchestration only — real
 * ownership enforcement happens inside the repository's query itself (see
 * `OrderRepository`'s doc comment), not here; this layer exists to keep
 * Application depending on the repository abstraction, matching every
 * other command in this module.
 */

/** Small, fixed default — a "foundation" history view, not a configurable admin listing. */
export const CUSTOMER_ORDERS_PAGE_SIZE = 10;

export async function getCustomerOrders(
  repository: OrderRepository,
  userId: string,
  cursor?: string,
): Promise<OrderListPage> {
  return repository.findManyByUserId(userId, { cursor, take: CUSTOMER_ORDERS_PAGE_SIZE });
}

export async function getCustomerOrder(
  repository: OrderRepository,
  userId: string,
  orderId: string,
): Promise<Order | null> {
  return repository.findByIdForUser(orderId, userId);
}
