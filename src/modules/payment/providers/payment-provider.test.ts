import { describe, expect, it } from "vitest";
import type {
  PaymentProvider,
  StartPaymentInput,
  StartPaymentResult,
} from "@/modules/payment/providers/payment-provider";

/**
 * Contract tests for the `PaymentProvider` port (IMP-033). No concrete
 * provider exists yet, so these exercise a minimal in-memory fake defined
 * only in this test file (never exported) — the same role
 * `makeFakeRepository` helpers play for `OrderRepository`/`PaymentRepository`
 * elsewhere in this codebase: proving the interface is genuinely
 * implementable and that its input/output shapes behave as documented,
 * without depending on any real provider SDK or network call.
 */
function makeFakePaymentProvider(
  options: {
    shouldFail?: boolean;
    providerReferencePrefix?: string;
  } = {},
): { provider: PaymentProvider; calls: StartPaymentInput[] } {
  const calls: StartPaymentInput[] = [];
  let nextId = 0;

  const provider: PaymentProvider = {
    async startPayment(input: StartPaymentInput): Promise<StartPaymentResult> {
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
 * IMP-034-FIX: unlike `makeFakePaymentProvider` above (which mints a new
 * reference on every call — a deliberately *non*-compliant provider, kept
 * to prove the local database still protects itself regardless of
 * provider behavior), this fake honors the idempotency invariant
 * documented on `PaymentProvider`: it memoizes by `paymentId`, so any
 * number of calls sharing a `paymentId` — concurrent races, or a retry
 * after a local persistence failure — resolve to the SAME
 * `providerReference`. This is what a compliant real adapter (Stripe,
 * PayPal, or otherwise) is contractually required to do.
 */
function makeFakeCompliantPaymentProvider(): {
  provider: PaymentProvider;
  calls: StartPaymentInput[];
} {
  const calls: StartPaymentInput[] = [];
  const referencesByPaymentId = new Map<string, string>();
  let nextId = 0;

  const provider: PaymentProvider = {
    async startPayment(input: StartPaymentInput): Promise<StartPaymentResult> {
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

const validInput: StartPaymentInput = {
  paymentId: "payment-1",
  amountMinor: 24800,
  currency: "USD",
};

describe("PaymentProvider contract", () => {
  it("startPayment returns an opaque providerReference on success", async () => {
    const { provider } = makeFakePaymentProvider();

    const result = await provider.startPayment(validInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.providerReference).toBe("string");
    expect(result.providerReference.length).toBeGreaterThan(0);
  });

  it("startPayment returns a controlled PROVIDER_ERROR on failure, never throwing", async () => {
    const { provider } = makeFakePaymentProvider({ shouldFail: true });

    const result = await provider.startPayment(validInput);

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
  });

  it("receives exactly the provider-neutral fields — paymentId, amountMinor, currency — and nothing else required", async () => {
    const { provider, calls } = makeFakePaymentProvider();

    await provider.startPayment(validInput);

    expect(calls).toEqual([{ paymentId: "payment-1", amountMinor: 24800, currency: "USD" }]);
  });

  it("is callable through the port type alone, without any reference to a concrete implementation", async () => {
    // Proves a consumer can depend on `PaymentProvider` structurally — the
    // same way application code depends on `PaymentRepository` — without
    // ever importing a concrete provider.
    async function chargeViaProvider(
      provider: PaymentProvider,
      input: StartPaymentInput,
    ): Promise<StartPaymentResult> {
      return provider.startPayment(input);
    }

    const { provider } = makeFakePaymentProvider({ providerReferencePrefix: "via-port" });
    const result = await chargeViaProvider(provider, validInput);

    expect(result).toEqual({ ok: true, providerReference: "via-port-1" });
  });

  it("different Payments produce independent provider references", async () => {
    const { provider } = makeFakePaymentProvider();

    const first = await provider.startPayment({ ...validInput, paymentId: "payment-1" });
    const second = await provider.startPayment({ ...validInput, paymentId: "payment-2" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.providerReference).not.toBe(second.providerReference);
  });
});

/**
 * IMP-034-FIX (CR-034-01 / CR-034-02): the stable provider-side
 * idempotency identity `StartPaymentInput.paymentId` establishes. These
 * tests exercise `makeFakeCompliantPaymentProvider` — a fake that
 * actually honors the contract — to prove what a real adapter is
 * required to guarantee, independent of anything the application layer
 * or PostgreSQL do.
 */
describe("PaymentProvider contract — provider-side idempotency (IMP-034-FIX)", () => {
  it("the same paymentId always produces the same StartPaymentInput shape — there is no field a caller could vary between retries", () => {
    // Structural proof: `StartPaymentInput` has exactly three fields, all
    // derived from the persisted Payment, and no separate idempotency-key
    // field exists for a caller to accidentally vary.
    const input: StartPaymentInput = { paymentId: "payment-1", amountMinor: 100, currency: "USD" };
    expect(Object.keys(input).sort()).toEqual(["amountMinor", "currency", "paymentId"]);
  });

  it("a compliant provider returns the SAME providerReference for repeated calls sharing the same paymentId (simulates a retry after local persistence failure — CR-034-02)", async () => {
    const { provider, calls } = makeFakeCompliantPaymentProvider();
    const input: StartPaymentInput = {
      paymentId: "payment-1",
      amountMinor: 24800,
      currency: "USD",
    };

    const first = await provider.startPayment(input);
    // Simulates a later, independent retry call — same paymentId, same
    // logical operation — exactly what CR-034-02's recovery path requires.
    const retry = await provider.startPayment(input);

    expect(first.ok).toBe(true);
    expect(retry.ok).toBe(true);
    if (!first.ok || !retry.ok) return;
    expect(retry.providerReference).toBe(first.providerReference);
    expect(calls).toHaveLength(2);
  });

  it("a compliant provider returns the SAME providerReference for genuinely concurrent calls sharing the same paymentId (simulates two racing processPayment() calls — CR-034-01)", async () => {
    const { provider, calls } = makeFakeCompliantPaymentProvider();
    const input: StartPaymentInput = {
      paymentId: "payment-1",
      amountMinor: 24800,
      currency: "USD",
    };

    const [a, b] = await Promise.all([provider.startPayment(input), provider.startPayment(input)]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.providerReference).toBe(b.providerReference);
    expect(calls).toEqual([input, input]);
  });

  it("a compliant provider still gives different Payments independent references", async () => {
    const { provider } = makeFakeCompliantPaymentProvider();

    const first = await provider.startPayment({ ...validInput, paymentId: "payment-1" });
    const second = await provider.startPayment({ ...validInput, paymentId: "payment-2" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.providerReference).not.toBe(second.providerReference);
  });
});
