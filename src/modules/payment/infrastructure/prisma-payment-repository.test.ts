import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prismaPaymentRepository } from "@/modules/payment/infrastructure/prisma-payment-repository";
import { prisma } from "@/modules/payment/infrastructure/prisma-client";
import { prismaOrderRepository } from "@/modules/order/infrastructure/prisma-order-repository";
import { prisma as orderPrisma } from "@/modules/order/infrastructure/prisma-client";
import type { NewOrderInput } from "@/modules/order/repositories/order-repository";

/**
 * Integration tests against the real Neon Postgres database. A real `Order`
 * row is required for every test here — `Payment.orderId` has a foreign
 * key to `orders` — created directly via `prismaOrderRepository`, the same
 * way `prisma-order-repository.test.ts`'s customer-order-history suite
 * creates real `User` rows for its own FK-valid test data.
 */
describe("prismaPaymentRepository", () => {
  const paymentIds: string[] = [];
  const orderIds: string[] = [];

  afterAll(async () => {
    if (paymentIds.length > 0) {
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    }
    if (orderIds.length > 0) {
      await orderPrisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await prisma.$disconnect();
    await orderPrisma.$disconnect();
  });

  function baseOrderInput(overrides: Partial<NewOrderInput> = {}): NewOrderInput {
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

  async function createTestOrder(overrides: Partial<NewOrderInput> = {}) {
    const order = await prismaOrderRepository.create(baseOrderInput(overrides));
    orderIds.push(order.id);
    return order;
  }

  it("create() persists a new Payment as PENDING with the given amount/currency (outcome: created)", async () => {
    const order = await createTestOrder();
    const result = await prismaPaymentRepository.create({
      orderId: order.id,
      amountMinor: order.totalAmountMinor,
      currency: order.currency,
    });

    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") return;
    paymentIds.push(result.payment.id);
    expect(result.payment.orderId).toBe(order.id);
    expect(result.payment.status).toBe("PENDING");
    expect(result.payment.amountMinor).toBe(order.totalAmountMinor);
    expect(result.payment.currency).toBe(order.currency);
    expect(result.payment.providerReference).toBeNull();
  });

  it("create() for an Order that already has a Payment returns the existing Payment (outcome: duplicate) and persists no second row", async () => {
    const order = await createTestOrder();
    const first = await prismaPaymentRepository.create({
      orderId: order.id,
      amountMinor: order.totalAmountMinor,
      currency: order.currency,
    });
    expect(first.outcome).toBe("created");
    if (first.outcome !== "created") return;
    paymentIds.push(first.payment.id);

    const second = await prismaPaymentRepository.create({
      orderId: order.id,
      amountMinor: order.totalAmountMinor,
      currency: order.currency,
    });
    expect(second.outcome).toBe("duplicate");
    expect(second.payment.id).toBe(first.payment.id);

    const matching = await prisma.payment.findMany({ where: { orderId: order.id } });
    expect(matching).toHaveLength(1);
  });

  it("findById returns the Payment for a known id, and null for an unknown id", async () => {
    const order = await createTestOrder();
    const created = await prismaPaymentRepository.create({
      orderId: order.id,
      amountMinor: order.totalAmountMinor,
      currency: order.currency,
    });
    expect(created.outcome).toBe("created");
    if (created.outcome !== "created") return;
    paymentIds.push(created.payment.id);

    const found = await prismaPaymentRepository.findById(created.payment.id);
    expect(found?.id).toBe(created.payment.id);

    const notFound = await prismaPaymentRepository.findById("nonexistent-payment-id");
    expect(notFound).toBeNull();
  });

  it("findByOrderId returns the Payment for a known Order, and null for an Order with no Payment", async () => {
    const orderWithPayment = await createTestOrder();
    const created = await prismaPaymentRepository.create({
      orderId: orderWithPayment.id,
      amountMinor: orderWithPayment.totalAmountMinor,
      currency: orderWithPayment.currency,
    });
    expect(created.outcome).toBe("created");
    if (created.outcome !== "created") return;
    paymentIds.push(created.payment.id);

    const found = await prismaPaymentRepository.findByOrderId(orderWithPayment.id);
    expect(found?.id).toBe(created.payment.id);

    const orderWithoutPayment = await createTestOrder();
    const notFound = await prismaPaymentRepository.findByOrderId(orderWithoutPayment.id);
    expect(notFound).toBeNull();
  });

  it("updateStatusIfCurrent persists PENDING -> SUCCEEDED and a fresh re-read confirms it", async () => {
    const order = await createTestOrder();
    const created = await prismaPaymentRepository.create({
      orderId: order.id,
      amountMinor: order.totalAmountMinor,
      currency: order.currency,
    });
    expect(created.outcome).toBe("created");
    if (created.outcome !== "created") return;
    paymentIds.push(created.payment.id);

    const updated = await prismaPaymentRepository.updateStatusIfCurrent(
      created.payment.id,
      "PENDING",
      "SUCCEEDED",
    );
    expect(updated?.status).toBe("SUCCEEDED");

    const refetched = await prismaPaymentRepository.findById(created.payment.id);
    expect(refetched?.status).toBe("SUCCEEDED");
  });

  it("updateStatusIfCurrent does NOT update when the expected status no longer matches (SUCCEEDED, expecting PENDING)", async () => {
    const order = await createTestOrder();
    const created = await prismaPaymentRepository.create({
      orderId: order.id,
      amountMinor: order.totalAmountMinor,
      currency: order.currency,
    });
    expect(created.outcome).toBe("created");
    if (created.outcome !== "created") return;
    paymentIds.push(created.payment.id);

    const toSucceeded = await prismaPaymentRepository.updateStatusIfCurrent(
      created.payment.id,
      "PENDING",
      "SUCCEEDED",
    );
    expect(toSucceeded?.status).toBe("SUCCEEDED");

    const rejected = await prismaPaymentRepository.updateStatusIfCurrent(
      created.payment.id,
      "PENDING",
      "FAILED",
    );
    expect(rejected).toBeNull();

    const refetched = await prismaPaymentRepository.findById(created.payment.id);
    expect(refetched?.status).toBe("SUCCEEDED");
  });

  it("IMP-032 §13: genuine concurrent create() calls for the same Order — exactly one 'created', one 'duplicate', both pointing at one Payment, and exactly one row persisted", async () => {
    const order = await createTestOrder();
    const input = {
      orderId: order.id,
      amountMinor: order.totalAmountMinor,
      currency: order.currency,
    };

    // Real parallel execution against the same live Postgres connection
    // pool — Postgres's own unique constraint on `orderId`, not this
    // test's control flow, decides which INSERT actually lands.
    const [a, b] = await Promise.all([
      prismaPaymentRepository.create(input),
      prismaPaymentRepository.create(input),
    ]);

    const results = [a, b];
    const created = results.filter((r) => r.outcome === "created");
    const duplicate = results.filter((r) => r.outcome === "duplicate");

    expect(created).toHaveLength(1);
    expect(duplicate).toHaveLength(1);
    expect(created[0]!.payment.id).toBe(duplicate[0]!.payment.id);
    paymentIds.push(created[0]!.payment.id);

    const matching = await prisma.payment.findMany({ where: { orderId: order.id } });
    expect(matching).toHaveLength(1);
  });
});
