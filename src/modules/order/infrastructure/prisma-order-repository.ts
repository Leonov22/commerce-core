import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/modules/order/infrastructure/prisma-client";
import { encodeOrderCursor, decodeOrderCursor } from "@/modules/order/application/order-cursor";
import type {
  OrderRepository,
  NewOrderInput,
  FindManyByUserIdOptions,
  OrderListPage,
  CreateIdempotentOrderInput,
  CreateIdempotentOrderResult,
  IdempotencyRecord,
} from "@/modules/order/repositories/order-repository";
import type { Order, OrderItem, OrderStatus } from "@/modules/order/domain/order";

function toOrderCreateData(input: NewOrderInput) {
  return {
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
  };
}

async function createOrderRecord(input: NewOrderInput) {
  return prisma.order.create({
    data: toOrderCreateData(input),
    include: { items: true },
  });
}

/**
 * True for any unique-constraint violation on `orders` — safe to treat as
 * specifically the `idempotencyKey` constraint because that's the only
 * unique column `orders` has besides its primary key (which `create()`
 * cannot collide on: `id` is a fresh `cuid()`). Not narrowed further via
 * `error.meta.target`: with this Prisma version's driver-adapter error
 * shape, the violated constraint's field names live nested under
 * `error.meta.driverAdapterError.cause.constraint.fields`, not the flat
 * `meta.target` array Prisma's own docs describe — brittle to depend on
 * across Prisma/adapter versions, and unnecessary given the constraint
 * argument above.
 */
function isIdempotencyKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function findOrderRecord(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
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
    const row = await findOrderRecord(orderId);
    return row ? toDomainOrder(row) : null;
  },

  async updateStatusIfCurrent(
    orderId: string,
    expectedStatus: OrderStatus,
    nextStatus: OrderStatus,
  ): Promise<Order | null> {
    // CR-030: `updateMany` (not `update`) so the WHERE clause can include
    // `status` alongside `id` — Prisma's single-record `update` only
    // accepts a unique selector. Postgres evaluates this WHERE against the
    // row's actual committed status at the moment this statement runs,
    // and serializes concurrent writers to the same row, so a status read
    // earlier by the application can never be stale by the time this
    // executes: if another caller already changed the status away from
    // `expectedStatus`, `count` is 0 here and nothing is overwritten.
    const result = await prisma.order.updateMany({
      where: { id: orderId, status: expectedStatus },
      data: { status: nextStatus },
    });

    if (result.count === 0) {
      return null;
    }

    // `updateMany` only returns a count, not the updated row — re-fetch
    // using the same read path `findById` uses.
    const row = await findOrderRecord(orderId);
    return row ? toDomainOrder(row) : null;
  },

  async createIdempotent(input: CreateIdempotentOrderInput): Promise<CreateIdempotentOrderResult> {
    // IMP-031: a single INSERT that either succeeds outright or fails on
    // Postgres's own unique constraint on `idempotencyKey` — never a
    // separate "does a row with this key already exist?" read beforehand.
    // Two concurrent calls with the same key both reach this statement;
    // Postgres allows exactly one of them to actually insert and rejects
    // the other with a constraint violation, so which caller "wins" is
    // decided by the database, not by this function's control flow.
    try {
      const row = await prisma.order.create({
        data: {
          ...toOrderCreateData(input),
          idempotencyKey: input.idempotencyKey,
          idempotencyRequestHash: input.idempotencyRequestHash,
        },
        include: { items: true },
      });
      return { outcome: "created", order: toDomainOrder(row) };
    } catch (error) {
      if (!isIdempotencyKeyViolation(error)) {
        throw error;
      }

      // Lost the race (or this is a genuine sequential retry) — the row
      // that actually exists under this key is the only source of truth
      // for what happens next, never this call's own (rejected) input.
      const existing = await prisma.order.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { items: true },
      });
      if (!existing) {
        // The row that caused the violation is gone by the time we
        // re-read (e.g. deleted between the two statements) — surface the
        // original database error rather than fabricating an outcome.
        throw error;
      }

      if (existing.idempotencyRequestHash === input.idempotencyRequestHash) {
        return { outcome: "duplicate", order: toDomainOrder(existing) };
      }
      return { outcome: "conflict" };
    }
  },

  async findIdempotencyRecord(idempotencyKey: string): Promise<IdempotencyRecord | null> {
    // CR-031-02: a plain read against the unique `idempotencyKey` column —
    // no Catalog call, no monetary recomputation. Lets the application
    // layer recognize "this exact submission was already claimed" before
    // doing any work that could fail for reasons unrelated to idempotency
    // (e.g. a product that resolved fine originally becoming unavailable).
    const row = await prisma.order.findUnique({
      where: { idempotencyKey },
      include: { items: true },
    });
    if (!row || row.idempotencyRequestHash === null) {
      return null;
    }
    return { order: toDomainOrder(row), idempotencyRequestHash: row.idempotencyRequestHash };
  },
};
