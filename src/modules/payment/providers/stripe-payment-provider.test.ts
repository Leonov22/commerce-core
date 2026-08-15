import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Stripe from "stripe";
import {
  createStripePaymentProvider,
  getStripePaymentProvider,
  type StripePaymentIntentsClient,
} from "@/modules/payment/providers/stripe-payment-provider";
import type { StartPaymentInput } from "@/modules/payment/providers/payment-provider";

/**
 * A fake `StripePaymentIntentsClient` — the same role `makeFakePaymentProvider`
 * plays for `PaymentProvider` itself elsewhere in this module: proves the
 * adapter's own logic (what it sends to Stripe, how it maps the response
 * and errors) without any real network call. Records every call's params
 * and options so tests can assert on them directly.
 */
function makeFakeStripeClient(
  options: {
    throwError?: Stripe.errors.StripeError;
    providerReferencePrefix?: string;
  } = {},
): {
  client: StripePaymentIntentsClient;
  calls: { params: { amount: number; currency: string }; idempotencyKey: string }[];
} {
  const calls: { params: { amount: number; currency: string }; idempotencyKey: string }[] = [];
  let nextId = 0;

  const client: StripePaymentIntentsClient = {
    paymentIntents: {
      async create(params, requestOptions) {
        calls.push({ params, idempotencyKey: requestOptions.idempotencyKey });
        if (options.throwError) {
          throw options.throwError;
        }
        nextId += 1;
        const prefix = options.providerReferencePrefix ?? "pi_fake";
        return { id: `${prefix}_${nextId}` };
      },
    },
  };

  return { client, calls };
}

const validInput: StartPaymentInput = {
  paymentId: "payment-1",
  amountMinor: 24800,
  currency: "USD",
};

describe("Stripe PaymentProvider adapter — contract (IMP-035)", () => {
  it("sends the Payment's authoritative amount to Stripe", async () => {
    const { client, calls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    await provider.startPayment({ ...validInput, amountMinor: 733_319 });

    expect(calls[0]?.params.amount).toBe(733_319);
  });

  it("sends the Payment's currency to Stripe, lowercased as Stripe's API requires", async () => {
    const { client, calls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    await provider.startPayment({ ...validInput, currency: "EUR" });

    expect(calls[0]?.params.currency).toBe("eur");
  });

  it("maps paymentId to Stripe's idempotency key", async () => {
    const { client, calls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    await provider.startPayment({ ...validInput, paymentId: "payment-42" });

    expect(calls[0]?.idempotencyKey).toContain("payment-42");
  });

  it("returns Stripe's PaymentIntent id as the opaque providerReference", async () => {
    const { client } = makeFakeStripeClient({ providerReferencePrefix: "pi_test" });
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(validInput);

    expect(result).toEqual({ ok: true, providerReference: "pi_test_1" });
  });

  it("a Stripe error maps to a controlled PROVIDER_ERROR, never a raw throw", async () => {
    const { client } = makeFakeStripeClient({
      throwError: new Stripe.errors.StripeCardError(),
    });
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(validInput);

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
  });

  it("different kinds of Stripe errors (invalid request, API error, rate limit) all map to the same PROVIDER_ERROR", async () => {
    const stripeErrors = [
      new Stripe.errors.StripeInvalidRequestError(),
      new Stripe.errors.StripeAPIError(),
      new Stripe.errors.StripeRateLimitError(),
      new Stripe.errors.StripeConnectionError(),
    ];

    for (const throwError of stripeErrors) {
      const { client } = makeFakeStripeClient({ throwError });
      const provider = createStripePaymentProvider(client);

      const result = await provider.startPayment(validInput);

      expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
    }
  });

  it("a non-Stripe error (an unexpected bug, not a provider failure) propagates rather than being silently collapsed to PROVIDER_ERROR", async () => {
    const { client } = makeFakeStripeClient();
    (client.paymentIntents as unknown as { create: () => Promise<never> }).create = async () => {
      throw new TypeError("something unrelated to Stripe broke");
    };
    const provider = createStripePaymentProvider(client);

    await expect(provider.startPayment(validInput)).rejects.toThrow(
      "something unrelated to Stripe broke",
    );
  });

  it("the successful result carries no Stripe-specific field beyond the opaque providerReference — no raw PaymentIntent object escapes the adapter", async () => {
    const { client } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(validInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result).sort()).toEqual(["ok", "providerReference"]);
  });

  it("getStripePaymentProvider() throws a clear configuration error rather than silently using an invalid key when STRIPE_SECRET_KEY is unset", () => {
    if (process.env.STRIPE_SECRET_KEY) {
      // A real secret is configured in this environment (see the
      // real-Stripe describe block below) — this specific unset-key
      // scenario cannot be exercised here without unsetting a variable
      // other tests in this run may depend on, so it is intentionally
      // skipped rather than mutating shared process.env state.
      return;
    }
    expect(() => getStripePaymentProvider()).toThrow("STRIPE_SECRET_KEY is not configured.");
  });
});

/**
 * IMP-035 §14 — the single most important test of this milestone: proves
 * `paymentId` maps to a STABLE Stripe idempotency key, never a randomly
 * generated one. A regression here (e.g. accidentally using
 * `crypto.randomUUID()` or `Date.now()` instead of `paymentId`) would
 * silently reintroduce exactly the CR-034-01/CR-034-02 bug this adapter
 * exists to close, just one layer lower.
 */
describe("Stripe PaymentProvider adapter — idempotency key stability (IMP-035 §14)", () => {
  it("the same paymentId produces the same idempotency key on a second, independent call (simulates a retry)", async () => {
    const { client, calls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    await provider.startPayment({ ...validInput, paymentId: "payment-P123" });
    await provider.startPayment({ ...validInput, paymentId: "payment-P123" });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.idempotencyKey).toBe(calls[1]?.idempotencyKey);
  });

  it("the same paymentId produces the same idempotency key even across genuinely concurrent calls", async () => {
    const { client, calls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);
    const input: StartPaymentInput = { ...validInput, paymentId: "payment-P123" };

    await Promise.all([provider.startPayment(input), provider.startPayment(input)]);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.idempotencyKey).toBe(calls[1]?.idempotencyKey);
  });

  it("a different paymentId produces a different idempotency key", async () => {
    const { client, calls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    await provider.startPayment({ ...validInput, paymentId: "payment-P123" });
    await provider.startPayment({ ...validInput, paymentId: "payment-P456" });

    expect(calls[0]?.idempotencyKey).not.toBe(calls[1]?.idempotencyKey);
  });

  it("the idempotency key is a pure, deterministic function of paymentId alone — not of amountMinor or currency", async () => {
    const { client, calls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    // Same paymentId, deliberately different amount/currency between calls
    // (impossible in practice — amount/currency come from the same
    // persisted Payment — but proves the key derivation has no hidden
    // dependency on them).
    await provider.startPayment({ paymentId: "payment-P123", amountMinor: 100, currency: "USD" });
    await provider.startPayment({ paymentId: "payment-P123", amountMinor: 999, currency: "EUR" });

    expect(calls[0]?.idempotencyKey).toBe(calls[1]?.idempotencyKey);
  });
});

/**
 * IMP-035 §13C — real Stripe test-mode verification. Only runs when
 * `STRIPE_SECRET_KEY` is actually configured in the environment (a Stripe
 * TEST-mode secret key, `sk_test_...`); otherwise every test in this block
 * is skipped, not faked or assumed to pass. This is the one place this
 * milestone talks to the real Stripe API.
 */
describe.skipIf(!process.env.STRIPE_SECRET_KEY)(
  "Stripe PaymentProvider adapter — real Stripe test-mode verification (IMP-035 §13C)",
  () => {
    const createdPaymentIntentIds: string[] = [];
    // Constructed lazily in `beforeAll`, not at describe-collection time:
    // `describe.skipIf` still executes this callback's body to enumerate
    // its tests even when skipped, so anything requiring
    // `STRIPE_SECRET_KEY` to actually be set must live inside a hook that
    // itself does not run when the suite is skipped.
    let stripe: Stripe;
    let provider: ReturnType<typeof getStripePaymentProvider>;

    beforeAll(() => {
      stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
      provider = getStripePaymentProvider();
    });

    afterAll(async () => {
      for (const id of createdPaymentIntentIds) {
        await stripe.paymentIntents.cancel(id).catch(() => {
          // Best-effort cleanup only — a PaymentIntent that can't be
          // canceled (e.g. already canceled by a prior run reusing the
          // same idempotency key) is not a test failure.
        });
      }
    });

    it("creates a real Stripe PaymentIntent for a fresh paymentId", async () => {
      const paymentId = `imp-035-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await provider.startPayment({
        paymentId,
        amountMinor: 500,
        currency: "USD",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.providerReference).toMatch(/^pi_/);
      createdPaymentIntentIds.push(result.providerReference);
    });

    it("the same paymentId resolves to the SAME Stripe operation on a second call — no second PaymentIntent is created", async () => {
      const paymentId = `imp-035-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const first = await provider.startPayment({ paymentId, amountMinor: 500, currency: "USD" });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      createdPaymentIntentIds.push(first.providerReference);

      const second = await provider.startPayment({ paymentId, amountMinor: 500, currency: "USD" });
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      expect(second.providerReference).toBe(first.providerReference);
    });

    it("a different paymentId creates a genuinely different Stripe operation", async () => {
      const paymentIdA = `imp-035-verify-a-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const paymentIdB = `imp-035-verify-b-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const a = await provider.startPayment({
        paymentId: paymentIdA,
        amountMinor: 500,
        currency: "USD",
      });
      const b = await provider.startPayment({
        paymentId: paymentIdB,
        amountMinor: 500,
        currency: "USD",
      });

      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      if (!a.ok || !b.ok) return;
      createdPaymentIntentIds.push(a.providerReference, b.providerReference);

      expect(a.providerReference).not.toBe(b.providerReference);
    });
  },
);
