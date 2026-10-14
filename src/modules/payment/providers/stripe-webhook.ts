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
 * dependencies, not even on Payment's own domain module"). The two literal
 * values below are intentionally identical to two of `PaymentStatus`'s
 * four values, so the application layer can use this type wherever a
 * `PaymentStatus` is expected without a translation step — TypeScript's
 * structural typing accepts the narrower union directly.
 *
 * IMP-041-FIX (PR1-F01): `"FAILED"` was removed from this vocabulary.
 * Stripe's own `PaymentIntent.Status` has no `"failed"` value at all —
 * after a declined payment ATTEMPT, a PaymentIntent normally returns to
 * `requires_payment_method`, fully retryable with a new payment method
 * via the SAME PaymentIntent/`client_secret`, not terminally dead.
 * Mapping `payment_intent.payment_failed` straight to a terminal internal
 * status was therefore wrong: it could permanently block a legitimate
 * subsequent success for the same PaymentIntent. See `mapSupportedEvent`
 * below for how this event is now actually handled.
 */
export type PaymentEventOutcome = "SUCCEEDED" | "CANCELLED";

export type StripeWebhookEvent =
  | {
      kind: "supported";
      providerEventId: string;
      eventType: string;
      providerReference: string;
      outcome: PaymentEventOutcome;
      /**
       * IMP-041-FIX (PR1-F03): only meaningful — and only ever checked —
       * for `outcome: "SUCCEEDED"`. Sourced from Stripe's own
       * `amount_received`/`currency` fields on the event's PaymentIntent,
       * never from `amount` alone: `amount` is merely the amount INTENDED
       * to be collected (set at creation), while `amount_received` is
       * Stripe's own field for what was ACTUALLY collected — the field
       * this repository's installed SDK version (and Stripe's API docs)
       * document as the correct one to verify a settlement against.
       */
      settledAmountMinor: number;
      settledCurrency: string;
    }
  /**
   * IMP-041-FIX (PR1-F01): a `payment_intent.payment_failed` event whose
   * PaymentIntent is still retryable (anything other than `canceled`) —
   * carries no `outcome` at all, because none applies: there is nothing
   * for the application layer to transition. See `mapSupportedEvent`.
   */
  | {
      kind: "retryableFailure";
      providerEventId: string;
      eventType: string;
      providerReference: string;
    }
  | { kind: "ignored"; providerEventId: string; eventType: string };

export type VerifyStripeWebhookResult =
  { ok: true; event: StripeWebhookEvent } | { ok: false; error: "INVALID_SIGNATURE" };

/**
 * The minimum set of Stripe events this milestone supports (Step 3):
 * `payment_intent.succeeded` / `.payment_failed` / `.canceled` map onto
 * the Payment lifecycle — no new status, no invented business behavior.
 * Every other Stripe event type (this account may be subscribed to many)
 * is safely ignored: it carries no supported internal transition, so
 * there is nothing here to misinterpret it into.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RETRYABLE VS. TERMINAL FAILURE (IMP-041-FIX, PR1-F01)
 * ═══════════════════════════════════════════════════════════════════════
 * `payment_intent.payment_failed` reports that ONE payment ATTEMPT
 * failed — not that the PaymentIntent itself is dead. Stripe's event
 * payload (`event.data.object`, the PaymentIntent as of this event)
 * already carries its CURRENT status, so no extra Stripe API call is
 * needed to decide: if that status is `"canceled"`, the PaymentIntent is
 * genuinely terminal (e.g. Stripe auto-canceled it after too many failed
 * attempts or expiration) and this maps to `CANCELLED` — the same
 * terminal outcome `payment_intent.canceled` itself produces, so a
 * canceled PaymentIntent is never left reusable regardless of which event
 * revealed it. Any OTHER status (`requires_payment_method`,
 * `requires_action`, `requires_confirmation`, `processing`,
 * `requires_capture`) means the PaymentIntent is still retryable — this
 * produces `{ kind: "retryableFailure" }`, which the application layer
 * (`process-stripe-webhook-event.ts`) must treat as a pure no-op: the
 * internal Payment stays exactly as it is (still `PENDING`, still
 * holding its existing `client_secret`-backing reference), so the
 * customer's next genuine attempt can still succeed against it.
 */
function mapSupportedEvent(event: Stripe.Event):
  | {
      providerReference: string;
      outcome: PaymentEventOutcome;
      settledAmountMinor: number;
      settledCurrency: string;
    }
  | { providerReference: string; retryable: true }
  | null {
  switch (event.type) {
    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      return {
        providerReference: paymentIntent.id,
        outcome: "SUCCEEDED",
        settledAmountMinor: paymentIntent.amount_received,
        settledCurrency: paymentIntent.currency,
      };
    }
    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      if (paymentIntent.status === "canceled") {
        return {
          providerReference: paymentIntent.id,
          outcome: "CANCELLED",
          settledAmountMinor: paymentIntent.amount_received,
          settledCurrency: paymentIntent.currency,
        };
      }
      // Still retryable — see the doc comment above.
      return { providerReference: paymentIntent.id, retryable: true };
    }
    case "payment_intent.canceled": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      return {
        providerReference: paymentIntent.id,
        outcome: "CANCELLED",
        settledAmountMinor: paymentIntent.amount_received,
        settledCurrency: paymentIntent.currency,
      };
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

  if ("retryable" in mapped) {
    return {
      ok: true,
      event: {
        kind: "retryableFailure",
        providerEventId: event.id,
        eventType: event.type,
        providerReference: mapped.providerReference,
      },
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
      settledAmountMinor: mapped.settledAmountMinor,
      settledCurrency: mapped.settledCurrency,
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
