import type { OrderRepository } from "@/modules/order/repositories/order-repository";
import type { Order } from "@/modules/order/domain/order";

/**
 * Internal, unscoped-by-owner Order lookup (IMP-032) — a thin pass-through
 * to `OrderRepository.findById`, exposed at the application layer so other
 * trusted internal modules (e.g. Payment) can resolve the authoritative
 * Order server-side through Order's public boundary, without reaching into
 * `@/modules/order/repositories/...` directly (which the project's
 * module-boundary rules forbid). Not customer-facing: no ownership check
 * exists here, exactly like `findById` itself (see its doc comment on
 * `OrderRepository`) — any future customer-facing caller must use
 * `getCustomerOrder` (owner-scoped) instead, or add its own ownership
 * check before exposing this to a customer-facing transport.
 */
export async function getOrderById(
  repository: OrderRepository,
  orderId: string,
): Promise<Order | null> {
  return repository.findById(orderId);
}
