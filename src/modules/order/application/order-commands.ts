import type { OrderRepository, NewOrderInput } from "@/modules/order/repositories/order-repository";
import type { Order } from "@/modules/order/domain/order";

/**
 * Order write use cases. Orchestration only — the actual persistence lives
 * behind `OrderRepository`, passed in explicitly by the caller (the
 * module's public API wires the real Prisma-backed repository; tests pass a
 * fake one). This keeps Application depending on the repository
 * *abstraction* only, never on `PrismaOrderRepository` directly.
 */
export async function createOrder(
  repository: OrderRepository,
  input: NewOrderInput,
): Promise<Order> {
  return repository.create(input);
}
