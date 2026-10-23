import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { startOrderPayment } from "@/modules/payment/application/start-order-payment";
import type { GetOrderById } from "@/modules/payment/application/initialize-payment";
import type { PaymentRepository } from "@/modules/payment/repositories/payment-repository";
import type {
  PaymentProvider,
  StartPaymentInput,
} from "@/modules/payment/providers/payment-provider";
import type { Payment, PaymentStatus } from "@/modules/payment/domain/payment";
import type { Order } from "@/modules/order/domain/order";
import { prismaPaymentRepository } from "@/modules/payment/infrastructure/prisma-payment-repository";
import { prisma as paymentPrisma } from "@/modules/payment/infrastructure/prisma-client";
import { createOrder as createOrderCommand } from "@/modules/order/application/order-commands";
import { getOrderById as getOrderByIdCommand } from "@/modules/order/application/get-order";
import { prismaOrderRepository } from "@/modules/order/infrastructure/prisma-order-repository";
import { prisma as orderPrisma } from "@/modules/order/infrastructure/prisma-client";
import type { NewOrderInput } from "@/modules/order/repositories/order-repository";

/**
 * Pure application-layer tests: `PaymentRepository`, `PaymentProvider`,
 * and `GetOrderById` are all injected, so fakes are used for all three —
 * mirrors `initialize-payment.test.ts`/`process-payment.test.ts`'s own
 * pattern exactly. `startOrderPayment` itself introduces no new
 * persistence or provider-call shape, so these tests exercise branching
 * only — the underlying primitives' own concurrency/idempotency
 * guarantees are already proven in their own test files.
 */

function makeOrder(overrides: Partial<Order> = {}): Order {
  const now = new Date();
  return {
    id: "order-1",
    status: "PENDING",
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    phone: "+1234567890",
    userId: "user-1",
    subtotalAmountMinor: 24000,
    deliveryAmountMinor: 800,
    totalAmountMinor: 24800,
    currency: "USD",
    createdAt: now,
    updatedAt: now,
    items: [],
    payment: null,
    ...overrides,
  };
}

function makeGetOrder(order: Order | null): GetOrderById {
  return async (orderId: string) => (order && order.id === orderId ? order : null);
}

function makeFakePaymentRepository(initial: Payment | null = null): {
  repository: PaymentRepository;
} {
  let current: Payment | null = initial;
  let nextId = 0;

  const repository: PaymentRepository = {
    async create(input) {
      if (current) {
        return { outcome: "duplicate", payment: current };
      }
      nextId += 1;
      const now = new Date();
      current = {
        id: `payment-${nextId}`,
        orderId: input.orderId,
        status: "PENDING",
        amountMinor: input.amountMinor,
        currency: input.currency,
        providerReference: null,
        providerStartAttemptedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      return { outcome: "created", payment: current };
    },
    async findById(paymentId) {
      return current && current.id === paymentId ? current : null;
    },
    async findByOrderId(orderId) {
      return current && current.orderId === orderId ? current : null;
    },
    async updateStatusIfCurrent(paymentId, expectedStatus, nextStatus) {
      if (!current || current.id !== paymentId || current.status !== expectedStatus) return null;
      current = { ...current, status: nextStatus as PaymentStatus };
      return current;
    },
    async setProviderReferenceIfPending(paymentId, providerReference) {
      if (!current || current.id !== paymentId) return null;
      if (current.status !== "PENDING" || current.providerReference !== null) return null;
      current = { ...current, providerReference };
      return current;
    },
    async claimProviderStartAttempt(paymentId) {
      if (!current || current.id !== paymentId || current.status !== "PENDING") return null;
      if (current.providerStartAttemptedAt === null) {
        current = { ...current, providerStartAttemptedAt: new Date() };
      }
      return current;
    },
    async findByProviderReference(providerReference) {
      return current && current.providerReference === providerReference ? current : null;
    },
  };

  return { repository };
}

function makeFakeProvider(options: { shouldFail?: boolean } = {}): {
  provider: PaymentProvider;
  calls: StartPaymentInput[];
} {
  const calls: StartPaymentInput[] = [];
  const provider: PaymentProvider = {
    async startPayment(input) {
      calls.push(input);
      if (options.shouldFail) {
        return { ok: false, error: "PROVIDER_ERROR" };
      }
      return {
        ok: true,
        providerReference: `pi_${input.paymentId}`,
        clientSecret: `cs_${input.paymentId}`,
      };
    },
  };
  return { provider, calls };
}

describe("startOrderPayment", () => {
  it("returns ORDER_NOT_FOUND for a nonexistent order, and never touches the provider", async () => {
    const { repository } = makeFakePaymentRepository();
    const { provider, calls } = makeFakeProvider();

    const result = await startOrderPayment(repository, provider, makeGetOrder(null), "order-1");

    expect(result).toEqual({ ok: false, error: "ORDER_NOT_FOUND" });
    expect(calls).toHaveLength(0);
  });

  it("returns ORDER_ALREADY_PAID for a PAID order, and never touches the provider", async () => {
    const { repository } = makeFakePaymentRepository();
    const { provider, calls } = makeFakeProvider();
    const order = makeOrder({ status: "PAID" });

    const result = await startOrderPayment(repository, provider, makeGetOrder(order), order.id);

    expect(result).toEqual({ ok: false, error: "ORDER_ALREADY_PAID" });
    expect(calls).toHaveLength(0);
  });

  it("returns ORDER_CANCELLED for a CANCELLED order, and never touches the provider", async () => {
    const { repository } = makeFakePaymentRepository();
    const { provider, calls } = makeFakeProvider();
    const order = makeOrder({ status: "CANCELLED" });

    const result = await startOrderPayment(repository, provider, makeGetOrder(order), order.id);

    expect(result).toEqual({ ok: false, error: "ORDER_CANCELLED" });
    expect(calls).toHaveLength(0);
  });

  it("initializes a fresh Payment for a PENDING order with none yet, and returns a usable clientSecret", async () => {
    const { repository } = makeFakePaymentRepository();
    const { provider, calls } = makeFakeProvider();
    const order = makeOrder();

    const result = await startOrderPayment(repository, provider, makeGetOrder(order), order.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clientSecret).toBe(`cs_${result.payment.id}`);
    expect(result.payment.orderId).toBe(order.id);
    expect(calls).toHaveLength(1);
  });

  it("resumes an existing PENDING Payment (no reference yet) rather than creating a second one", async () => {
    const order = makeOrder();
    const { repository } = makeFakePaymentRepository();
    // Pre-seed an existing Payment for this order via a first call.
    const { provider: firstProvider } = makeFakeProvider();
    const first = await startOrderPayment(repository, firstProvider, makeGetOrder(order), order.id);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const { provider: secondProvider, calls } = makeFakeProvider();
    const second = await startOrderPayment(
      repository,
      secondProvider,
      makeGetOrder(order),
      order.id,
    );

    // Same Payment id both times — never a second Payment for the same Order.
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.payment.id).toBe(first.payment.id);
    // The second call's own provider WAS still contacted (idempotent
    // resume, not a skip) — exactly `processPayment`'s existing contract.
    expect(calls).toHaveLength(1);
  });

  it("returns a usable clientSecret even when PROVIDER_REFERENCE_ALREADY_SET — the 'reuse a valid existing PaymentIntent' path", async () => {
    const order = makeOrder();
    const { repository } = makeFakePaymentRepository();
    const { provider } = makeFakeProvider();

    const first = await startOrderPayment(repository, provider, makeGetOrder(order), order.id);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Retry with the SAME compliant provider (same paymentId -> same
    // providerReference/clientSecret) — simulates a page refresh.
    const retry = await startOrderPayment(repository, provider, makeGetOrder(order), order.id);

    expect(retry).toEqual({ ok: true, payment: first.payment, clientSecret: first.clientSecret });
  });

  it("returns PAYMENT_NOT_PENDING when the existing Payment already reached a terminal status", async () => {
    const order = makeOrder();
    const { repository } = makeFakePaymentRepository();
    const { provider: firstProvider } = makeFakeProvider();
    const first = await startOrderPayment(repository, firstProvider, makeGetOrder(order), order.id);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Simulate the IMP-039 webhook having already settled this Payment —
    // Order.status may not have caught up yet (its own documented
    // consistency window), so `initializePayment` still resolves this
    // Payment via PAYMENT_ALREADY_EXISTS rather than ORDER_ALREADY_PAID.
    await repository.updateStatusIfCurrent(first.payment.id, "PENDING", "SUCCEEDED");

    const { provider: secondProvider } = makeFakeProvider();
    const result = await startOrderPayment(
      repository,
      secondProvider,
      makeGetOrder(order),
      order.id,
    );

    expect(result).toEqual({
      ok: false,
      error: "PAYMENT_NOT_PENDING",
      payment: expect.objectContaining({ status: "SUCCEEDED" }),
    });
  });

  it("IMP-041: PAYMENT_NOT_PENDING distinguishes a FAILED Payment from a SUCCEEDED one via the returned payment", async () => {
    const order = makeOrder();
    const { repository } = makeFakePaymentRepository();
    const { provider: firstProvider } = makeFakeProvider();
    const first = await startOrderPayment(repository, firstProvider, makeGetOrder(order), order.id);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    await repository.updateStatusIfCurrent(first.payment.id, "PENDING", "FAILED");

    const { provider: secondProvider } = makeFakeProvider();
    const result = await startOrderPayment(
      repository,
      secondProvider,
      makeGetOrder(order),
      order.id,
    );

    expect(result).toEqual({
      ok: false,
      error: "PAYMENT_NOT_PENDING",
      payment: expect.objectContaining({ status: "FAILED" }),
    });
  });

  it("IMP-041-FIX (PR1-F02): a Payment that races to a terminal status mid-flight is never reported as a usable success — the API-level result correctly maps to PAYMENT_NOT_PENDING", async () => {
    // Mirrors `process-payment.test.ts`'s own deterministic PR1-F02 test,
    // one layer up: proves the customer-facing `StartOrderPaymentResult`
    // itself — not just the underlying `ProcessPaymentResult` — never
    // leaks a usable clientSecret for a Payment that settled to a
    // terminal status in the gap between the provider's response and the
    // conditional provider-reference persistence.
    const order = makeOrder();
    const existingPayment: Payment = {
      id: "payment-1",
      orderId: order.id,
      status: "PENDING",
      amountMinor: order.totalAmountMinor,
      currency: order.currency,
      providerReference: "pi_abc",
      providerStartAttemptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { repository } = makeFakePaymentRepository(existingPayment);
    const provider: PaymentProvider = {
      async startPayment() {
        await repository.updateStatusIfCurrent("payment-1", "PENDING", "CANCELLED");
        return { ok: true, providerReference: "pi_abc", clientSecret: "cs_abc" };
      },
    };

    const result = await startOrderPayment(repository, provider, makeGetOrder(order), order.id);

    expect(result).toEqual({
      ok: false,
      error: "PAYMENT_NOT_PENDING",
      payment: expect.objectContaining({ status: "CANCELLED", providerReference: "pi_abc" }),
    });
  });

  it("propagates PROVIDER_ERROR when the provider fails, and persists nothing", async () => {
    const order = makeOrder();
    const { repository } = makeFakePaymentRepository();
    const { provider } = makeFakeProvider({ shouldFail: true });

    const result = await startOrderPayment(repository, provider, makeGetOrder(order), order.id);

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
    const payment = await repository.findByOrderId(order.id);
    expect(payment?.providerReference).toBeNull();
  });
});

/**
 * Real repository + real concurrency (IMP-041), mirroring
 * `process-payment.test.ts`'s own "real repository + real concurrency"
 * section: `startOrderPayment` itself introduces no new persistence, but
 * this is the explicit verification requirement IMP-041 asks for
 * ("Payment initialization is safe under retries and concurrent
 * requests") exercised through the actual customer-facing combinator —
 * not just its underlying primitives in isolation.
 */
describe("startOrderPayment — real repository + real concurrency (IMP-041)", () => {
  const orderIds: string[] = [];

  afterAll(async () => {
    if (orderIds.length > 0) {
      await paymentPrisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await orderPrisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await paymentPrisma.$disconnect();
    await orderPrisma.$disconnect();
  });

  function baseOrderInput(overrides: Partial<NewOrderInput> = {}): NewOrderInput {
    return {
      firstName: "Start",
      lastName: "Payment",
      email: `start-order-payment-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      phone: "+421900123456",
      userId: null,
      subtotalAmountMinor: 24000,
      deliveryAmountMinor: 800,
      totalAmountMinor: 24800,
      currency: "USD",
      items: [
        {
          productId: "1",
          productName: "Studio Chair",
          regularUnitPriceAmountMinor: 24000,
          unitPriceAmountMinor: 24000,
          quantity: 1,
          lineTotalAmountMinor: 24000,
          currency: "USD",
        },
      ],
      ...overrides,
    };
  }

  const realGetOrder: GetOrderById = (orderId) =>
    getOrderByIdCommand(prismaOrderRepository, orderId);

  it("two genuinely concurrent startOrderPayment calls for a brand-new Order produce exactly one Payment and one persisted provider reference", async () => {
    const order = await createOrderCommand(prismaOrderRepository, baseOrderInput());
    orderIds.push(order.id);
    const { provider: providerA } = makeFakeProvider();
    const { provider: providerB } = makeFakeProvider();

    const [a, b] = await Promise.all([
      startOrderPayment(prismaPaymentRepository, providerA, realGetOrder, order.id),
      startOrderPayment(prismaPaymentRepository, providerB, realGetOrder, order.id),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // Both calls resolved to the SAME Payment — never a second one for
    // the same Order (Postgres's own unique constraint on
    // `Payment.orderId`, exercised through the actual customer-facing
    // combinator, not just `initializePayment` in isolation).
    expect(a.payment.id).toBe(b.payment.id);

    const persisted = await prismaPaymentRepository.findByOrderId(order.id);
    expect(persisted?.status).toBe("PENDING");
    expect(persisted?.providerReference).not.toBeNull();
  });

  it("repeated startOrderPayment calls for the same Order never create a second Payment or duplicate charge", async () => {
    const order = await createOrderCommand(prismaOrderRepository, baseOrderInput());
    orderIds.push(order.id);
    const { provider } = makeFakeProvider();

    const first = await startOrderPayment(
      prismaPaymentRepository,
      provider,
      realGetOrder,
      order.id,
    );
    const second = await startOrderPayment(
      prismaPaymentRepository,
      provider,
      realGetOrder,
      order.id,
    );
    const third = await startOrderPayment(
      prismaPaymentRepository,
      provider,
      realGetOrder,
      order.id,
    );

    expect(first.ok && second.ok && third.ok).toBe(true);
    if (!first.ok || !second.ok || !third.ok) return;
    expect(second.payment.id).toBe(first.payment.id);
    expect(third.payment.id).toBe(first.payment.id);

    const allPaymentsForOrder = await paymentPrisma.payment.findMany({
      where: { orderId: order.id },
    });
    expect(allPaymentsForOrder).toHaveLength(1);
  });
});
