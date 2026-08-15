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
