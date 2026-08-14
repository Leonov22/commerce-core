import "server-only";
import { prisma } from "@/modules/order/infrastructure/prisma-client";
import { encodeOrderCursor, decodeOrderCursor } from "@/modules/order/application/order-cursor";
import type {
  OrderRepository,
  NewOrderInput,
  FindManyByUserIdOptions,
  OrderListPage,
} from "@/modules/order/repositories/order-repository";
import type { Order, OrderItem, OrderStatus } from "@/modules/order/domain/order";

async function createOrderRecord(input: NewOrderInput) {
  return prisma.order.create({
    data: {
      status: input.status ?? "PENDING",
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      userId: input.userId,
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
    userId: row.userId,
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

  async findManyByUserId(
    userId: string,
    { cursor, take }: FindManyByUserIdOptions,
  ): Promise<OrderListPage> {
    // CR029-01: genuine keyset (seek) pagination for the composite
    // `createdAt DESC, id DESC` ordering — a cursor built from `id` alone
    // cannot represent a position in a multi-column sort, and this
    // deliberately does not lean on Prisma's `cursor: { id }` + `skip: 1`
    // option to do that translation implicitly. The cursor decodes to
    // `{ createdAt, id }`; a malformed/tampered cursor fails safe to a
    // first page rather than throwing or leaking a database error. The
    // cursor never carries `userId` — ownership below is always applied
    // fresh from the caller's own argument, never from the cursor.
    let position: { createdAt: Date; id: string } | null = null;
    if (cursor) {
      const decoded = decodeOrderCursor(cursor);
      if (decoded.ok) {
        position = decoded.cursor;
      }
      // else: treated exactly like "no cursor" — starts from the first page.
    }

    // Fetch one extra row to know whether a next page exists, without a
    // separate count query.
    const rows = await prisma.order.findMany({
      where: {
        userId,
        ...(position
          ? {
              OR: [
                { createdAt: { lt: position.createdAt } },
                { createdAt: position.createdAt, id: { lt: position.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      include: { items: true },
    });

    const hasNextPage = rows.length > take;
    const page = hasNextPage ? rows.slice(0, take) : rows;
    const lastRow = page[page.length - 1];

    return {
      orders: page.map(toDomainOrder),
      nextCursor:
        hasNextPage && lastRow
          ? encodeOrderCursor({ createdAt: lastRow.createdAt, id: lastRow.id })
          : null,
    };
  },

  async findByIdForUser(orderId: string, userId: string): Promise<Order | null> {
    // `userId` is part of the WHERE clause itself, not a post-fetch check —
    // an order belonging to another user is indistinguishable from one that
    // doesn't exist at all.
    const row = await prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: true },
    });
    return row ? toDomainOrder(row) : null;
  },

  async findById(orderId: string): Promise<Order | null> {
    const row = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    return row ? toDomainOrder(row) : null;
  },

  async updateStatus(orderId: string, status: OrderStatus): Promise<Order> {
    const row = await prisma.order.update({
      where: { id: orderId },
      data: { status },
      include: { items: true },
    });
    return toDomainOrder(row);
  },
};
