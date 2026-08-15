import "server-only";
import Stripe from "stripe";
import type {
  PaymentProvider,
  StartPaymentInput,
  StartPaymentResult,
} from "@/modules/payment/providers/payment-provider";

/**
 * The minimal slice of the Stripe SDK this adapter actually calls. Verified
 * against the official `stripe` package (v22, current at implementation
 * time) and Stripe's PaymentIntents API docs. `createStripePaymentProvider`
 * depends on this narrow shape rather than the full `Stripe` class, so
 * tests can inject a fake client without constructing a real `Stripe`
 * instance (which requires a syntactically valid secret key).
 *
 * IMP-035-FIX (CR-035-01) added `search`, verified against the real SDK's
 * `PaymentIntentSearchParams`/`ApiSearchResult` shapes. IMP-035-FIX-2 adds
 * `retrieve` — a plain by-ID lookup, NOT part of Stripe's eventually
 * consistent Search API (Stripe's own docs group direct retrieval with
 * `list` as strongly, immediately consistent) — used to confirm a
 * PaymentIntent's CURRENT live status after an idempotent `create` replay,
 * whose response body can otherwise reflect stale, original-request data.
 */
export interface StripePaymentIntentsClient {
  paymentIntents: {
    create(
      params: { amount: number; currency: string; metadata: Record<string, string> },
      options: { idempotencyKey: string },
    ): Promise<{ id: string }>;
    retrieve(id: string): Promise<{ id: string; status: string }>;
    search(params: { query: string }): Promise<{
      data: { id: string; amount: number; currency: string; status: string }[];
      has_more: boolean;
    }>;
  };
}

/**
 * Derives Stripe's idempotency key from `paymentId` — the only input this
 * adapter uses for idempotency, per the `PaymentProvider` contract
 * (IMP-034-FIX): the same `paymentId` always produces the same key, and a
 * different `paymentId` always produces a different one. Nothing here is
 * random or time-based. The prefix exists only to keep this application's
 * payment-start operations in their own namespace within Stripe's
 * per-account idempotency-key space (which is shared across every POST
 * endpoint on the account) — it is derived from `paymentId` alone, so it
 * is exactly as stable as `paymentId` itself.
 */
function toStripeIdempotencyKey(paymentId: string): string {
  return `payment_${paymentId}`;
}

/**
 * Stripe documents its `Idempotency-Key` as honored for "at least 24
 * hours", with no guarantee beyond that — a key MAY be pruned after this
 * point, silently (a `create` reusing a pruned key does not error, it just
 * creates a genuinely new PaymentIntent). This adapter trusts native
 * idempotency alone only while comfortably inside that window; a
 * deliberately conservative margin (4 hours) is subtracted so that clock
 * skew, request latency, or Stripe pruning slightly earlier than its own
 * stated minimum can never push a call across the boundary in the unsafe
 * direction.
 */
const NATIVE_IDEMPOTENCY_SAFE_WINDOW_MS = 20 * 60 * 60 * 1000;

/**
 * IMP-035-FIX-2: whether `startPayment` may trust Stripe's native
 * idempotency key alone, or must instead positively reconcile against
 * Stripe's own records before ever calling `create`. This is the
 * Stripe-specific interpretation of the provider-neutral
 * `StartPaymentInput.providerStartAttemptedAt` timestamp the port
 * documents — see `payment-provider.ts`'s "SAFETY OVER LIVENESS"
 * invariant. A DIFFERENT provider adapter would apply its own retention
 * assumption here; this constant is deliberately private to this file.
 */
function isReconciliationRequired(providerStartAttemptedAt: Date): boolean {
  return Date.now() - providerStartAttemptedAt.getTime() >= NATIVE_IDEMPOTENCY_SAFE_WINDOW_MS;
}

/**
 * Stripe's Search Query Language requires double-quoted string values, with
 * `"` and `\` escaped inside them (verified against Stripe's official
 * search documentation). `paymentId` is a Prisma `cuid()` — alphanumeric
 * only in practice — so this never actually triggers today, but the
 * search query is still built defensively rather than assuming that.
 */
function escapeStripeSearchValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * IMP-035-FIX (CR-035-01), tightened by IMP-035-FIX-2 (CR-035-FIX-01):
 * looks up any existing Stripe PaymentIntent already associated with
 * `paymentId` via Stripe's metadata search, using the stable identity
 * `startPayment` writes into every PaymentIntent it creates. Returns:
 *
 * - `{ outcome: "found", paymentIntent }` — exactly one non-canceled
 *   match; the caller must still validate its amount/currency before
 *   reusing it (see `startPayment`).
 * - `{ outcome: "ambiguous" }` — more than one non-canceled match, or more
 *   matches than fit on a single page (abnormal). Reconciliation cannot
 *   safely guess which one is authoritative.
 * - `{ outcome: "none" }` — no non-canceled match found. IMP-035-FIX-2:
 *   this NO LONGER means "safe to create" — see `startPayment`, which
 *   only calls this function when it cannot otherwise prove safety, and
 *   therefore must treat an empty result as inconclusive, not as a
 *   negative proof.
 *
 * `canceled` PaymentIntents are excluded before counting matches (CR-035-
 * FIX-02): a canceled operation must never be silently reused as if it
 * were live, but its mere presence must also not manufacture a false
 * "ambiguous" result alongside a genuine live match. Search's own returned
 * `status` field reflects Stripe's LATEST value even though the query
 * itself matches against a cached index (per Stripe's documented "Data
 * mismatches" behavior), so this filter is not itself subject to
 * eventual-consistency staleness.
 */
async function reconcileExistingPaymentIntent(
  stripeClient: StripePaymentIntentsClient,
  paymentId: string,
): Promise<
  | { outcome: "none" }
  | { outcome: "found"; paymentIntent: { id: string; amount: number; currency: string } }
  | { outcome: "ambiguous" }
> {
  const query = `metadata["paymentId"]:"${escapeStripeSearchValue(paymentId)}"`;
  const result = await stripeClient.paymentIntents.search({ query });
  const liveMatches = result.data.filter((paymentIntent) => paymentIntent.status !== "canceled");

  if (result.has_more || liveMatches.length > 1) {
    return { outcome: "ambiguous" };
  }
  if (liveMatches.length === 1) {
    return { outcome: "found", paymentIntent: liveMatches[0]! };
  }
  return { outcome: "none" };
}

/**
 * Builds a `PaymentProvider` (IMP-033) backed by Stripe's PaymentIntents API
 * (IMP-035) — the first concrete adapter for the port.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * SAFETY OVER LIVENESS BEYOND NATIVE RETENTION (IMP-035-FIX-2 / CR-035-FIX-01)
 * ═══════════════════════════════════════════════════════════════════════
 * IMP-035-FIX (CR-035-01) added Stripe Search reconciliation, but Code
 * Review correctly rejected it as insufficient on its own: Search is
 * eventually consistent (Stripe's own docs: "unsafe for read-after-write",
 * typically caught up in under a minute, but with NO guarantee during an
 * outage), so "Search found nothing" can never be trusted as PROOF that no
 * PaymentIntent exists — only as a hint. A retry occurring long after the
 * original attempt (once the idempotency key may have been pruned) that
 * relied on an empty Search result to justify `create` could still produce
 * a second, genuinely duplicate PaymentIntent.
 *
 * This function now applies the port's "SAFETY OVER LIVENESS" invariant
 * (see `payment-provider.ts`) explicitly:
 *
 *   `input.providerStartAttemptedAt` (IMP-035-FIX-2) records, durably and
 *   locally, WHEN a start was first attempted for this Payment — it is
 *   ALWAYS set by the time this adapter sees it (`processPayment` claims
 *   it before ever calling this port), so `startPayment` can always
 *   determine one of exactly two states:
 *
 *   1. STILL WITHIN Stripe's native idempotency retention window
 *      (`isReconciliationRequired` returns `false`) — trusting `create`'s
 *      own idempotency-key handling alone is safe, exactly as IMP-035
 *      originally did. `create` is called directly, WITHOUT searching
 *      first (an unnecessary Search call would add latency without
 *      improving safety here).
 *
 *   2. POSSIBLY BEYOND that window (`isReconciliationRequired` returns
 *      `true`) — `create`'s own idempotency key can no longer be trusted
 *      alone. Reconciliation via `search` is attempted, but an EMPTY
 *      result is now treated as INCONCLUSIVE, not as permission to
 *      create: `startPayment` returns `PROVIDER_ERROR` rather than ever
 *      calling `create` in this state. A genuinely fresh Payment can only
 *      ever reach this branch after already having a
 *      `providerStartAttemptedAt` old enough to be suspect, so refusing
 *      here never blocks an actual first-ever payment attempt — see
 *      `processPayment`'s "DURABLE FIRST-START CLAIM" for why state 1
 *      above is reachable for every genuinely new Payment.
 *
 * This closes CR-035-FIX-01: the dangerous sequence (provider succeeds,
 * local persistence fails, key expires, Search temporarily returns zero,
 * retry) now ends in a safe, controlled `PROVIDER_ERROR` — never a second
 * `create` call — because reconciliation being required and inconclusive
 * is a terminal, non-create outcome, not a fallback to native idempotency.
 *
 * Concurrency (IMP-034-FIX / CR-034-01) is preserved: two genuinely
 * concurrent `startPayment` calls for a brand-new Payment both observe the
 * SAME (freshly claimed) `providerStartAttemptedAt` — `processPayment`'s
 * atomic claim guarantees this — so both compute `isReconciliationRequired
 * === false` and both call `create` with the identical idempotency key;
 * Stripe's synchronous idempotency-key handling converges them, exactly as
 * before this fix.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CANCELED PAYMENTINTENT SEMANTICS (CR-035-FIX-02)
 * ═══════════════════════════════════════════════════════════════════════
 * A canceled PaymentIntent must never be silently treated as either (a) a
 * valid reusable reference, or (b) proof that no live PaymentIntent
 * exists, authorizing a fresh `create`. Both branches above now handle
 * this: `reconcileExistingPaymentIntent` excludes canceled matches before
 * counting, so a canceled-only Search result becomes `{ outcome: "none" }`
 * — in the reconciliation-required branch, that is refused exactly like
 * any other empty result, never treated as "safe, nothing exists, create
 * one". In the direct-`create` branch, an idempotent Stripe response can
 * be a REPLAY of an earlier request's body (Stripe's idempotency cache
 * stores the ORIGINAL response, not the object's current live state) —
 * this adapter therefore always `retrieve`s the resulting PaymentIntent's
 * CURRENT status (a strongly consistent, non-Search call) before returning
 * it, and refuses (`PROVIDER_ERROR`) if it is `canceled`.
 *
 * Takes an already-constructed Stripe client (or a fake implementing the
 * same narrow `StripePaymentIntentsClient` shape) rather than constructing
 * one itself, so this function has no environment/credential dependency of
 * its own — see `getStripePaymentProvider` below for the composition-
 * boundary wiring that supplies a real client from `STRIPE_SECRET_KEY`.
 *
 * Only ever creates or reuses a PaymentIntent — never confirms it,
 * attaches a payment method, or does anything that would require a
 * customer-facing flow. The Payment this backs stays `PENDING` regardless
 * of outcome; a future milestone is responsible for turning Stripe's own
 * confirmation (e.g. a webhook) into an actual status transition. Not
 * wired to any transport by this milestone.
 */
export function createStripePaymentProvider(
  stripeClient: StripePaymentIntentsClient,
): PaymentProvider {
  async function reuseIfLive(paymentIntentId: string): Promise<StartPaymentResult> {
    const live = await stripeClient.paymentIntents.retrieve(paymentIntentId);
    if (live.status === "canceled") {
      console.error(
        "[payment/stripe-payment-provider] resolved Stripe PaymentIntent is canceled; refusing to treat it as a valid provider start",
        { paymentIntentId },
      );
      return { ok: false, error: "PROVIDER_ERROR" };
    }
    return { ok: true, providerReference: paymentIntentId };
  }

  return {
    async startPayment(input: StartPaymentInput): Promise<StartPaymentResult> {
      try {
        const currency = input.currency.toLowerCase();

        if (isReconciliationRequired(input.providerStartAttemptedAt)) {
          const reconciled = await reconcileExistingPaymentIntent(stripeClient, input.paymentId);

          if (reconciled.outcome === "ambiguous") {
            console.error(
              "[payment/stripe-payment-provider] multiple Stripe PaymentIntents found for paymentId; refusing to guess which one is authoritative",
              { paymentId: input.paymentId },
            );
            return { ok: false, error: "PROVIDER_ERROR" };
          }

          if (reconciled.outcome === "none") {
            // IMP-035-FIX-2 / CR-035-FIX-01: native idempotency can no
            // longer be trusted, and reconciliation found nothing —
            // SAFETY OVER LIVENESS: an empty Search result never proves a
            // negative, so this does NOT fall through to `create`.
            console.error(
              "[payment/stripe-payment-provider] cannot safely determine whether a Stripe PaymentIntent already exists for this paymentId (native idempotency window elapsed, reconciliation inconclusive); refusing to create a new one",
              { paymentId: input.paymentId },
            );
            return { ok: false, error: "PROVIDER_ERROR" };
          }

          // reconciled.outcome === "found"
          const existing = reconciled.paymentIntent;
          // Never blindly trust a metadata match — verify the found
          // PaymentIntent actually represents the same payable
          // amount/currency as the authoritative Payment before reusing
          // it. A mismatch here would only happen if Stripe metadata were
          // ever reused incorrectly; failing safely is strictly better
          // than silently attaching the wrong external reference.
          if (existing.amount !== input.amountMinor || existing.currency !== currency) {
            console.error(
              "[payment/stripe-payment-provider] existing Stripe PaymentIntent amount/currency does not match the authoritative Payment; refusing to reuse it",
              { paymentId: input.paymentId },
            );
            return { ok: false, error: "PROVIDER_ERROR" };
          }
          // No extra `retrieve` needed here (unlike the direct-`create`
          // path below): `existing.status` already reflects Stripe's
          // LATEST value, not a cached one — Search's query MATCHING can
          // lag, but the fields it returns for a match do not (see
          // `reconcileExistingPaymentIntent`'s own doc comment) — and
          // `reconcileExistingPaymentIntent` has already excluded
          // `canceled` matches before this point is ever reached.
          return { ok: true, providerReference: existing.id };
        }

        // Still within the native idempotency retention window — safe to
        // rely on `create`'s own idempotency-key handling directly,
        // without searching first. `metadata.paymentId` is still written,
        // so a LATER call (once outside this window) can reconcile
        // against it.
        const paymentIntent = await stripeClient.paymentIntents.create(
          {
            amount: input.amountMinor,
            currency,
            metadata: { paymentId: input.paymentId },
          },
          { idempotencyKey: toStripeIdempotencyKey(input.paymentId) },
        );
        // `await` (not a bare `return`) is required here: a rejected
        // promise returned bare from inside this `try` block would bypass
        // the `catch` below entirely (a well-known async/await subtlety),
        // which would defeat the whole point of `reuseIfLive`'s own
        // `retrieve` call being allowed to fail like any other Stripe
        // call.
        return await reuseIfLive(paymentIntent.id);
      } catch (error) {
        // `PaymentProvider.startPayment` must never throw (see the "never
        // throwing" contract test in payment-provider.test.ts) — every
        // Stripe-originated failure (a declined card, an invalid request,
        // a network error, a rate limit, a search/retrieve failure) is a
        // normal, expected outcome for this port, collapsed to the single
        // PROVIDER_ERROR code the contract already defines. Only a
        // genuinely unexpected, non-Stripe error (a bug in this adapter
        // itself) is allowed to propagate.
        if (error instanceof Stripe.errors.StripeError) {
          console.error("[payment/stripe-payment-provider] startPayment failed", error);
          return { ok: false, error: "PROVIDER_ERROR" };
        }
        throw error;
      }
    },
  };
}

let cachedProvider: PaymentProvider | undefined;

/**
 * Composition-boundary factory (IMP-035): the one place in this module
 * that constructs a real `Stripe` client from `process.env.STRIPE_SECRET_KEY`.
 * Deliberately lazy — reading the env var and constructing the client only
 * happens the first time this is called, not at module-import time, so
 * importing this file (or the payment module's `index.ts`, which
 * re-exports it) never requires `STRIPE_SECRET_KEY` to be set. Only code
 * that actually needs to talk to Stripe pays that cost, and only when it
 * does — the same reasoning `@/modules/payment/infrastructure/prisma-client.ts`
 * already applies to `DATABASE_URL`.
 */
export function getStripePaymentProvider(): PaymentProvider {
  if (!cachedProvider) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured.");
    }
    cachedProvider = createStripePaymentProvider(new Stripe(secretKey));
  }
  return cachedProvider;
}
