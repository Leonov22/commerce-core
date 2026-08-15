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
    providerStartAttemptedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFakePaymentRepository(
  initial: Payment | null,
  options: {
    /** IMP-035-FIX-2 Test 14: simulate the durable claim itself being unavailable (e.g. a database outage). */
    claimProviderStartAttemptThrows?: boolean;
    setProviderReferenceIfPendingThrows?: boolean;
  } = {},
): {
  repository: PaymentRepository;
  setProviderReferenceCalls: { paymentId: string; providerReference: string }[];
  claimProviderStartAttemptCalls: string[];
} {
  let current: Payment | null = initial;
  const setProviderReferenceCalls: { paymentId: string; providerReference: string }[] = [];
  const claimProviderStartAttemptCalls: string[] = [];

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
      if (options.setProviderReferenceIfPendingThrows) {
        throw new Error("simulated local persistence failure");
      }
      setProviderReferenceCalls.push({ paymentId, providerReference });
      // Mirrors the real repository's
      // `WHERE id = ? AND status = 'PENDING' AND providerReference IS NULL`
      // condition exactly.
      if (!current || current.id !== paymentId) return null;
      if (current.status !== "PENDING" || current.providerReference !== null) return null;
      current = { ...current, providerReference, updatedAt: new Date() };
      return current;
    },
    async claimProviderStartAttempt(paymentId: string): Promise<Payment | null> {
      claimProviderStartAttemptCalls.push(paymentId);
      if (options.claimProviderStartAttemptThrows) {
        throw new Error("simulated database unavailable");
      }
      // Mirrors the real repository's
      // `WHERE id = ? AND status = 'PENDING' AND providerStartAttemptedAt IS NULL`
      // condition, followed by an unconditional re-read — see
      // `PaymentRepository.claimProviderStartAttempt`'s own doc comment
      // for why this always returns the current row rather than `null` on
      // a non-match.
      if (!current || current.id !== paymentId) return null;
      if (current.status !== "PENDING") return null;
      if (current.providerStartAttemptedAt === null) {
        current = { ...current, providerStartAttemptedAt: new Date(), updatedAt: new Date() };
      }
      return current;
    },
  };

  return { repository, setProviderReferenceCalls, claimProviderStartAttemptCalls };
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

/**
 * IMP-034-FIX: a provider that actually honors `PaymentProvider`'s
 * idempotency contract — memoized by `paymentId`, so any number of calls
 * sharing a `paymentId` (concurrent races or a retry) resolve to the SAME
 * `providerReference`. Used to prove `processPayment` behaves correctly
 * against a *compliant* provider — the real-world case CR-034-01/
 * CR-034-02 depend on — as opposed to `makeFakePaymentProvider` above,
 * which is deliberately non-compliant (mints a fresh reference every
 * call) and exists only to prove the local database still protects
 * itself regardless of provider behavior.
 */
function makeFakeCompliantPaymentProvider(): {
  provider: PaymentProvider;
  calls: StartPaymentInput[];
} {
  const calls: StartPaymentInput[] = [];
  const referencesByPaymentId = new Map<string, string>();
  let nextId = 0;

  const provider: PaymentProvider = {
    async startPayment(input: StartPaymentInput) {
      calls.push(input);
      const existing = referencesByPaymentId.get(input.paymentId);
      if (existing) {
        return { ok: true, providerReference: existing };
      }
      nextId += 1;
      const providerReference = `compliant-ref-${nextId}`;
      referencesByPaymentId.set(input.paymentId, providerReference);
      return { ok: true, providerReference };
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

  it("the provider receives exactly paymentId, amountMinor, currency, and providerStartAttemptedAt — nothing else", async () => {
    const payment = makePayment({ id: "payment-42", amountMinor: 24800, currency: "USD" });
    const { repository } = makeFakePaymentRepository(payment);
    const { provider, calls } = makeFakePaymentProvider();

    await processPayment(repository, provider, payment.id);

    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]!).sort()).toEqual([
      "amountMinor",
      "currency",
      "paymentId",
      "providerStartAttemptedAt",
    ]);
    expect(calls[0]).toMatchObject({
      paymentId: "payment-42",
      amountMinor: 24800,
      currency: "USD",
    });
    expect(calls[0]?.providerStartAttemptedAt).toBeInstanceOf(Date);
  });

  it("IMP-035-FIX-2: processPayment durably claims a provider-start attempt BEFORE ever calling the provider, and passes it through as providerStartAttemptedAt", async () => {
    const payment = makePayment();
    const { repository, claimProviderStartAttemptCalls } = makeFakePaymentRepository(payment);
    const { provider, calls } = makeFakePaymentProvider();

    await processPayment(repository, provider, payment.id);

    expect(claimProviderStartAttemptCalls).toEqual([payment.id]);
    expect(calls[0]?.providerStartAttemptedAt).toBeInstanceOf(Date);
  });

  it("IMP-035-FIX-2 (Test 14): if the durable first-start claim cannot be established, the provider is never contacted", async () => {
    const payment = makePayment();
    const { repository } = makeFakePaymentRepository(payment, {
      claimProviderStartAttemptThrows: true,
    });
    const { provider, calls } = makeFakePaymentProvider();

    await expect(processPayment(repository, provider, payment.id)).rejects.toThrow(
      "simulated database unavailable",
    );
    expect(calls).toHaveLength(0);
  });

  it("IMP-035-FIX-2 (Tests 4/5/13): a retry after a simulated persistence failure reuses the SAME already-claimed providerStartAttemptedAt, rather than re-claiming a fresh one", async () => {
    const payment = makePayment();
    const { repository } = makeFakePaymentRepository(payment, {
      setProviderReferenceIfPendingThrows: true,
    });
    const { provider, calls } = makeFakeCompliantPaymentProvider();

    // First attempt: the provider succeeds, but local persistence throws
    // (simulating a crash/DB failure between provider success and
    // `setProviderReferenceIfPending`) — `processPayment` itself
    // propagates that failure rather than swallowing it.
    await expect(processPayment(repository, provider, payment.id)).rejects.toThrow(
      "simulated local persistence failure",
    );
    expect(calls).toHaveLength(1);
    const firstAttemptTimestamp = calls[0]?.providerStartAttemptedAt;
    expect(firstAttemptTimestamp).toBeInstanceOf(Date);

    // Retry (simulating the application having restarted): the durable
    // claim from the first attempt is still there and must be reused
    // as-is, not reset/re-claimed with a new timestamp — this is exactly
    // the signal a real provider adapter (see stripe-payment-provider.ts)
    // needs to decide whether it may still trust native idempotency alone.
    await expect(processPayment(repository, provider, payment.id)).rejects.toThrow(
      "simulated local persistence failure",
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]?.providerStartAttemptedAt).toEqual(firstAttemptTimestamp);
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

  it("IMP-034-FIX / CR-034-02: retrying processPayment for the same Payment sends the provider the SAME paymentId, and a compliant provider returns the SAME reference both times", async () => {
    const payment = makePayment();
    const { repository } = makeFakePaymentRepository(payment);
    const { provider, calls } = makeFakeCompliantPaymentProvider();

    const first = await processPayment(repository, provider, payment.id);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Simulates calling processPayment again later — e.g. after a local
    // persistence failure the first time — using the exact same paymentId.
    const retry = await processPayment(repository, provider, payment.id);

    // The provider was asked twice, but both times with the identical
    // paymentId/amountMinor/currency — proving the retry cannot vary the
    // idempotency identity.
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0]?.paymentId).toBe(payment.id);

    // The compliant provider returned the same reference both times, so
    // the "retry" is correctly recognized as PROVIDER_REFERENCE_ALREADY_SET
    // (the first call already attached it) rather than a fresh success —
    // and critically, the reference value matches what was already there.
    expect(retry).toEqual({
      ok: false,
      error: "PROVIDER_REFERENCE_ALREADY_SET",
      payment: first.payment,
    });
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

  it("two genuinely concurrent processPayment calls for the same PENDING Payment produce exactly one persisted provider reference, even against a non-compliant provider (local DB protection, defense in depth)", async () => {
    // Deliberately uses two DIFFERENT (non-compliant) providers, each
    // minting its own reference — the worst case for the LOCAL database
    // guarantee alone. Proves `setProviderReferenceIfPending` protects
    // the persisted row even if a provider were somehow non-compliant;
    // it does not by itself prove only one *external* operation happened
    // (that guarantee comes from the provider contract — see the
    // compliant-provider test below).
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

  it("IMP-034-FIX / CR-034-01: two genuinely concurrent processPayment calls against a SHARED compliant provider both send the identical paymentId/amountMinor/currency, and resolve to the same providerReference", async () => {
    const payment = await createTestPayment();
    const { provider, calls } = makeFakeCompliantPaymentProvider();

    const [a, b] = await Promise.all([
      processPayment(prismaPaymentRepository, provider, payment.id),
      processPayment(prismaPaymentRepository, provider, payment.id),
    ]);

    // Both calls reached the provider — that's expected and acceptable
    // per the architectural contract, not a bug to prevent.
    expect(calls).toHaveLength(2);
    // Both invocations carried the exact same idempotency identity —
    // this is what makes it safe for both to have reached the provider.
    expect(calls[0]).toMatchObject({
      paymentId: payment.id,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
    });
    expect(calls[1]).toEqual(calls[0]);

    const results = [a, b];
    const succeeded = results.filter((r) => r.ok);
    const alreadySet = results.filter((r) => !r.ok && r.error === "PROVIDER_REFERENCE_ALREADY_SET");
    expect(succeeded).toHaveLength(1);
    expect(alreadySet).toHaveLength(1);

    // Because the provider is compliant, BOTH results reference the
    // identical providerReference — the "losing" call's own provider
    // response was never wrong or wasted, it was just redundant.
    const winnerReference = succeeded[0]!.ok ? succeeded[0]!.payment.providerReference : null;
    const loserReference =
      alreadySet[0]!.ok === false && alreadySet[0]!.error === "PROVIDER_REFERENCE_ALREADY_SET"
        ? alreadySet[0]!.payment.providerReference
        : null;
    expect(winnerReference).toBe(loserReference);

    const refetched = await prismaPaymentRepository.findById(payment.id);
    expect(refetched?.providerReference).toBe(winnerReference);
    expect(refetched?.status).toBe("PENDING");
  });

  it("IMP-035-FIX-2 (Tests 3/16): two genuinely concurrent processPayment calls for a brand-new Payment converge on the SAME durably-claimed providerStartAttemptedAt against the real repository", async () => {
    const payment = await createTestPayment();
    expect(payment.providerStartAttemptedAt).toBeNull();

    // Barrier-gated fake provider (same technique as the CR-034 P3 fix):
    // neither call can produce a result until BOTH have arrived at
    // `startPayment`, so the two `processPayment` calls below are
    // structurally guaranteed to have their `claimProviderStartAttempt`
    // calls against the REAL repository genuinely overlap in time too —
    // if they ran sequentially, the second `startPayment` would never be
    // reached and this `Promise.all` would hang instead of resolving.
    const calls: StartPaymentInput[] = [];
    let arrived = 0;
    let releaseLatch: () => void;
    const latch = new Promise<void>((resolve) => {
      releaseLatch = resolve;
    });
    const provider: PaymentProvider = {
      async startPayment(input) {
        calls.push(input);
        arrived += 1;
        if (arrived >= 2) releaseLatch();
        await latch;
        return { ok: true, providerReference: `race-claim-ref-${calls.length}` };
      },
    };

    await Promise.all([
      processPayment(prismaPaymentRepository, provider, payment.id),
      processPayment(prismaPaymentRepository, provider, payment.id),
    ]);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.providerStartAttemptedAt).toBeInstanceOf(Date);
    // The atomic claim in `claimProviderStartAttempt` guarantees exactly
    // one timestamp is ever written for this Payment — both calls must
    // have observed that SAME value, never two different ones.
    expect(calls[1]?.providerStartAttemptedAt).toEqual(calls[0]?.providerStartAttemptedAt);

    const refetched = await prismaPaymentRepository.findById(payment.id);
    expect(refetched?.providerStartAttemptedAt).toEqual(calls[0]?.providerStartAttemptedAt);
  });
});
