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
 * IMP-035-FIX (CR-035-01) adds `search`, verified against the real SDK's
 * `PaymentIntentSearchParams`/`ApiSearchResult` shapes — `search` resolves
 * to `{ data: PaymentIntent[], has_more: boolean }`, and each result's
 * `status`/`amount`/`currency` fields are used for the reconciliation
 * safety checks below.
 */
export interface StripePaymentIntentsClient {
  paymentIntents: {
    create(
      params: { amount: number; currency: string; metadata: Record<string, string> },
      options: { idempotencyKey: string },
    ): Promise<{ id: string }>;
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
 *
 * IMP-035-FIX (CR-035-01): this key remains the FIRST line of defense
 * against duplicate external operations (see the module-level doc comment
 * below for why it is not sufficient BY ITSELF).
 */
function toStripeIdempotencyKey(paymentId: string): string {
  return `payment_${paymentId}`;
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
 * IMP-035-FIX (CR-035-01): looks up any existing Stripe PaymentIntent
 * already associated with `paymentId` via Stripe's metadata search, using
 * the stable identity `startPayment` also writes into every PaymentIntent
 * it creates (see `startPayment` below). Returns:
 *
 * - `{ outcome: "none" }` — no existing PaymentIntent; safe to create one.
 * - `{ outcome: "found", paymentIntent }` — exactly one non-canceled match;
 *   the caller must still validate its amount/currency before reusing it
 *   (see `startPayment`).
 * - `{ outcome: "ambiguous" }` — more than one non-canceled match (or more
 *   matches than fit on a single page, which would itself be abnormal).
 *   Reconciliation cannot safely guess which one is authoritative; the
 *   caller must fail rather than pick one, per the architecture's explicit
 *   requirement not to silently hide a possible duplicate external
 *   payment.
 *
 * `canceled` PaymentIntents are excluded before counting matches: a
 * canceled operation is unambiguously dead and must never be reused as a
 * live reference, and its presence alongside a genuine live match must not
 * manufacture a false "ambiguous" result.
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
 * DURABLE RECONCILIATION BEYOND NATIVE IDEMPOTENCY (IMP-035-FIX / CR-035-01)
 * ═══════════════════════════════════════════════════════════════════════
 * Stripe's `Idempotency-Key` (used below via `toStripeIdempotencyKey`) is
 * only guaranteed to be honored for "at least 24 hours" — Stripe may prune
 * it after that, silently: a `create` call reusing a pruned key does not
 * error, it simply creates a genuinely new PaymentIntent. A caller-supplied
 * `paymentId` retried long after the original attempt (e.g. a Payment
 * whose local `providerReference` write failed and was only retried much
 * later) could therefore create a second external operation, exactly the
 * bug IMP-034-FIX closed for the SHORT/concurrent-call window.
 *
 * `startPayment` closes the remaining gap by treating `Payment.providerReference`
 * (once persisted) as the actual durable source of truth for "does this
 * Payment already have an external operation", and — for the window before
 * that local write happens or when it's lost — reconciling against Stripe
 * itself via `paymentIntents.search`, keyed on a stable `paymentId` value
 * this adapter writes into every PaymentIntent's `metadata` at creation
 * time. This is checked FIRST, before ever calling `create`:
 *
 *   1. Search for a PaymentIntent whose `metadata.paymentId` matches.
 *   2. Exactly one non-canceled match, amount/currency verified: reuse it.
 *   3. No match: fall through to `create` (protected by the idempotency
 *      key exactly as before).
 *   4. More than one match: refuse to guess — `PROVIDER_ERROR`.
 *
 * Why this is safe despite Stripe's own documented warning that "Search"
 * is eventually consistent and unsafe for read-after-write flows (typically
 * caught up in under a minute, per Stripe's docs): the two mechanisms'
 * dangerous windows do not overlap.
 *
 *   - A retry within roughly the first minute after the original `create`
 *     is exactly the window where the idempotency key is guaranteed fresh
 *     (valid for at least 24 hours) — even if `search` hasn't indexed the
 *     PaymentIntent yet and reports no match, the retry falls through to
 *     `create`, which itself returns Stripe's cached result for that key.
 *     No duplicate is created either way.
 *   - A retry long enough after the original attempt for the idempotency
 *     key to plausibly have been pruned (on the order of a day or more) is
 *     also long enough that `search`'s eventual-consistency lag (under a
 *     minute under normal conditions) has certainly resolved.
 *
 * Concurrency (IMP-034-FIX / CR-034-01) is unaffected: two genuinely
 * concurrent `startPayment` calls for a brand-new `paymentId` both search
 * and (most likely) both find nothing yet, then both call `create` with
 * the identical idempotency key — Stripe's synchronous, immediately-
 * consistent idempotency-key handling (not `search`) is what makes that
 * safe, exactly as it did before this fix. `search` never has to be the
 * thing that prevents a concurrent duplicate; it only has to prevent a
 * DELAYED one, and by the time it matters for that, it has had time to
 * catch up.
 *
 * A residual, unavoidable risk remains only in the pathological case where
 * a Stripe-side outage delays `search` indexing for longer than the
 * idempotency key's own retention window — Stripe does not offer a
 * stronger read-after-write guarantee for this exact scenario. This is
 * documented as a known limitation, not silently assumed away.
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
  return {
    async startPayment(input: StartPaymentInput): Promise<StartPaymentResult> {
      try {
        const currency = input.currency.toLowerCase();
        const reconciled = await reconcileExistingPaymentIntent(stripeClient, input.paymentId);

        if (reconciled.outcome === "ambiguous") {
          console.error(
            "[payment/stripe-payment-provider] multiple Stripe PaymentIntents found for paymentId; refusing to guess which one is authoritative",
            { paymentId: input.paymentId },
          );
          return { ok: false, error: "PROVIDER_ERROR" };
        }

        if (reconciled.outcome === "found") {
          const existing = reconciled.paymentIntent;
          // IMP-035-FIX §11: never blindly trust a metadata match — verify
          // the found PaymentIntent actually represents the same payable
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
          return { ok: true, providerReference: existing.id };
        }

        // reconciled.outcome === "none": no existing PaymentIntent found —
        // create one. `metadata.paymentId` is what a later reconciliation
        // search (by this Payment or a concurrent/retried call) matches
        // against; the idempotency key is what protects THIS specific
        // call against being duplicated by a concurrent or near-term
        // retry call before either has had a chance to persist locally or
        // become searchable.
        const paymentIntent = await stripeClient.paymentIntents.create(
          {
            amount: input.amountMinor,
            currency,
            metadata: { paymentId: input.paymentId },
          },
          { idempotencyKey: toStripeIdempotencyKey(input.paymentId) },
        );
        return { ok: true, providerReference: paymentIntent.id };
      } catch (error) {
        // `PaymentProvider.startPayment` must never throw (see the "never
        // throwing" contract test in payment-provider.test.ts) — every
        // Stripe-originated failure (a declined card, an invalid request,
        // a network error, a rate limit, a search failure) is a normal,
        // expected outcome for this port, collapsed to the single
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
