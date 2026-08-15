import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { processPayment } from "@/modules/payment/application/process-payment";
import type { PaymentRepository } from "@/modules/payment/repositories/payment-repository";
import type {
  PaymentProvider,
  StartPaymentInput,
} from "@/modules/payment/providers/payment-provider";
import type { Payment, PaymentStatus } from "@/modules/payment/domain/payment";
import { prismaPaymentRepository } from "@/modules/payment/infrastructure/prisma-payment-repository";
import { prisma as paymentPrisma } from "@/modules/payment/infrastructure/prisma-client";
import { createOrder as createOrderCommand } from "@/modules/order/application/order-commands";
import { prismaOrderRepository } from "@/modules/order/infrastructure/prisma-order-repository";
import { prisma as orderPrisma } from "@/modules/order/infrastructure/prisma-client";
import type { NewOrderInput } from "@/modules/order/repositories/order-repository";

/**
 * Pure application-layer tests: both `PaymentRepository` and
 * `PaymentProvider` are injected, so fakes are used for both — no Prisma,
 * no real provider, no network. The fake repository genuinely implements
 * `setProviderReferenceIfPending`'s conditional semantics (mirroring the
 * real Prisma `WHERE status = 'PENDING' AND providerReference IS NULL`),
 * not just "always succeed", so these tests can meaningfully exercise the
 * `PROVIDER_REFERENCE_ALREADY_SET` race-loser path. Real-database
 * concurrency coverage lives separately in `prisma-payment-repository.test.ts`
 * and in the real-repository describe block below.
 */

function makePayment(overrides: Partial<Payment> = {}): Payment {
  const now = new Date();
  return {
    id: "payment-1",
    orderId: "order-1",
    status: "PENDING",
    amountMinor: 24800,
    currency: "USD",
    providerReference: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFakePaymentRepository(initial: Payment | null): {
  repository: PaymentRepository;
  setProviderReferenceCalls: { paymentId: string; providerReference: string }[];
} {
  let current: Payment | null = initial;
  const setProviderReferenceCalls: { paymentId: string; providerReference: string }[] = [];

  const repository: PaymentRepository = {
    async create() {
      throw new Error("not used by these tests");
    },
    async findById(paymentId: string): Promise<Payment | null> {
      return current && current.id === paymentId ? current : null;
    },
    async findByOrderId() {
      throw new Error("not used by these tests");
    },
    async updateStatusIfCurrent() {
      throw new Error("not used by these tests");
    },
    async setProviderReferenceIfPending(
      paymentId: string,
      providerReference: string,
    ): Promise<Payment | null> {
      setProviderReferenceCalls.push({ paymentId, providerReference });
      // Mirrors the real repository's
      // `WHERE id = ? AND status = 'PENDING' AND providerReference IS NULL`
      // condition exactly.
      if (!current || current.id !== paymentId) return null;
      if (current.status !== "PENDING" || current.providerReference !== null) return null;
      current = { ...current, providerReference, updatedAt: new Date() };
      return current;
    },
  };

  return { repository, setProviderReferenceCalls };
}

function makeFakePaymentProvider(
  options: { shouldFail?: boolean; providerReferencePrefix?: string } = {},
): { provider: PaymentProvider; calls: StartPaymentInput[] } {
  const calls: StartPaymentInput[] = [];
  let nextId = 0;

  const provider: PaymentProvider = {
    async startPayment(input: StartPaymentInput) {
      calls.push(input);
      if (options.shouldFail) {
        return { ok: false, error: "PROVIDER_ERROR" };
      }
      nextId += 1;
      const prefix = options.providerReferencePrefix ?? "fake-provider-ref";
      return { ok: true, providerReference: `${prefix}-${nextId}` };
    },
  };

  return { provider, calls };
}

describe("processPayment", () => {
  it("returns PAYMENT_NOT_FOUND for a nonexistent Payment, and never calls the provider", async () => {
    const { repository } = makeFakePaymentRepository(null);
    const { provider, calls } = makeFakePaymentProvider();

    const result = await processPayment(repository, provider, "nonexistent-payment-id");

    expect(result).toEqual({ ok: false, error: "PAYMENT_NOT_FOUND" });
    expect(calls).toHaveLength(0);
  });

  it("a PENDING Payment reaches the provider exactly once", async () => {
    const payment = makePayment();
    const { repository } = makeFakePaymentRepository(payment);
    const { provider, calls } = makeFakePaymentProvider();

    const result = await processPayment(repository, provider, payment.id);

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("the provider receives exactly paymentId, amountMinor, and currency — nothing else", async () => {
    const payment = makePayment({ id: "payment-42", amountMinor: 24800, currency: "USD" });
    const { repository } = makeFakePaymentRepository(payment);
    const { provider, calls } = makeFakePaymentProvider();

    await processPayment(repository, provider, payment.id);

    expect(calls).toEqual([{ paymentId: "payment-42", amountMinor: 24800, currency: "USD" }]);
  });

  it("the provider receives the Payment's own authoritative amount/currency, not a hardcoded value", async () => {
    const payment = makePayment({ amountMinor: 733_319, currency: "EUR" });
    const { repository } = makeFakePaymentRepository(payment);
    const { provider, calls } = makeFakePaymentProvider();

    await processPayment(repository, provider, payment.id);

    expect(calls[0]?.amountMinor).toBe(733_319);
    expect(calls[0]?.currency).toBe("EUR");
  });

  it("a successful provider result persists the provider reference, and the Payment stays PENDING (never becomes SUCCEEDED)", async () => {
    const payment = makePayment();
    const { repository } = makeFakePaymentRepository(payment);
    const { provider } = makeFakePaymentProvider({ providerReferencePrefix: "ref" });

    const result = await processPayment(repository, provider, payment.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payment.providerReference).toBe("ref-1");
    expect(result.payment.status).toBe("PENDING");
  });

  it("a successful provider result never changes the persisted amountMinor/currency (the provider cannot replace them)", async () => {
    const payment = makePayment({ amountMinor: 55_500, currency: "GBP" });
    const { repository } = makeFakePaymentRepository(payment);
    const { provider } = makeFakePaymentProvider();

    const result = await processPayment(repository, provider, payment.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payment.amountMinor).toBe(55_500);
    expect(result.payment.currency).toBe("GBP");
  });

  it("a provider error returns a controlled PROVIDER_ERROR result, never a raw throw", async () => {
    const payment = makePayment();
    const { repository } = makeFakePaymentRepository(payment);
    const { provider } = makeFakePaymentProvider({ shouldFail: true });

    const result = await processPayment(repository, provider, payment.id);

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
  });

  it("a provider error does not corrupt the Payment — it remains PENDING with no provider reference, and no repository write is attempted", async () => {
    const payment = makePayment();
    const { repository, setProviderReferenceCalls } = makeFakePaymentRepository(payment);
    const { provider } = makeFakePaymentProvider({ shouldFail: true });

    await processPayment(repository, provider, payment.id);

    expect(setProviderReferenceCalls).toHaveLength(0);
    const stillThere = await repository.findById(payment.id);
    expect(stillThere?.status).toBe("PENDING");
    expect(stillThere?.providerReference).toBeNull();
  });

  describe("terminal Payments are rejected without ever calling the provider", () => {
    const terminalStatuses: PaymentStatus[] = ["SUCCEEDED", "FAILED", "CANCELLED"];

    for (const status of terminalStatuses) {
      it(`rejects a ${status} Payment with PAYMENT_NOT_PENDING`, async () => {
        const payment = makePayment({ status });
        const { repository } = makeFakePaymentRepository(payment);
        const { provider, calls } = makeFakePaymentProvider();

        const result = await processPayment(repository, provider, payment.id);

        expect(result).toEqual({ ok: false, error: "PAYMENT_NOT_PENDING" });
        expect(calls).toHaveLength(0);
      });
    }
  });

  it("a second call after a provider reference is already attached returns PROVIDER_REFERENCE_ALREADY_SET with the current Payment, and does not overwrite the existing reference", async () => {
    const payment = makePayment();
    const { repository } = makeFakePaymentRepository(payment);
    const { provider: firstProvider } = makeFakePaymentProvider({
      providerReferencePrefix: "first",
    });
    const { provider: secondProvider } = makeFakePaymentProvider({
      providerReferencePrefix: "second",
    });

    const first = await processPayment(repository, firstProvider, payment.id);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.payment.providerReference).toBe("first-1");

    const second = await processPayment(repository, secondProvider, payment.id);

    expect(second).toEqual({
      ok: false,
      error: "PROVIDER_REFERENCE_ALREADY_SET",
      payment: first.payment,
    });
    // The original reference must survive untouched.
    const current = await repository.findById(payment.id);
    expect(current?.providerReference).toBe("first-1");
  });

  it("the caller cannot control amount/currency/status: processPayment's signature accepts only a repository, a provider, and a paymentId", async () => {
    // Structural proof, not just a runtime check: `processPayment` has no
    // amount/currency/status/providerReference/user-data parameter at
    // all, so there is nothing for any caller to pass. This test asserts
    // the function's arity directly.
    expect(processPayment.length).toBe(3);
  });
});

/**
 * IMP-034, full pipeline: the real `PaymentRepository` (not the fake used
 * above) with a controllable fake `PaymentProvider` (no real provider
 * exists yet — see IMP-033) — the strongest available proof that
 * `processPayment` itself, not just `setProviderReferenceIfPending` in
 * isolation, is safe under genuine concurrency against real Postgres.
 */
describe("processPayment — real repository + real concurrency (IMP-034)", () => {
  const orderIds: string[] = [];
  const paymentIds: string[] = [];

  afterAll(async () => {
    if (paymentIds.length > 0) {
      await paymentPrisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    }
    if (orderIds.length > 0) {
      await orderPrisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await paymentPrisma.$disconnect();
    await orderPrisma.$disconnect();
  });

  function baseOrderInput(overrides: Partial<NewOrderInput> = {}): NewOrderInput {
    return {
      firstName: "Process",
      lastName: "Payment",
      email: `process-payment-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
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
          unitPriceAmountMinor: 24000,
          quantity: 1,
          lineTotalAmountMinor: 24000,
          currency: "USD",
        },
      ],
      ...overrides,
    };
  }

  async function createTestPayment() {
    const order = await createOrderCommand(prismaOrderRepository, baseOrderInput());
    orderIds.push(order.id);
    const created = await prismaPaymentRepository.create({
      orderId: order.id,
      amountMinor: order.totalAmountMinor,
      currency: order.currency,
    });
    if (created.outcome !== "created") throw new Error("expected a fresh Payment");
    paymentIds.push(created.payment.id);
    return created.payment;
  }

  it("two genuinely concurrent processPayment calls for the same PENDING Payment produce exactly one persisted provider reference", async () => {
    const payment = await createTestPayment();
    const { provider: providerA } = makeFakePaymentProvider({ providerReferencePrefix: "race-a" });
    const { provider: providerB } = makeFakePaymentProvider({ providerReferencePrefix: "race-b" });

    const [a, b] = await Promise.all([
      processPayment(prismaPaymentRepository, providerA, payment.id),
      processPayment(prismaPaymentRepository, providerB, payment.id),
    ]);

    const results = [a, b];
    const succeeded = results.filter((r) => r.ok);
    const alreadySet = results.filter((r) => !r.ok && r.error === "PROVIDER_REFERENCE_ALREADY_SET");

    expect(succeeded).toHaveLength(1);
    expect(alreadySet).toHaveLength(1);

    const winnerReference = succeeded[0]!.ok ? succeeded[0]!.payment.providerReference : null;
    const loserReference =
      alreadySet[0]!.ok === false && alreadySet[0]!.error === "PROVIDER_REFERENCE_ALREADY_SET"
        ? alreadySet[0]!.payment.providerReference
        : null;
    expect(loserReference).toBe(winnerReference);

    const refetched = await prismaPaymentRepository.findById(payment.id);
    expect(refetched?.providerReference).toBe(winnerReference);
    expect(refetched?.status).toBe("PENDING");
  });
});
