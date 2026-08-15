import { isValidOrderStatusTransition } from "@/modules/order/domain/order";
import type { OrderRepository } from "@/modules/order/repositories/order-repository";
import type { Order, OrderStatus } from "@/modules/order/domain/order";

/**
 * Order lifecycle write use case (IMP-030 / CR-030). Establishes the
 * contract a future Payments/Admin module will call — no such caller
 * exists yet, and none is added here. Never exposed to Customer-facing
 * transport: status is read-only for Customers (see `@/modules/order`'s
 * public exports — nothing customer-facing calls this).
 *
 * No Prisma, no HTTP, no authentication concerns — orchestration only,
 * exactly like `checkout-order.ts` and `customer-orders.ts`.
 */
export type ChangeOrderStatusResult =
  | { ok: true; order: Order }
  | { ok: false; error: "ORDER_NOT_FOUND" }
  | { ok: false; error: "INVALID_STATUS_TRANSITION" }
  | { ok: false; error: "ORDER_STATUS_CHANGED" };

/**
 * CR-030: the transition is validated here against whatever status was
 * just read, but that read can be stale by the time the write happens —
 * two concurrent callers can both read PENDING and both pass validation.
 * The actual guarantee against a forbidden terminal-state transition
 * (e.g. PAID overwritten by a late CANCELLED) comes from
 * `updateStatusIfCurrent`'s atomic, database-enforced conditional write,
 * not from this function's own read-then-write sequencing. If the
 * conditional update reports no row changed, that means another caller
 * already moved the Order to a different status between this function's
 * read and its write — reported as `ORDER_STATUS_CHANGED`, never silently
 * ignored and never retried automatically (retrying is a decision for
 * whichever future caller actually needs it).
 */
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

  const updated = await repository.updateStatusIfCurrent(orderId, order.status, nextStatus);
  if (!updated) {
    return { ok: false, error: "ORDER_STATUS_CHANGED" };
  }

  return { ok: true, order: updated };
}
