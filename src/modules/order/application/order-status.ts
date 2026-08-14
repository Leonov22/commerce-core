import { isValidOrderStatusTransition } from "@/modules/order/domain/order";
import type { OrderRepository } from "@/modules/order/repositories/order-repository";
import type { Order, OrderStatus } from "@/modules/order/domain/order";

/**
 * Order lifecycle write use case (IMP-030). Establishes the contract a
 * future Payments/Admin module will call — no such caller exists yet, and
 * none is added here. Never exposed to Customer-facing transport: status
 * is read-only for Customers (see `@/modules/order`'s public exports —
 * nothing customer-facing calls this).
 *
 * No Prisma, no HTTP, no authentication concerns — orchestration only,
 * exactly like `checkout-order.ts` and `customer-orders.ts`.
 */
export type ChangeOrderStatusResult =
  | { ok: true; order: Order }
  | { ok: false; error: "ORDER_NOT_FOUND" }
  | { ok: false; error: "INVALID_STATUS_TRANSITION" };

export async function changeOrderStatus(
  repository: OrderRepository,
  orderId: string,
  nextStatus: OrderStatus,
): Promise<ChangeOrderStatusResult> {
  const order = await repository.findById(orderId);
  if (!order) {
    return { ok: false, error: "ORDER_NOT_FOUND" };
  }

  if (!isValidOrderStatusTransition(order.status, nextStatus)) {
    return { ok: false, error: "INVALID_STATUS_TRANSITION" };
  }

  const updated = await repository.updateStatus(orderId, nextStatus);
  return { ok: true, order: updated };
}
