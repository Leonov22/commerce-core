import "server-only";
import Stripe from "stripe";

/**
 * Provider-neutral outcome vocabulary for a supported Stripe PaymentIntent
 * event (IMP-039). Deliberately declared independently of
 * `@/modules/payment/domain/payment`'s `PaymentStatus` rather than
 * importing it — this file lives in the Stripe-specific `providers/`
 * boundary, which must not leak Stripe SDK types outward, but the reverse
 * also holds stylistically in this codebase: `providers/` does not reach
 * into `domain/` either (see `payment-provider.ts`'s port, which has "zero
 * dependencies, not even on Payment's own domain module"). The three
 * literal values below are intentionally identical to three of
 * `PaymentStatus`'s four values, so the application layer can use this
 * type wherever a `PaymentStatus` is expected without a translation step —
 * TypeScript's structural typing accepts the narrower union directly.
 */
export type PaymentEventOutcome = "SUCCEEDED" | "FAILED" | "CANCELLED";

export type StripeWebhookEvent =
  | {
      kind: "supported";
      providerEventId: string;
      eventType: string;
      providerReference: string;
      outcome: PaymentEventOutcome;
    }
  | { kind: "ignored"; providerEventId: string; eventType: string };

export type VerifyStripeWebhookResult =
  { ok: true; event: StripeWebhookEvent } | { ok: false; error: "INVALID_SIGNATURE" };

/**
 * The minimum set of Stripe events this milestone supports (Step 3):
 * `payment_intent.succeeded` / `.payment_failed` / `.canceled` map 1:1 onto
 * the three terminal `PaymentStatus` values a Payment can already reach —
 * no new status, no invented business behavior. Every other Stripe event
 * type (this account may be subscribed to many) is safely ignored: it
 * carries no supported internal transition, so there is nothing here to
 * misinterpret it into.
 */
function mapSupportedEvent(
  event: Stripe.Event,
): { providerReference: string; outcome: PaymentEventOutcome } | null {
  switch (event.type) {
    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      return { providerReference: paymentIntent.id, outcome: "SUCCEEDED" };
    }
    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      return { providerReference: paymentIntent.id, outcome: "FAILED" };
    }
    case "payment_intent.canceled": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      return { providerReference: paymentIntent.id, outcome: "CANCELLED" };
    }
    default:
      return null;
  }
}

/**
 * Verifies a raw Stripe webhook delivery and maps it to a provider-neutral
 * shape (Step 4/5). Uses Stripe's own official verification mechanism
 * (`Stripe.webhooks.constructEvent` — a static method; it needs no
 * API-key-authenticated client, since signature verification is a local
 * HMAC check, not a Stripe API call) rather than any hand-rolled
 * cryptography.
 *
 * `rawBody` MUST be the exact, unparsed request body — Stripe's signature
 * is computed over the raw bytes; parsing it (e.g. `JSON.parse` then
 * re-stringifying) can change whitespace/key order and invalidate the
 * signature even for a genuine event. The caller (the webhook route) is
 * responsible for reading the body via a method that does not parse it.
 */
export function verifyStripeWebhookEvent(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
): VerifyStripeWebhookResult {
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
  } catch (error) {
    console.error(
      "[payment/stripe-webhook] signature verification failed",
      error instanceof Error ? error.message : error,
    );
    return { ok: false, error: "INVALID_SIGNATURE" };
  }

  const mapped = mapSupportedEvent(event);
  if (!mapped) {
    return {
      ok: true,
      event: { kind: "ignored", providerEventId: event.id, eventType: event.type },
    };
  }

  return {
    ok: true,
    event: {
      kind: "supported",
      providerEventId: event.id,
      eventType: event.type,
      providerReference: mapped.providerReference,
      outcome: mapped.outcome,
    },
  };
}

/**
 * Composition-boundary accessor (mirrors `getStripePaymentProvider`'s
 * lazy-read-and-throw-if-unset convention exactly): reads
 * `STRIPE_WEBHOOK_SECRET` only when actually needed, not at module-import
 * time, so importing this file never requires the variable to be set.
 */
export function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
  }
  return secret;
}
