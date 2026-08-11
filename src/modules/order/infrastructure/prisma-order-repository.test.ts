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
