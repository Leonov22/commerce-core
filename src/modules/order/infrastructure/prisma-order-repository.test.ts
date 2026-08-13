import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prismaOrderRepository } from "@/modules/order/infrastructure/prisma-order-repository";
import { prisma } from "@/modules/order/infrastructure/prisma-client";
import type { NewOrderInput } from "@/modules/order/repositories/order-repository";

/**
 * Integration tests against the real Neon Postgres database — these
 * exercise the actual schema/constraints, not a fake. There is no
 * fake-repository application-layer test here because `order-commands.ts`
 * has nothing to orchestrate yet beyond a direct pass-through to the
 * repository; that will grow once a real Order-creation use case exists.
 */
describe("prismaOrderRepository", () => {
  const createdOrderIds: string[] = [];

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      // Deleting the order is enough — order_items cascades at the DB level.
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    await prisma.$disconnect();
  });

  function baseInput(overrides: Partial<NewOrderInput> = {}): NewOrderInput {
    return {
      firstName: "John",
      lastName: "Smith",
      email: "john.smith@example.com",
      phone: "+421 900 123 456",
      userId: null,
      subtotalAmountMinor: 24000,
      deliveryAmountMinor: 800,
      totalAmountMinor: 24800,
      currency: "USD",
      items: [
        {
          productId: "1",
          productName: "Studio Chair",
          unitPriceAmountMinor: 24000,
          quantity: 1,
          lineTotalAmountMinor: 24000,
          currency: "USD",
        },
      ],
      ...overrides,
    };
  }

  it("defaults to PENDING status when none is given", async () => {
    const order = await prismaOrderRepository.create(baseInput());
    createdOrderIds.push(order.id);
    expect(order.status).toBe("PENDING");
  });

  it("persists each of the three approved statuses correctly", async () => {
    for (const status of ["PENDING", "PAID", "CANCELLED"] as const) {
      const order = await prismaOrderRepository.create(baseInput({ status }));
      createdOrderIds.push(order.id);
      expect(order.status).toBe(status);
    }
  });

  it("persists the customer snapshot fields on the Order itself", async () => {
    const order = await prismaOrderRepository.create(
      baseInput({
        firstName: "Jean",
        lastName: "Dupont",
        email: "jean@example.com",
        phone: "+33 6 12 34 56 78",
      }),
    );
    createdOrderIds.push(order.id);
    expect(order.firstName).toBe("Jean");
    expect(order.lastName).toBe("Dupont");
    expect(order.email).toBe("jean@example.com");
    expect(order.phone).toBe("+33 6 12 34 56 78");
  });

  it("uses integer minor units for every money field, never a float", async () => {
    const order = await prismaOrderRepository.create(baseInput());
    createdOrderIds.push(order.id);

    expect(Number.isInteger(order.subtotalAmountMinor)).toBe(true);
    expect(Number.isInteger(order.deliveryAmountMinor)).toBe(true);
    expect(Number.isInteger(order.totalAmountMinor)).toBe(true);
    expect(order.subtotalAmountMinor).toBe(24000);
    expect(order.deliveryAmountMinor).toBe(800);
    expect(order.totalAmountMinor).toBe(24800);

    const [item] = order.items;
    expect(Number.isInteger(item?.unitPriceAmountMinor)).toBe(true);
    expect(Number.isInteger(item?.lineTotalAmountMinor)).toBe(true);
  });

  it("correctly models the Order -> OrderItem relationship", async () => {
    const order = await prismaOrderRepository.create(
      baseInput({
        items: [
          {
            productId: "1",
            productName: "Studio Chair",
            unitPriceAmountMinor: 24000,
            quantity: 1,
            lineTotalAmountMinor: 24000,
            currency: "USD",
          },
          {
            productId: "3",
            productName: "Table Lamp",
            unitPriceAmountMinor: 9600,
            quantity: 2,
            lineTotalAmountMinor: 19200,
            currency: "USD",
          },
        ],
      }),
    );
    createdOrderIds.push(order.id);

    expect(order.items).toHaveLength(2);
    for (const item of order.items) {
      expect(item.orderId).toBe(order.id);
      expect(item.id).toBeTruthy();
    }
  });

  it("stores the product snapshot fields on OrderItem, independent of the live Product", async () => {
    const order = await prismaOrderRepository.create(
      baseInput({
        items: [
          {
            productId: "1",
            productName: "Studio Chair",
            unitPriceAmountMinor: 24000,
            quantity: 1,
            lineTotalAmountMinor: 24000,
            currency: "USD",
          },
        ],
      }),
    );
    createdOrderIds.push(order.id);

    const [item] = order.items;
    expect(item?.productId).toBe("1");
    expect(item?.productName).toBe("Studio Chair");
    expect(item?.unitPriceAmountMinor).toBe(24000);
    expect(item?.currency).toBe("USD");
  });

  it("accepts a snapshot productId that does not correspond to any current Product row", async () => {
    // Proves OrderItem is genuinely decoupled from Product — no foreign key
    // exists, so a historical order line survives even if the product it
    // once referenced is gone.
    const order = await prismaOrderRepository.create(
      baseInput({
        items: [
          {
            productId: "no-longer-exists",
            productName: "Discontinued Item",
            unitPriceAmountMinor: 1000,
            quantity: 1,
            lineTotalAmountMinor: 1000,
            currency: "USD",
          },
        ],
      }),
    );
    createdOrderIds.push(order.id);
    expect(order.items[0]?.productId).toBe("no-longer-exists");
  });

  it("enforces quantity >= 1 at the database level", async () => {
    await expect(
      prismaOrderRepository.create(
        baseInput({
          items: [
            {
              productId: "1",
              productName: "Studio Chair",
              unitPriceAmountMinor: 24000,
              quantity: 0,
              lineTotalAmountMinor: 0,
              currency: "USD",
            },
          ],
        }),
      ),
    ).rejects.toThrow();
  });

  it("leaves no partial Order when an OrderItem in the same create fails a constraint", async () => {
    // A unique marker lets this test prove a negative — that no matching
    // Order row exists at all — rather than relying only on the create()
    // call having thrown, since Prisma's nested `create` is a single
    // statement and should roll back the Order row too, not just skip the
    // invalid item.
    const marker = `atomicity-test-${Date.now()}@example.com`;

    await expect(
      prismaOrderRepository.create(
        baseInput({
          email: marker,
          items: [
            {
              productId: "1",
              productName: "Studio Chair",
              unitPriceAmountMinor: 24000,
              quantity: 1,
              lineTotalAmountMinor: 24000,
              currency: "USD",
            },
            {
              productId: "3",
              productName: "Table Lamp",
              unitPriceAmountMinor: 9600,
              quantity: 0, // violates order_items_quantity_at_least_one
              lineTotalAmountMinor: 0,
              currency: "USD",
            },
          ],
        }),
      ),
    ).rejects.toThrow();

    const partialOrders = await prisma.order.findMany({ where: { email: marker } });
    expect(partialOrders).toHaveLength(0);
  });

  it("enforces non-negative money amounts at the database level", async () => {
    await expect(
      prismaOrderRepository.create(baseInput({ totalAmountMinor: -100 })),
    ).rejects.toThrow();
  });

  it("cascades delete from Order to its OrderItems", async () => {
    const order = await prismaOrderRepository.create(baseInput());
    const orderId = order.id;

    await prisma.order.delete({ where: { id: orderId } });

    const remainingItems = await prisma.orderItem.findMany({ where: { orderId } });
    expect(remainingItems).toHaveLength(0);
    // Already deleted — do not add it to createdOrderIds for afterAll cleanup.
  });
});

/**
 * Customer order history (IMP-029) — real Postgres integration tests, same
 * rationale as the suite above. Creates real `User` rows directly via
 * `prisma.user.create` for FK-valid test data; this touches the shared
 * database, not the Identity module's application/repository code, so it
 * does not create a dependency from Order on Identity.
 */
describe("prismaOrderRepository — customer order history", () => {
  const historyOrderIds: string[] = [];
  const historyUserIds: string[] = [];

  afterAll(async () => {
    if (historyOrderIds.length > 0) {
      await prisma.order.deleteMany({ where: { id: { in: historyOrderIds } } });
    }
    if (historyUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: historyUserIds } } });
    }
    await prisma.$disconnect();
  });

  async function createTestUser(label: string): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: `order-history-test-${label}-${Date.now()}@example.com`,
        passwordHash: "irrelevant-for-this-test",
      },
    });
    historyUserIds.push(user.id);
    return user.id;
  }

  function baseInput(overrides: Partial<NewOrderInput> = {}): NewOrderInput {
    return {
      firstName: "John",
      lastName: "Smith",
      email: "john.smith@example.com",
      phone: "+421 900 123 456",
      userId: null,
      subtotalAmountMinor: 24000,
      deliveryAmountMinor: 800,
      totalAmountMinor: 24800,
      currency: "USD",
      items: [
        {
          productId: "1",
          productName: "Studio Chair",
          unitPriceAmountMinor: 24000,
          quantity: 1,
          lineTotalAmountMinor: 24000,
          currency: "USD",
        },
      ],
      ...overrides,
    };
  }

  it("lists only the requesting user's own orders", async () => {
    const userAId = await createTestUser("list-a");
    const userBId = await createTestUser("list-b");

    const orderA = await prismaOrderRepository.create(baseInput({ userId: userAId }));
    historyOrderIds.push(orderA.id);
    const orderB = await prismaOrderRepository.create(baseInput({ userId: userBId }));
    historyOrderIds.push(orderB.id);

    const pageA = await prismaOrderRepository.findManyByUserId(userAId, { take: 10 });
    expect(pageA.orders.map((order) => order.id)).toEqual([orderA.id]);

    const pageB = await prismaOrderRepository.findManyByUserId(userBId, { take: 10 });
    expect(pageB.orders.map((order) => order.id)).toEqual([orderB.id]);
  });

  it("returns an empty page for a user with no orders", async () => {
    const userId = await createTestUser("empty");
    const page = await prismaOrderRepository.findManyByUserId(userId, { take: 10 });
    expect(page.orders).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("excludes guest orders (userId null) from every customer's order history", async () => {
    const userId = await createTestUser("guest-exclusion");
    const guestOrder = await prismaOrderRepository.create(baseInput({ userId: null }));
    historyOrderIds.push(guestOrder.id);

    const page = await prismaOrderRepository.findManyByUserId(userId, { take: 10 });
    expect(page.orders.map((order) => order.id)).not.toContain(guestOrder.id);
  });

  it("paginates deterministically newest-first with a working cursor", async () => {
    const userId = await createTestUser("pagination");
    const createdIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const order = await prismaOrderRepository.create(baseInput({ userId }));
      historyOrderIds.push(order.id);
      createdIds.push(order.id);
    }
    // Created oldest -> newest; newest-first (createdAt DESC, id DESC) expected.
    const expectedOrder = [...createdIds].reverse();

    const firstPage = await prismaOrderRepository.findManyByUserId(userId, { take: 2 });
    expect(firstPage.orders.map((order) => order.id)).toEqual(expectedOrder.slice(0, 2));
    expect(firstPage.nextCursor).toBe(expectedOrder[1]);

    const secondPage = await prismaOrderRepository.findManyByUserId(userId, {
      take: 2,
      cursor: firstPage.nextCursor!,
    });
    expect(secondPage.orders.map((order) => order.id)).toEqual(expectedOrder.slice(2));
    expect(secondPage.nextCursor).toBeNull();
  });

  it("IDOR: a user can retrieve their own order but never another user's order", async () => {
    const userAId = await createTestUser("idor-a");
    const userBId = await createTestUser("idor-b");

    const orderA = await prismaOrderRepository.create(baseInput({ userId: userAId }));
    historyOrderIds.push(orderA.id);
    const orderB = await prismaOrderRepository.create(baseInput({ userId: userBId }));
    historyOrderIds.push(orderB.id);

    expect(await prismaOrderRepository.findByIdForUser(orderA.id, userAId)).not.toBeNull();
    expect(await prismaOrderRepository.findByIdForUser(orderB.id, userAId)).toBeNull();
    expect(await prismaOrderRepository.findByIdForUser(orderB.id, userBId)).not.toBeNull();
    expect(await prismaOrderRepository.findByIdForUser(orderA.id, userBId)).toBeNull();
  });

  it("findByIdForUser returns null for a nonexistent order id", async () => {
    const userId = await createTestUser("nonexistent-order");
    expect(await prismaOrderRepository.findByIdForUser("nonexistent-order-id", userId)).toBeNull();
  });

  it("returns the stored OrderItem snapshot even for a product that no longer exists", async () => {
    const userId = await createTestUser("snapshot");
    const order = await prismaOrderRepository.create(
      baseInput({
        userId,
        items: [
          {
            productId: "no-longer-exists",
            productName: "Discontinued Item",
            unitPriceAmountMinor: 1000,
            quantity: 1,
            lineTotalAmountMinor: 1000,
            currency: "USD",
          },
        ],
      }),
    );
    historyOrderIds.push(order.id);

    const found = await prismaOrderRepository.findByIdForUser(order.id, userId);
    expect(found?.items[0]?.productId).toBe("no-longer-exists");
    expect(found?.items[0]?.productName).toBe("Discontinued Item");
    expect(found?.items[0]?.unitPriceAmountMinor).toBe(1000);
  });

  it("SET NULL: deleting the owning User leaves the Order intact with userId = null", async () => {
    const userId = await createTestUser("delete-set-null");
    const order = await prismaOrderRepository.create(baseInput({ userId }));
    historyOrderIds.push(order.id);

    await prisma.user.delete({ where: { id: userId } });
    // Already deleted — remove so afterAll doesn't attempt a redundant delete.
    const index = historyUserIds.indexOf(userId);
    if (index >= 0) historyUserIds.splice(index, 1);

    const stillExists = await prisma.order.findUnique({ where: { id: order.id } });
    expect(stillExists).not.toBeNull();
    expect(stillExists?.userId).toBeNull();
  });
});
