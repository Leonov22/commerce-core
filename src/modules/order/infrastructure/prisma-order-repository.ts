import "server-only";
import { prisma } from "@/modules/order/infrastructure/prisma-client";
import type { OrderRepository, NewOrderInput } from "@/modules/order/repositories/order-repository";
import type { Order, OrderItem, OrderStatus } from "@/modules/order/domain/order";

async function createOrderRecord(input: NewOrderInput) {
  return prisma.order.create({
    data: {
      status: input.status ?? "PENDING",
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      subtotalAmountMinor: input.subtotalAmountMinor,
      deliveryAmountMinor: input.deliveryAmountMinor,
      totalAmountMinor: input.totalAmountMinor,
      currency: input.currency,
      items: {
        create: input.items.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          unitPriceAmountMinor: item.unitPriceAmountMinor,
          quantity: item.quantity,
          lineTotalAmountMinor: item.lineTotalAmountMinor,
          currency: item.currency,
        })),
      },
    },
    include: { items: true },
  });
}

type OrderRow = Awaited<ReturnType<typeof createOrderRecord>>;

function toDomainOrderItem(row: OrderRow["items"][number]): OrderItem {
  return {
    id: row.id,
    orderId: row.orderId,
    productId: row.productId,
    productName: row.productName,
    unitPriceAmountMinor: row.unitPriceAmountMinor,
    quantity: row.quantity,
    lineTotalAmountMinor: row.lineTotalAmountMinor,
    currency: row.currency,
  };
}

function toDomainOrder(row: OrderRow): Order {
  return {
    id: row.id,
    status: row.status as OrderStatus,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    subtotalAmountMinor: row.subtotalAmountMinor,
    deliveryAmountMinor: row.deliveryAmountMinor,
    totalAmountMinor: row.totalAmountMinor,
    currency: row.currency,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    items: row.items.map(toDomainOrderItem),
  };
}

/**
 * Prisma implementation of `OrderRepository`. This is the only file in
 * Order allowed to run Prisma queries — the application layer depends on
 * the `OrderRepository` interface, never on this class directly.
 */
export const prismaOrderRepository: OrderRepository = {
  async create(input) {
    const row = await createOrderRecord(input);
    return toDomainOrder(row);
  },
};
