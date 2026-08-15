import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { initializePayment } from "@/modules/payment/application/initialize-payment";
import { createOrder as createOrderCommand } from "@/modules/order/application/order-commands";
import { changeOrderStatus as changeOrderStatusCommand } from "@/modules/order/application/order-status";
import { getOrderById as getOrderByIdCommand } from "@/modules/order/application/get-order";
import { prismaOrderRepository } from "@/modules/order/infrastructure/prisma-order-repository";
import { prisma as orderPrisma } from "@/modules/order/infrastructure/prisma-client";
import { prismaPaymentRepository } from "@/modules/payment/infrastructure/prisma-payment-repository";
import { prisma as paymentPrisma } from "@/modules/payment/infrastructure/prisma-client";
import type { NewOrderInput } from "@/modules/order/repositories/order-repository";
import type {
  PaymentRepository,
  NewPaymentInput,
  CreatePaymentResult,
} from "@/modules/payment/repositories/payment-repository";
import type { Payment } from "@/modules/payment/domain/payment";

/**
 * `initializePayment` takes Order lookup as an injected `getOrder`
 * function (see `GetOrderById` in `initialize-payment.ts`) rather than
 * importing `@/modules/order` directly — its public barrel re-exports
 * `.tsx` presentation components this project's Vitest config has no JSX
 * transform for, the same limitation documented on `route.test.ts` and
 * `prisma-order-repository.test.ts` throughout this project's history.
 * These tests inject a `getOrder` bound to the real, already-tested
 * `prismaOrderRepository` (via Order's internal `getOrderById` application
 * function, never the barrel) — real Order rows, real eligibility/amount
 * data — combined with a fake `PaymentRepository`, the same two-tier
 * strategy `checkout-order.test.ts` uses for its own Catalog dependency.
 */

async function getOrder(orderId: string) {
  return getOrderByIdCommand(prismaOrderRepository, orderId);
}

const orderIds: string[] = [];

afterAll(async () => {
  if (orderIds.length > 0) {
    await orderPrisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  await orderPrisma.$disconnect();
  await paymentPrisma.$disconnect();
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
  const order = await createOrderCommand(prismaOrderRepository, baseOrderInput(overrides));
  orderIds.push(order.id);
  return order;
}

function makeFakePaymentRepository(): {
  repository: PaymentRepository;
  createCalls: NewPaymentInput[];
} {
  const createCalls: NewPaymentInput[] = [];
  const byOrderId = new Map<string, Payment>();
  let nextId = 0;

  const repository: PaymentRepository = {
    async create(input: NewPaymentInput): Promise<CreatePaymentResult> {
      createCalls.push(input);
      const existing = byOrderId.get(input.orderId);
      if (existing) {
        return { outcome: "duplicate", payment: existing };
      }
      nextId += 1;
      const now = new Date();
      const payment: Payment = {
        id: `fake-payment-${nextId}`,
        orderId: input.orderId,
        status: "PENDING",
        amountMinor: input.amountMinor,
        currency: input.currency,
        providerReference: null,
        createdAt: now,
        updatedAt: now,
      };
      byOrderId.set(input.orderId, payment);
      return { outcome: "created", payment };
    },
    async findById() {
      throw new Error("not used by these tests");
    },
    async findByOrderId() {
      throw new Error("not used by these tests");
    },
    async updateStatusIfCurrent() {
      throw new Error("not used by these tests");
    },
  };

  return { repository, createCalls };
}

describe("initializePayment", () => {
  it("returns ORDER_NOT_FOUND for a nonexistent order, and never calls the repository", async () => {
    const { repository, createCalls } = makeFakePaymentRepository();

    const result = await initializePayment(repository, getOrder, "nonexistent-order-id");

    expect(result).toEqual({ ok: false, error: "ORDER_NOT_FOUND" });
    expect(createCalls).toHaveLength(0);
  });

  it("initializes a PENDING order's Payment with the Order's own amount/currency", async () => {
    const order = await createTestOrder();
    const { repository, createCalls } = makeFakePaymentRepository();

    const result = await initializePayment(repository, getOrder, order.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payment.orderId).toBe(order.id);
    expect(result.payment.status).toBe("PENDING");
    expect(result.payment.amountMinor).toBe(order.totalAmountMinor);
    expect(result.payment.currency).toBe(order.currency);

    expect(createCalls).toEqual([
      { orderId: order.id, amountMinor: order.totalAmountMinor, currency: order.currency },
    ]);
  });

  it("derives amountMinor/currency from the Order even when they differ from any other order (proves no hardcoded value)", async () => {
    const order = await createTestOrder({
      subtotalAmountMinor: 9600,
      deliveryAmountMinor: 1800,
      totalAmountMinor: 11400,
      currency: "USD",
    });
    const { repository, createCalls } = makeFakePaymentRepository();

    const result = await initializePayment(repository, getOrder, order.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payment.amountMinor).toBe(11400);
    expect(createCalls[0]?.amountMinor).toBe(11400);
  });

  it("rejects an already-PAID order with ORDER_ALREADY_PAID, and never calls the repository", async () => {
    const order = await createTestOrder();
    const transition = await changeOrderStatusCommand(prismaOrderRepository, order.id, "PAID");
    expect(transition.ok).toBe(true);

    const { repository, createCalls } = makeFakePaymentRepository();
    const result = await initializePayment(repository, getOrder, order.id);

    expect(result).toEqual({ ok: false, error: "ORDER_ALREADY_PAID" });
    expect(createCalls).toHaveLength(0);
  });

  it("rejects a CANCELLED order with ORDER_CANCELLED, and never calls the repository", async () => {
    const order = await createTestOrder();
    const transition = await changeOrderStatusCommand(prismaOrderRepository, order.id, "CANCELLED");
    expect(transition.ok).toBe(true);

    const { repository, createCalls } = makeFakePaymentRepository();
    const result = await initializePayment(repository, getOrder, order.id);

    expect(result).toEqual({ ok: false, error: "ORDER_CANCELLED" });
    expect(createCalls).toHaveLength(0);
  });

  it("returns PAYMENT_ALREADY_EXISTS with the existing Payment when one already exists for the Order, and does not create a second one", async () => {
    const order = await createTestOrder();
    const { repository } = makeFakePaymentRepository();

    const first = await initializePayment(repository, getOrder, order.id);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await initializePayment(repository, getOrder, order.id);
    expect(second).toEqual({
      ok: false,
      error: "PAYMENT_ALREADY_EXISTS",
      payment: first.payment,
    });
  });

  it("does not mutate Order status when initializing a Payment", async () => {
    const order = await createTestOrder();
    const { repository } = makeFakePaymentRepository();

    const result = await initializePayment(repository, getOrder, order.id);
    expect(result.ok).toBe(true);

    // Re-resolve the Order the same way `initializePayment` itself does —
    // through the real repository — to prove it's still PENDING.
    const refetched = await getOrderByIdCommand(prismaOrderRepository, order.id);
    expect(refetched?.status).toBe("PENDING");
  });
});

/**
 * IMP-032 §13, full pipeline: the real `PaymentRepository` (not the fake
 * used above) alongside the real Order resolution `initializePayment`
 * already uses — the strongest available proof that the *application
 * service*, not just the repository in isolation, is safe under genuine
 * concurrency.
 */
describe("initializePayment — real repository + real concurrency (IMP-032 §13)", () => {
  const paymentOrderIds: string[] = [];

  afterAll(async () => {
    if (paymentOrderIds.length > 0) {
      await orderPrisma.order.deleteMany({ where: { id: { in: paymentOrderIds } } });
    }
    await orderPrisma.$disconnect();
    await paymentPrisma.$disconnect();
  });

  it("two genuinely concurrent initializePayment calls for the same PENDING order produce exactly one Payment", async () => {
    const order = await createOrderCommand(
      prismaOrderRepository,
      baseOrderInput({ email: "payment-race@example.com" }),
    );
    paymentOrderIds.push(order.id);

    const [a, b] = await Promise.all([
      initializePayment(prismaPaymentRepository, getOrder, order.id),
      initializePayment(prismaPaymentRepository, getOrder, order.id),
    ]);

    const results = [a, b];
    const succeeded = results.filter((r) => r.ok);
    const alreadyExists = results.filter((r) => !r.ok && r.error === "PAYMENT_ALREADY_EXISTS");

    expect(succeeded).toHaveLength(1);
    expect(alreadyExists).toHaveLength(1);

    const winnerPaymentId = succeeded[0]!.ok ? succeeded[0]!.payment.id : null;
    const loserPaymentId =
      alreadyExists[0]!.ok === false && alreadyExists[0]!.error === "PAYMENT_ALREADY_EXISTS"
        ? alreadyExists[0]!.payment.id
        : null;
    expect(loserPaymentId).toBe(winnerPaymentId);

    const matching = await paymentPrisma.payment.findMany({ where: { orderId: order.id } });
    expect(matching).toHaveLength(1);
    await paymentPrisma.payment.deleteMany({ where: { orderId: order.id } });
  });

  it("concurrent initializePayment calls for a CANCELLED order never create a Payment", async () => {
    const order = await createOrderCommand(
      prismaOrderRepository,
      baseOrderInput({ email: "payment-race-cancelled@example.com" }),
    );
    paymentOrderIds.push(order.id);
    const cancelled = await changeOrderStatusCommand(prismaOrderRepository, order.id, "CANCELLED");
    expect(cancelled.ok).toBe(true);

    const [a, b] = await Promise.all([
      initializePayment(prismaPaymentRepository, getOrder, order.id),
      initializePayment(prismaPaymentRepository, getOrder, order.id),
    ]);

    for (const result of [a, b]) {
      expect(result).toEqual({ ok: false, error: "ORDER_CANCELLED" });
    }

    const matching = await paymentPrisma.payment.findMany({ where: { orderId: order.id } });
    expect(matching).toHaveLength(0);
  });
});
