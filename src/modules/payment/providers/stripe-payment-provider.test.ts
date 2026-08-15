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

const ONE_HOUR_MS = 60 * 60 * 1000;
/** Comfortably inside the adapter's native-idempotency safe window. */
const FRESH_ATTEMPT = new Date();
/** Comfortably beyond it — simulates a retry after Stripe may have pruned the idempotency key. */
const STALE_ATTEMPT = new Date(Date.now() - 25 * ONE_HOUR_MS);

/**
 * A fake `StripePaymentIntentsClient` that models Stripe's REAL behavior
 * closely enough to prove the adapter's safety logic, not just its happy
 * path:
 *
 * - `create` honors native idempotency the way Stripe actually does: a
 *   repeated call with the SAME `idempotencyKey` returns a REPLAY of the
 *   ORIGINAL response (just `{ id }`, nothing else — real Stripe does not
 *   re-derive the response from current live state) — unless that key has
 *   been "forgotten" via `forgetIdempotencyKey`, modeling a pruned/expired
 *   key without waiting 24+ hours.
 * - `retrieve` is a SEPARATE, always-live lookup by id — independent of
 *   what `create` last returned — so `cancelPaymentIntent` can simulate a
 *   PaymentIntent being canceled out-of-band (e.g. via the Stripe
 *   dashboard) sometime after creation, exactly the scenario CR-035-FIX-02
 *   exists to handle.
 * - `search` is a separate, independently seedable data source
 *   (`seedSearchResults`) — exactly like real Stripe, where `search`'s
 *   results are NOT automatically kept in sync with `create`/`retrieve`.
 */
function makeFakeStripeClient(): {
  client: StripePaymentIntentsClient;
  createCalls: {
    params: { amount: number; currency: string; metadata: Record<string, string> };
    idempotencyKey: string;
  }[];
  searchCalls: { query: string }[];
  retrieveCalls: string[];
  seedSearchResults: (results: FakePaymentIntent[], options?: { hasMore?: boolean }) => void;
  forgetIdempotencyKey: (idempotencyKey: string) => void;
  cancelPaymentIntent: (id: string) => void;
  setCreateThrows: (error: Stripe.errors.StripeError | undefined) => void;
  setSearchThrows: (error: Stripe.errors.StripeError | undefined) => void;
  setRetrieveThrows: (error: Stripe.errors.StripeError | undefined) => void;
} {
  const createCalls: {
    params: { amount: number; currency: string; metadata: Record<string, string> };
    idempotencyKey: string;
  }[] = [];
  const searchCalls: { query: string }[] = [];
  const retrieveCalls: string[] = [];
  const paymentIntentIdByIdempotencyKey = new Map<string, string>();
  const paymentIntentsById = new Map<string, FakePaymentIntent>();
  let nextId = 0;
  let searchResults: FakePaymentIntent[] = [];
  let searchHasMore = false;
  let createThrows: Stripe.errors.StripeError | undefined;
  let searchThrows: Stripe.errors.StripeError | undefined;
  let retrieveThrows: Stripe.errors.StripeError | undefined;

  const client: StripePaymentIntentsClient = {
    paymentIntents: {
      async search(params) {
        searchCalls.push(params);
        if (searchThrows) throw searchThrows;
        return { data: searchResults, has_more: searchHasMore };
      },
      async retrieve(id) {
        retrieveCalls.push(id);
        if (retrieveThrows) throw retrieveThrows;
        const paymentIntent = paymentIntentsById.get(id);
        if (!paymentIntent) throw new Stripe.errors.StripeInvalidRequestError();
        return { id: paymentIntent.id, status: paymentIntent.status };
      },
      async create(params, requestOptions) {
        createCalls.push({ params, idempotencyKey: requestOptions.idempotencyKey });
        if (createThrows) throw createThrows;
        const existingId = paymentIntentIdByIdempotencyKey.get(requestOptions.idempotencyKey);
        if (existingId) {
          // Real Stripe behavior: a repeated call with a still-remembered
          // idempotency key replays the ORIGINAL response body verbatim —
          // it does not reflect anything that has happened to the object
          // since (e.g. a later cancellation).
          return { id: existingId };
        }
        nextId += 1;
        const created: FakePaymentIntent = {
          id: `pi_fake_${nextId}`,
          amount: params.amount,
          currency: params.currency,
          status: "requires_payment_method",
        };
        paymentIntentIdByIdempotencyKey.set(requestOptions.idempotencyKey, created.id);
        paymentIntentsById.set(created.id, created);
        return { id: created.id };
      },
    },
  };

  return {
    client,
    createCalls,
    searchCalls,
    retrieveCalls,
    seedSearchResults: (results, options) => {
      searchResults = results;
      searchHasMore = options?.hasMore ?? false;
    },
    forgetIdempotencyKey: (idempotencyKey) => {
      paymentIntentIdByIdempotencyKey.delete(idempotencyKey);
    },
    cancelPaymentIntent: (id) => {
      const paymentIntent = paymentIntentsById.get(id);
      if (paymentIntent) paymentIntent.status = "canceled";
    },
    setCreateThrows: (error) => {
      createThrows = error;
    },
    setSearchThrows: (error) => {
      searchThrows = error;
    },
    setRetrieveThrows: (error) => {
      retrieveThrows = error;
    },
  };
}

function freshInput(overrides: Partial<StartPaymentInput> = {}): StartPaymentInput {
  return {
    paymentId: "payment-1",
    amountMinor: 24800,
    currency: "USD",
    providerStartAttemptedAt: FRESH_ATTEMPT,
    ...overrides,
  };
}

function staleInput(overrides: Partial<StartPaymentInput> = {}): StartPaymentInput {
  return {
    paymentId: "payment-1",
    amountMinor: 24800,
    currency: "USD",
    providerStartAttemptedAt: STALE_ATTEMPT,
    ...overrides,
  };
}

describe("Stripe PaymentProvider adapter — contract (IMP-035)", () => {
  it("sends the Payment's authoritative amount to Stripe on creation", async () => {
    const { client, createCalls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    await provider.startPayment(freshInput({ amountMinor: 733_319 }));

    expect(createCalls[0]?.params.amount).toBe(733_319);
  });

  it("sends the Payment's currency to Stripe, lowercased as Stripe's API requires", async () => {
    const { client, createCalls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    await provider.startPayment(freshInput({ currency: "EUR" }));

    expect(createCalls[0]?.params.currency).toBe("eur");
  });

  it("maps paymentId to Stripe's idempotency key", async () => {
    const { client, createCalls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    await provider.startPayment(freshInput({ paymentId: "payment-42" }));

    expect(createCalls[0]?.idempotencyKey).toContain("payment-42");
  });

  it("writes the Payment's stable identity into metadata, and nothing else", async () => {
    const { client, createCalls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    await provider.startPayment(freshInput());

    expect(createCalls[0]?.params.metadata).toEqual({ paymentId: "payment-1" });
  });

  it("returns Stripe's PaymentIntent id as the opaque providerReference", async () => {
    const { client } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(freshInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.providerReference).toMatch(/^pi_fake_/);
  });

  it("a Stripe error on create maps to a controlled PROVIDER_ERROR, never a raw throw", async () => {
    const { client, setCreateThrows } = makeFakeStripeClient();
    setCreateThrows(new Stripe.errors.StripeCardError());
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(freshInput());

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
  });

  it("a Stripe error on retrieve (after create) also maps to a controlled PROVIDER_ERROR", async () => {
    const { client, setRetrieveThrows } = makeFakeStripeClient();
    setRetrieveThrows(new Stripe.errors.StripeConnectionError());
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(freshInput());

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
  });

  it("a Stripe error on search (when reconciliation is required) also maps to a controlled PROVIDER_ERROR", async () => {
    const { client, setSearchThrows } = makeFakeStripeClient();
    setSearchThrows(new Stripe.errors.StripeConnectionError());
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(staleInput());

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

      const result = await provider.startPayment(freshInput());

      expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
    }
  });

  it("a non-Stripe error (an unexpected bug, not a provider failure) propagates rather than being silently collapsed to PROVIDER_ERROR", async () => {
    const { client } = makeFakeStripeClient();
    (client.paymentIntents as unknown as { create: () => Promise<never> }).create = async () => {
      throw new TypeError("something unrelated to Stripe broke");
    };
    const provider = createStripePaymentProvider(client);

    await expect(provider.startPayment(freshInput())).rejects.toThrow(
      "something unrelated to Stripe broke",
    );
  });

  it("the successful result carries no Stripe-specific field beyond the opaque providerReference", async () => {
    const { client } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(freshInput());

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

  it('the adapter module starts with `import "server-only"`, so it cannot be imported into a client bundle', () => {
    const adapterPath = fileURLToPath(new URL("./stripe-payment-provider.ts", import.meta.url));
    const source = readFileSync(adapterPath, "utf-8");
    expect(source.trimStart().startsWith('import "server-only";')).toBe(true);
  });
});

describe("Stripe PaymentProvider adapter — idempotency key stability (IMP-035 §14)", () => {
  it("the same paymentId produces the same idempotency key on a second, independent call", async () => {
    const { client, createCalls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    await provider.startPayment(freshInput({ paymentId: "payment-P123" }));
    await provider.startPayment(freshInput({ paymentId: "payment-P123" }));

    expect(createCalls).toHaveLength(2);
    expect(createCalls[0]?.idempotencyKey).toBe(createCalls[1]?.idempotencyKey);
  });

  it("a different paymentId produces a different idempotency key", async () => {
    const { client, createCalls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    await provider.startPayment(freshInput({ paymentId: "payment-P123" }));
    await provider.startPayment(freshInput({ paymentId: "payment-P456" }));

    expect(createCalls[0]?.idempotencyKey).not.toBe(createCalls[1]?.idempotencyKey);
  });
});

/**
 * IMP-035-FIX-2 (CR-035-FIX-01 / CR-035-FIX-02) — SAFETY OVER LIVENESS.
 * `providerStartAttemptedAt` decides whether native idempotency alone can
 * be trusted (`freshInput`) or whether the adapter must positively
 * reconcile against Stripe and refuse rather than guess (`staleInput`).
 */
describe("Stripe PaymentProvider adapter — safety over liveness (IMP-035-FIX-2)", () => {
  it("within the native-idempotency window: creates directly, without ever calling search", async () => {
    const { client, createCalls, searchCalls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(freshInput());

    expect(result.ok).toBe(true);
    expect(createCalls).toHaveLength(1);
    expect(searchCalls).toHaveLength(0);
  });

  it("repeating the exact same fresh call resolves to the same reference via Stripe's own idempotency-key handling", async () => {
    const { client, createCalls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    const first = await provider.startPayment(freshInput());
    const second = await provider.startPayment(freshInput());

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.providerReference).toBe(first.providerReference);
    expect(createCalls).toHaveLength(2);
  });

  it("genuine concurrency within the safe window: two overlapping calls converge on one PaymentIntent via native idempotency", async () => {
    const { client, createCalls } = makeFakeStripeClient();
    // Barrier-gated `create`, proving genuine overlap the same way
    // payment-provider.test.ts's CR-034 P3 fix does.
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
      provider.startPayment(freshInput()),
      provider.startPayment(freshInput()),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.providerReference).toBe(b.providerReference);
    expect(createCalls).toHaveLength(2);
    expect(createCalls[0]?.idempotencyKey).toBe(createCalls[1]?.idempotencyKey);
  });

  it("beyond the native-idempotency window with an existing live match: reuses it, and never calls create", async () => {
    const { client, createCalls, seedSearchResults } = makeFakeStripeClient();
    seedSearchResults([
      { id: "pi_existing_1", amount: 24800, currency: "usd", status: "requires_payment_method" },
    ]);
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(staleInput());

    expect(result).toEqual({ ok: true, providerReference: "pi_existing_1" });
    expect(createCalls).toHaveLength(0);
  });

  it("MANDATORY (§26 primary acceptance criterion): beyond the native-idempotency window with search finding NOTHING, the adapter refuses rather than creating a second PaymentIntent", async () => {
    // This is the exact CR-035-FIX-01 sequence: a PaymentIntent may or may
    // not already exist in Stripe (a prior local persistence failure lost
    // the reference), the idempotency key can no longer be trusted, and
    // Search reports zero results (either genuinely nothing exists, or —
    // the dangerous case — Search simply hasn't caught up / an outage is
    // in progress). Both possibilities MUST resolve to refusal, never to
    // `create`.
    const { client, createCalls, searchCalls } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(staleInput());

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
    expect(searchCalls).toHaveLength(1);
    expect(createCalls).toHaveLength(0);
  });

  it("beyond the window, multiple matching PaymentIntents fail safely rather than arbitrarily picking one", async () => {
    const { client, createCalls, seedSearchResults } = makeFakeStripeClient();
    seedSearchResults([
      { id: "pi_dup_1", amount: 24800, currency: "usd", status: "requires_payment_method" },
      { id: "pi_dup_2", amount: 24800, currency: "usd", status: "requires_payment_method" },
    ]);
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(staleInput());

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
    expect(createCalls).toHaveLength(0);
  });

  it("beyond the window, a search page reporting has_more is also treated as ambiguous rather than trusting only the first page", async () => {
    const { client, createCalls, seedSearchResults } = makeFakeStripeClient();
    seedSearchResults(
      [{ id: "pi_dup_1", amount: 24800, currency: "usd", status: "requires_payment_method" }],
      { hasMore: true },
    );
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(staleInput());

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
    expect(createCalls).toHaveLength(0);
  });

  it("beyond the window, an amount mismatch on the found PaymentIntent fails safely rather than reusing it", async () => {
    const { client, createCalls, seedSearchResults } = makeFakeStripeClient();
    seedSearchResults([
      { id: "pi_wrong_amount", amount: 999, currency: "usd", status: "requires_payment_method" },
    ]);
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(staleInput());

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
    expect(createCalls).toHaveLength(0);
  });

  it("beyond the window, a currency mismatch on the found PaymentIntent fails safely rather than reusing it", async () => {
    const { client, createCalls, seedSearchResults } = makeFakeStripeClient();
    seedSearchResults([
      {
        id: "pi_wrong_currency",
        amount: 24800,
        currency: "eur",
        status: "requires_payment_method",
      },
    ]);
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(staleInput());

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
    expect(createCalls).toHaveLength(0);
  });

  it("different Payments produce independent Stripe operations", async () => {
    const { client } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    const a = await provider.startPayment(freshInput({ paymentId: "payment-A" }));
    const b = await provider.startPayment(freshInput({ paymentId: "payment-B" }));

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.providerReference).not.toBe(b.providerReference);
  });
});

/**
 * CR-035-FIX-02 — a canceled PaymentIntent must never be silently reused
 * as a valid reference, and must never be silently treated as proof that
 * "nothing exists, safe to create a fresh one" either.
 */
describe("Stripe PaymentProvider adapter — canceled PaymentIntent semantics (CR-035-FIX-02)", () => {
  it("beyond the window, a canceled-only match is treated as unresolved and refuses — it does NOT authorize creating a fresh PaymentIntent", async () => {
    const { client, createCalls, seedSearchResults } = makeFakeStripeClient();
    seedSearchResults([{ id: "pi_dead", amount: 24800, currency: "usd", status: "canceled" }]);
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(staleInput());

    expect(result).toEqual({ ok: false, error: "PROVIDER_ERROR" });
    expect(createCalls).toHaveLength(0);
  });

  it("beyond the window, a canceled match alongside a genuine live match is excluded and does not manufacture a false ambiguous result", async () => {
    const { client, createCalls, seedSearchResults } = makeFakeStripeClient();
    seedSearchResults([
      { id: "pi_dead", amount: 24800, currency: "usd", status: "canceled" },
      { id: "pi_live", amount: 24800, currency: "usd", status: "requires_payment_method" },
    ]);
    const provider = createStripePaymentProvider(client);

    const result = await provider.startPayment(staleInput());

    expect(result).toEqual({ ok: true, providerReference: "pi_live" });
    expect(createCalls).toHaveLength(0);
  });

  it("within the window, an idempotent create() replay whose PaymentIntent has since been canceled out-of-band refuses rather than returning it as valid", async () => {
    const { client, cancelPaymentIntent } = makeFakeStripeClient();
    const provider = createStripePaymentProvider(client);

    const first = await provider.startPayment(freshInput());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Simulates the PaymentIntent being canceled through some other means
    // (e.g. the Stripe dashboard) between the first and second call.
    cancelPaymentIntent(first.providerReference);

    const second = await provider.startPayment(freshInput());

    expect(second).toEqual({ ok: false, error: "PROVIDER_ERROR" });
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
      const result = await provider.startPayment({
        paymentId,
        amountMinor: 500,
        currency: "USD",
        providerStartAttemptedAt: new Date(),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.providerReference).toMatch(/^pi_/);
      createdPaymentIntentIds.push(result.providerReference);
    });

    it("the same paymentId resolves to the SAME Stripe operation on a second call", async () => {
      const paymentId = `imp-035-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const providerStartAttemptedAt = new Date();

      const first = await provider.startPayment({
        paymentId,
        amountMinor: 500,
        currency: "USD",
        providerStartAttemptedAt,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      createdPaymentIntentIds.push(first.providerReference);

      const second = await provider.startPayment({
        paymentId,
        amountMinor: 500,
        currency: "USD",
        providerStartAttemptedAt,
      });
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
        providerStartAttemptedAt: new Date(),
      });
      const b = await provider.startPayment({
        paymentId: paymentIdB,
        amountMinor: 500,
        currency: "USD",
        providerStartAttemptedAt: new Date(),
      });

      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      if (!a.ok || !b.ok) return;
      createdPaymentIntentIds.push(a.providerReference, b.providerReference);

      expect(a.providerReference).not.toBe(b.providerReference);
    });
  },
);
