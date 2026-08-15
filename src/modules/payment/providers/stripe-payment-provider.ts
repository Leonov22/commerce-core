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
 * time) and Stripe's PaymentIntents API docs: `paymentIntents.create`
 * accepts `{ amount, currency }` and a second `{ idempotencyKey }` options
 * argument, and resolves to an object carrying at least `id`.
 * `createStripePaymentProvider` depends on this narrow shape rather than
 * the full `Stripe` class, so tests can inject a fake client without
 * constructing a real `Stripe` instance (which requires a syntactically
 * valid secret key).
 */
export interface StripePaymentIntentsClient {
  paymentIntents: {
    create(
      params: { amount: number; currency: string },
      options: { idempotencyKey: string },
    ): Promise<{ id: string }>;
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
 * Builds a `PaymentProvider` (IMP-033) backed by Stripe's PaymentIntents API
 * (IMP-035) — the first concrete adapter for the port. Verified against
 * Stripe's official idempotent-requests documentation before
 * implementation: Stripe saves the result of the first request made for a
 * given `Idempotency-Key` (kept for at least 24 hours) and returns that
 * same result for any later request reusing the same key with the same
 * parameters — exactly the guarantee `PaymentProvider`'s contract requires
 * of a compliant implementation.
 *
 * Takes an already-constructed Stripe client (or a fake implementing the
 * same narrow `StripePaymentIntentsClient` shape) rather than constructing
 * one itself, so this function has no environment/credential dependency of
 * its own — see `getStripePaymentProvider` below for the composition-
 * boundary wiring that supplies a real client from `STRIPE_SECRET_KEY`.
 *
 * Only creates a PaymentIntent — never confirms it, attaches a payment
 * method, or does anything that would require a customer-facing flow. The
 * Payment this backs stays `PENDING` regardless of outcome; a future
 * milestone is responsible for turning Stripe's own confirmation (e.g. a
 * webhook) into an actual status transition. Not wired to any transport by
 * this milestone.
 */
export function createStripePaymentProvider(
  stripeClient: StripePaymentIntentsClient,
): PaymentProvider {
  return {
    async startPayment(input: StartPaymentInput): Promise<StartPaymentResult> {
      try {
        const paymentIntent = await stripeClient.paymentIntents.create(
          {
            amount: input.amountMinor,
            // Stripe's `currency` parameter is documented as lowercase;
            // the Payment domain stores whatever case the Order snapshot
            // captured (e.g. "USD") and is not changed by this adapter.
            currency: input.currency.toLowerCase(),
          },
          { idempotencyKey: toStripeIdempotencyKey(input.paymentId) },
        );
        return { ok: true, providerReference: paymentIntent.id };
      } catch (error) {
        // `PaymentProvider.startPayment` must never throw (see the "never
        // throwing" contract test in payment-provider.test.ts) — every
        // Stripe-originated failure (a declined card, an invalid request,
        // a network error, a rate limit) is a normal, expected outcome for
        // this port, collapsed to the single PROVIDER_ERROR code the
        // contract already defines. Only a genuinely unexpected, non-Stripe
        // error (a bug in this adapter itself) is allowed to propagate.
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
