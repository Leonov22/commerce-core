import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Stripe from "stripe";
import {
  createStripePaymentProvider,
  getStripePaymentProvider,
  type StripePaymentIntentsClient,
} from "@/modules/payment/providers/stripe-payment-provider";
import type { StartPaymentInput } from "@/modules/payment/providers/payment-provider";

type FakePaymentIntent = { id: string; amount: number; currency: string; status: string };

/**
 * A fake `StripePaymentIntentsClient` that models Stripe's REAL behavior
 * closely enough to prove the adapter's reconciliation logic, not just its
 * happy path:
 *
 * - `create` honors native idempotency the way Stripe actually does: a
 *   repeated call with the SAME `idempotencyKey` returns the cached
 *   PaymentIntent rather than creating a new one — UNLESS that key has
 *   been "forgotten" via `forgetIdempotencyKey` below, which models a
 *   pruned/expired key (IMP-035-FIX §7/§9) without waiting 24+ hours.
 * - `search` is a separate, independently seedable data source
 *   (`seedSearchResults`) — exactly like real Stripe, where `search`'s
 *   results are NOT automatically kept in sync with what `create` has
 *   produced (its own eventual-consistency lag is what IMP-035-FIX's
 *   design has to be safe against).
 */
function makeFakeStripeClient(): {
  client: StripePaymentIntentsClient;
  createCalls: {
    params: { amount: number; currency: string; metadata: Record<string, string> };
    idempotencyKey: string;
  }[];
  searchCalls: { query: string }[];
  seedSearchResults: (results: FakePaymentIntent[], options?: { hasMore?: boolean }) => void;
  forgetIdempotencyKey: (idempotencyKey: string) => void;
  setCreateThrows: (error: Stripe.errors.StripeError | undefined) => void;
  setSearchThrows: (error: Stripe.errors.StripeError | undefined) => void;
} {
  const createCalls: {
    params: { amount: number; currency: string; metadata: Record<string, string> };
    idempotencyKey: string;
  }[] = [];
  const searchCalls: { query: string }[] = [];
  const paymentIntentsByIdempotencyKey = new Map<string, FakePaymentIntent>();
  let nextId = 0;
  let searchResults: FakePaymentIntent[] = [];
  let searchHasMore = false;
  let createThrows: Stripe.errors.StripeError | undefined;
  let searchThrows: Stripe.errors.StripeError | undefined;

  const client: StripePaymentIntentsClient = {
    paymentIntents: {
      async search(params) {
        searchCalls.push(params);
        if (searchThrows) throw searchThrows;
        return { data: searchResults, has_more: searchHasMore };
      },
      async create(params, requestOptions) {
        createCalls.push({ params, idempotencyKey: requestOptions.idempotencyKey });
        if (createThrows) throw createThrows;
        const existing = paymentIntentsByIdempotencyKey.get(requestOptions.idempotencyKey);
        if (existing) {
          // Real Stripe behavior: a repeated call with a still-remembered
          // idempotency key returns the ORIGINAL response, ignoring these
          // params entirely.
          return { id: existing.id };
        }
        nextId += 1;
        const created: FakePaymentIntent = {
          id: `pi_fake_${nextId}`,
          amount: params.amount,
          currency: params.currency,
          status: "requires_payment_method",
        };
        paymentIntentsByIdempotencyKey.set(requestOptions.idempotencyKey, created);
        return { id: created.id };
      },
    },
  };

  return {
    client,
    createCalls,
    searchCalls,
    seedSearchResults: (results, options) => {
      searchResults = results;
      searchHasMore = options?.hasMore ?? false;
    },
    forgetIdempotencyKey: (idempotencyKey) => {
      paymentIntentsByIdempotencyKey.delete(idempotencyKey);
    },
    setCreateThrows: (error) => {
      createThrows = error;
    },
    setSearchThrows: (error) => {
      searchThrows = error;
    },
  };
}

const validInput: StartPaymentInput = {
  paymentId: "payment-1",
  amountMinor: 24800,
  currency: "USD",
};

describe("Stripe PaymentProvider adapter — contract (IMP-035)", () => {
  it("sends the Payment's authoritative amount to Stripe on creation", async () => {
    const { client, createCalls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    await provider.startPayment({ ...validInput, amountMinor: 733_319 });

    expect(createCalls[0]?.params.amount).toBe(733_319);
  });

  it("sends the Payment's currency to Stripe, lowercased as Stripe's API requires", async () => {
    const { client, createCalls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    await provider.startPayment({ ...validInput, currency: "EUR" });

    expect(createCalls[0]?.params.currency).toBe("eur");
  });

  it("maps paymentId to Stripe's idempotency key", async () => {
    const { client, createCalls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    await provider.startPayment({ ...validInput, paymentId: "payment-42" });

    expect(createCalls[0]?.idempotencyKey).toContain("payment-42");
  });

  it("returns Stripe's PaymentIntent id as the opaque providerReference", async () => {
    const { client } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(validInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.providerReference).toMatch(/^pi_fake_/);
  });

  it("a Stripe error on create maps to a controlled PROVIDER_ERROR, never a raw throw", async () => {
    const { client, setCreateThrows } = makeFakeStripeClient();
    setCreateThrows(new Stripe.errors.StripeCardError());
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(validInput);

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
  });

  it("a Stripe error on search also maps to a controlled PROVIDER_ERROR", async () => {
    const { client, setSearchThrows } = makeFakeStripeClient();
    setSearchThrows(new Stripe.errors.StripeConnectionError());
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(validInput);

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
  });

  it("different kinds of Stripe errors (card, invalid request, API, rate limit, connection) all map to the same PROVIDER_ERROR", async () => {
    const stripeErrors = [
      new Stripe.errors.StripeCardError(),
      new Stripe.errors.StripeInvalidRequestError(),
      new Stripe.errors.StripeAPIError(),
      new Stripe.errors.StripeRateLimitError(),
      new Stripe.errors.StripeConnectionError(),
    ];

    for (const throwError of stripeErrors) {
      const { client, setCreateThrows } = makeFakeStripeClient();
      setCreateThrows(throwError);
      const provider = createStripePaymentProvider(client);

      const result = await provider.startPayment(validInput);

      expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
    }
  });

  it("a non-Stripe error (an unexpected bug, not a provider failure) propagates rather than being silently collapsed to PROVIDER_ERROR", async () => {
    const { client } = makeFakeStripeClient();
    (client.paymentIntents as unknown as { search: () => Promise<never> }).search = async () => {
      throw new TypeError("something unrelated to Stripe broke");
    };
    const provider = createStripePaymentProvider(client);

    await expect(provider.startPayment(validInput)).rejects.toThrow(
      "something unrelated to Stripe broke",
    );
  });

  it("the successful result carries no Stripe-specific field beyond the opaque providerReference", async () => {
    const { client } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(validInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result).sort()).toEqual(["ok", "providerReference"]);
  });

  it("getStripePaymentProvider() throws a clear configuration error rather than silently using an invalid key when STRIPE_SECRET_KEY is unset", () => {
    if (process.env.STRIPE_SECRET_KEY) {
      return;
    }
    expect(() => getStripePaymentProvider()).toThrow("STRIPE_SECRET_KEY is not configured.");
  });

  it('IMP-035 §18/§15: the adapter module starts with `import "server-only"`, so it cannot be imported into a client bundle', () => {
    const adapterPath = fileURLToPath(new URL("./stripe-payment-provider.ts", import.meta.url));
    const source = readFileSync(adapterPath, "utf-8");
    expect(source.trimStart().startsWith('import "server-only";')).toBe(true);
  });
});

/**
 * IMP-035 §14 — proves `paymentId` maps to a STABLE Stripe idempotency key,
 * never a randomly generated one.
 */
describe("Stripe PaymentProvider adapter — idempotency key stability (IMP-035 §14)", () => {
  it("the same paymentId produces the same idempotency key on a second, independent call", async () => {
    const { client, createCalls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    await provider.startPayment({ ...validInput, paymentId: "payment-P123" });
    await provider.startPayment({ ...validInput, paymentId: "payment-P123" });

    expect(createCalls).toHaveLength(2);
    expect(createCalls[0]?.idempotencyKey).toBe(createCalls[1]?.idempotencyKey);
  });

  it("a different paymentId produces a different idempotency key", async () => {
    const { client, createCalls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    await provider.startPayment({ ...validInput, paymentId: "payment-P123" });
    await provider.startPayment({ ...validInput, paymentId: "payment-P456" });

    expect(createCalls[0]?.idempotencyKey).not.toBe(createCalls[1]?.idempotencyKey);
  });
});

/**
 * IMP-035-FIX (CR-035-01) §17 — durable reconciliation beyond native
 * idempotency-key retention. These are the tests this fix exists for.
 */
describe("Stripe PaymentProvider adapter — durable reconciliation (IMP-035-FIX / CR-035-01)", () => {
  it("A. normal creation: no existing PaymentIntent creates exactly one", async () => {
    const { client, createCalls, searchCalls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(validInput);

    expect(result.ok).toBe(true);
    expect(searchCalls).toHaveLength(1);
    expect(createCalls).toHaveLength(1);
  });

  it("A. the search query targets metadata.paymentId for this specific Payment", async () => {
    const { client, searchCalls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    await provider.startPayment({ ...validInput, paymentId: "payment-abc123" });

    expect(searchCalls[0]?.query).toBe('metadata["paymentId"]:"payment-abc123"');
  });

  it("A. a newly created PaymentIntent carries the Payment's stable identity in metadata, and nothing else", async () => {
    const { client, createCalls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    await provider.startPayment(validInput);

    expect(createCalls[0]?.params.metadata).toEqual({ paymentId: "payment-1" });
  });

  it("B. native idempotency: repeating the exact same call resolves to the same reference via Stripe's own idempotency-key handling", async () => {
    const { client, createCalls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    const first = await provider.startPayment(validInput);
    const second = await provider.startPayment(validInput);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.providerReference).toBe(first.providerReference);
    // Both calls reached `create` (search found nothing yet, in this fake,
    // since it isn't auto-synced with `create`'s results) but Stripe's own
    // idempotency-key handling is what converged them, not reconciliation.
    expect(createCalls).toHaveLength(2);
  });

  it("C. an existing providerReference: reconciliation finds it via search, and no new PaymentIntent is created", async () => {
    const { client, createCalls, seedSearchResults } = makeFakeStripeClient();
    seedSearchResults([
      {
        id: "pi_existing_1",
        amount: validInput.amountMinor,
        currency: "usd",
        status: "requires_payment_method",
      },
    ]);
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(validInput);

    expect(result).toEqual({ ok: true, providerReference: "pi_existing_1" });
    expect(createCalls).toHaveLength(0);
  });

  it("D/E. recovery after local persistence failure, simulating an expired idempotency key: reconciliation finds the original PaymentIntent instead of creating a second one", async () => {
    const { client, createCalls, seedSearchResults, forgetIdempotencyKey } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    // First attempt: Stripe creates a PaymentIntent (simulating: succeeds,
    // but the subsequent local `setProviderReferenceIfPending` write is
    // never actually reached in this test — we only care about Stripe's
    // side here).
    const first = await provider.startPayment(validInput);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(createCalls).toHaveLength(1);

    // Simulates the idempotency key having been pruned by Stripe (>= 24h
    // later) — a repeated `create` with the same key would NOT return the
    // cached PaymentIntent anymore. Also simulates that reconciliation
    // search has since caught up (which, by definition, has had far more
    // than its usual under-a-minute lag to do so by this point).
    forgetIdempotencyKey(`payment_${validInput.paymentId}`);
    seedSearchResults([
      {
        id: first.providerReference,
        amount: validInput.amountMinor,
        currency: "usd",
        status: "requires_payment_method",
      },
    ]);

    const retry = await provider.startPayment(validInput);

    expect(retry).toEqual({ ok: true, providerReference: first.providerReference });
    // create() was never called a second time — reconciliation short-
    // circuited it entirely.
    expect(createCalls).toHaveLength(1);
  });

  it("F. amount mismatch on an existing PaymentIntent fails safely rather than reusing it", async () => {
    const { client, createCalls, seedSearchResults } = makeFakeStripeClient();
    seedSearchResults([
      { id: "pi_wrong_amount", amount: 999, currency: "usd", status: "requires_payment_method" },
    ]);
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(validInput);

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
    expect(createCalls).toHaveLength(0);
  });

  it("G. currency mismatch on an existing PaymentIntent fails safely rather than reusing it", async () => {
    const { client, createCalls, seedSearchResults } = makeFakeStripeClient();
    seedSearchResults([
      {
        id: "pi_wrong_currency",
        amount: validInput.amountMinor,
        currency: "eur",
        status: "requires_payment_method",
      },
    ]);
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(validInput);

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
    expect(createCalls).toHaveLength(0);
  });

  it("H. multiple matching PaymentIntents fail safely rather than arbitrarily picking one", async () => {
    const { client, createCalls, seedSearchResults } = makeFakeStripeClient();
    seedSearchResults([
      {
        id: "pi_dup_1",
        amount: validInput.amountMinor,
        currency: "usd",
        status: "requires_payment_method",
      },
      {
        id: "pi_dup_2",
        amount: validInput.amountMinor,
        currency: "usd",
        status: "requires_payment_method",
      },
    ]);
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(validInput);

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
    expect(createCalls).toHaveLength(0);
  });

  it("H. a search page reporting has_more is also treated as ambiguous rather than trusting only the first page", async () => {
    const { client, createCalls, seedSearchResults } = makeFakeStripeClient();
    seedSearchResults(
      [
        {
          id: "pi_dup_1",
          amount: validInput.amountMinor,
          currency: "usd",
          status: "requires_payment_method",
        },
      ],
      { hasMore: true },
    );
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(validInput);

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
    expect(createCalls).toHaveLength(0);
  });

  it("a canceled PaymentIntent among the matches is excluded and does not manufacture a false ambiguous result", async () => {
    const { client, createCalls, seedSearchResults } = makeFakeStripeClient();
    seedSearchResults([
      { id: "pi_dead", amount: validInput.amountMinor, currency: "usd", status: "canceled" },
      {
        id: "pi_live",
        amount: validInput.amountMinor,
        currency: "usd",
        status: "requires_payment_method",
      },
    ]);
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(validInput);

    expect(result).toEqual({ ok: true, providerReference: "pi_live" });
    expect(createCalls).toHaveLength(0);
  });

  it("a canceled-only match is treated as no existing PaymentIntent, and a fresh one is created", async () => {
    const { client, createCalls, seedSearchResults } = makeFakeStripeClient();
    seedSearchResults([
      { id: "pi_dead", amount: validInput.amountMinor, currency: "usd", status: "canceled" },
    ]);
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(validInput);

    expect(result.ok).toBe(true);
    expect(createCalls).toHaveLength(1);
  });

  it("I. genuine concurrency: two overlapping startPayment calls for the same paymentId converge on one PaymentIntent via native idempotency", async () => {
    const { client, createCalls } = makeFakeStripeClient();
    // A barrier-gated variant of `create`, proving genuine overlap the
    // same way payment-provider.test.ts's CR-034 P3 fix does: neither call
    // can produce a result until BOTH have arrived at `create`, so this
    // test can only pass if the two `startPayment` calls were truly
    // in-flight simultaneously.
    const originalCreate = client.paymentIntents.create.bind(client.paymentIntents);
    let arrived = 0;
    let releaseLatch: () => void;
    const latch = new Promise<void>((resolve) => {
      releaseLatch = resolve;
    });
    client.paymentIntents.create = async (params, options) => {
      arrived += 1;
      if (arrived >= 2) releaseLatch();
      await latch;
      return originalCreate(params, options);
    };
    const provider = createStripePaymentProvider(client);

    const [a, b] = await Promise.all([
      provider.startPayment(validInput),
      provider.startPayment(validInput),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.providerReference).toBe(b.providerReference);
    expect(createCalls).toHaveLength(2);
    expect(createCalls[0]?.idempotencyKey).toBe(createCalls[1]?.idempotencyKey);
  });

  it("J. different Payments produce independent Stripe operations", async () => {
    const { client } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    const a = await provider.startPayment({ ...validInput, paymentId: "payment-A" });
    const b = await provider.startPayment({ ...validInput, paymentId: "payment-B" });

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.providerReference).not.toBe(b.providerReference);
  });
});

/**
 * IMP-035 §13C — real Stripe test-mode verification. Only runs when
 * `STRIPE_SECRET_KEY` is actually configured in the environment (a Stripe
 * TEST-mode secret key, `sk_test_...`); otherwise every test in this block
 * is skipped, not faked or assumed to pass.
 */
describe.skipIf(!process.env.STRIPE_SECRET_KEY)(
  "Stripe PaymentProvider adapter — real Stripe test-mode verification (IMP-035 §13C)",
  () => {
    const createdPaymentIntentIds: string[] = [];
    let stripe: Stripe;
    let provider: ReturnType<typeof getStripePaymentProvider>;

    beforeAll(() => {
      stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
      provider = getStripePaymentProvider();
    });

    afterAll(async () => {
      for (const id of createdPaymentIntentIds) {
        await stripe.paymentIntents.cancel(id).catch(() => {
          // Best-effort cleanup only.
        });
      }
    });

    it("creates a real Stripe PaymentIntent for a fresh paymentId", async () => {
      const paymentId = `imp-035-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await provider.startPayment({ paymentId, amountMinor: 500, currency: "USD" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.providerReference).toMatch(/^pi_/);
      createdPaymentIntentIds.push(result.providerReference);
    });

    it("the same paymentId resolves to the SAME Stripe operation on a second call", async () => {
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
