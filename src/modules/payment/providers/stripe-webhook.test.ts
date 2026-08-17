import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import {
  verifyStripeWebhookEvent,
  getStripeWebhookSecret,
} from "@/modules/payment/providers/stripe-webhook";

const WEBHOOK_SECRET = "whsec_test_secret_for_stripe_webhook_unit_tests";

/**
 * Builds a genuine, validly-signed raw Stripe webhook payload using the
 * SDK's own `Stripe.webhooks.generateTestHeaderString` — the same
 * mechanism Stripe documents for testing webhook handlers, so these tests
 * exercise the real `Stripe.webhooks.constructEvent` signature-verification
 * path rather than a hand-rolled substitute.
 */
function signPayload(payload: string, secret: string = WEBHOOK_SECRET): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret });
}

function paymentIntentEventPayload(
  type: string,
  paymentIntentId: string,
  id = "evt_test_1",
): string {
  return JSON.stringify({
    id,
    object: "event",
    type,
    api_version: "2025-01-01",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    data: {
      object: {
        id: paymentIntentId,
        object: "payment_intent",
        amount: 1000,
        currency: "usd",
        status:
          type === "payment_intent.succeeded"
            ? "succeeded"
            : type === "payment_intent.canceled"
              ? "canceled"
              : "requires_payment_method",
      },
    },
  });
}

describe("verifyStripeWebhookEvent", () => {
  it("accepts a validly-signed payment_intent.succeeded event and maps it to a SUCCEEDED outcome", () => {
    const payload = paymentIntentEventPayload(
      "payment_intent.succeeded",
      "pi_123",
      "evt_succeeded",
    );
    const signature = signPayload(payload);

    const result = verifyStripeWebhookEvent(payload, signature, WEBHOOK_SECRET);

    expect(result).toEqual({
      ok: true,
      event: {
        kind: "supported",
        providerEventId: "evt_succeeded",
        eventType: "payment_intent.succeeded",
        providerReference: "pi_123",
        outcome: "SUCCEEDED",
      },
    });
  });

  it("accepts a validly-signed payment_intent.payment_failed event and maps it to a FAILED outcome", () => {
    const payload = paymentIntentEventPayload(
      "payment_intent.payment_failed",
      "pi_456",
      "evt_failed",
    );
    const signature = signPayload(payload);

    const result = verifyStripeWebhookEvent(payload, signature, WEBHOOK_SECRET);

    expect(result).toEqual({
      ok: true,
      event: {
        kind: "supported",
        providerEventId: "evt_failed",
        eventType: "payment_intent.payment_failed",
        providerReference: "pi_456",
        outcome: "FAILED",
      },
    });
  });

  it("accepts a validly-signed payment_intent.canceled event and maps it to a CANCELLED outcome", () => {
    const payload = paymentIntentEventPayload("payment_intent.canceled", "pi_789", "evt_canceled");
    const signature = signPayload(payload);

    const result = verifyStripeWebhookEvent(payload, signature, WEBHOOK_SECRET);

    expect(result).toEqual({
      ok: true,
      event: {
        kind: "supported",
        providerEventId: "evt_canceled",
        eventType: "payment_intent.canceled",
        providerReference: "pi_789",
        outcome: "CANCELLED",
      },
    });
  });

  it("safely ignores a validly-signed but unsupported event type, without corrupting anything", () => {
    const payload = JSON.stringify({
      id: "evt_unsupported",
      object: "event",
      type: "charge.succeeded",
      api_version: "2025-01-01",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 0,
      request: null,
      data: { object: { id: "ch_123", object: "charge" } },
    });
    const signature = signPayload(payload);

    const result = verifyStripeWebhookEvent(payload, signature, WEBHOOK_SECRET);

    expect(result).toEqual({
      ok: true,
      event: { kind: "ignored", providerEventId: "evt_unsupported", eventType: "charge.succeeded" },
    });
  });

  it("rejects a payload signed with the wrong secret", () => {
    const payload = paymentIntentEventPayload("payment_intent.succeeded", "pi_123");
    const signature = signPayload(payload, "whsec_a_completely_different_secret");

    const result = verifyStripeWebhookEvent(payload, signature, WEBHOOK_SECRET);

    expect(result).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
  });

  it("rejects a missing/empty signature header", () => {
    const payload = paymentIntentEventPayload("payment_intent.succeeded", "pi_123");

    const result = verifyStripeWebhookEvent(payload, "", WEBHOOK_SECRET);

    expect(result).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
  });

  it("rejects a malformed signature header", () => {
    const payload = paymentIntentEventPayload("payment_intent.succeeded", "pi_123");

    const result = verifyStripeWebhookEvent(payload, "not-a-real-signature-header", WEBHOOK_SECRET);

    expect(result).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
  });

  it("rejects a payload that was tampered with after signing", () => {
    const originalPayload = paymentIntentEventPayload("payment_intent.succeeded", "pi_123");
    const signature = signPayload(originalPayload);
    const tamperedPayload = paymentIntentEventPayload("payment_intent.succeeded", "pi_ATTACKER");

    const result = verifyStripeWebhookEvent(tamperedPayload, signature, WEBHOOK_SECRET);

    expect(result).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
  });

  it("never leaks the webhook secret or raw signature into a thrown/logged error message on failure", () => {
    const payload = paymentIntentEventPayload("payment_intent.succeeded", "pi_123");

    // Spy on console.error to inspect exactly what gets logged on a
    // verification failure — the secret must never appear in it.
    const originalConsoleError = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      verifyStripeWebhookEvent(payload, "invalid-signature", WEBHOOK_SECRET);
    } finally {
      console.error = originalConsoleError;
    }

    const serializedLog = JSON.stringify(logged);
    expect(serializedLog).not.toContain(WEBHOOK_SECRET);
  });
});

describe("getStripeWebhookSecret", () => {
  it("throws a clear error when STRIPE_WEBHOOK_SECRET is not configured", () => {
    const original = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      expect(() => getStripeWebhookSecret()).toThrow("STRIPE_WEBHOOK_SECRET is not configured.");
    } finally {
      if (original !== undefined) process.env.STRIPE_WEBHOOK_SECRET = original;
    }
  });

  it("returns the configured secret", () => {
    const original = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_configured_value";
    try {
      expect(getStripeWebhookSecret()).toBe("whsec_configured_value");
    } finally {
      if (original !== undefined) {
        process.env.STRIPE_WEBHOOK_SECRET = original;
      } else {
        delete process.env.STRIPE_WEBHOOK_SECRET;
      }
    }
  });
});
