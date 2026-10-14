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

/**
 * IMP-041-FIX (PR1-F01/PR1-F03): `status` and `amountReceived` are now
 * independently controllable — `payment_intent.payment_failed` needs a
 * `status` override to exercise both the "still retryable" and
 * "genuinely canceled" branches, and `payment_intent.succeeded` needs
 * `amount_received` (not `amount`) to exercise settlement validation.
 */
function paymentIntentEventPayload(
  type: string,
  paymentIntentId: string,
  options: {
    id?: string;
    status?: string;
    amount?: number;
    amountReceived?: number;
    currency?: string;
  } = {},
): string {
  const amount = options.amount ?? 1000;
  const status =
    options.status ??
    (type === "payment_intent.succeeded"
      ? "succeeded"
      : type === "payment_intent.canceled"
        ? "canceled"
        : "requires_payment_method");
  return JSON.stringify({
    id: options.id ?? "evt_test_1",
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
        amount,
        amount_received: options.amountReceived ?? amount,
        currency: options.currency ?? "usd",
        status,
      },
    },
  });
}

describe("verifyStripeWebhookEvent", () => {
  it("accepts a validly-signed payment_intent.succeeded event and maps it to a SUCCEEDED outcome with its settled amount/currency", () => {
    const payload = paymentIntentEventPayload("payment_intent.succeeded", "pi_123", {
      id: "evt_succeeded",
      amount: 1000,
      amountReceived: 1000,
      currency: "usd",
    });
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
        settledAmountMinor: 1000,
        settledCurrency: "usd",
      },
    });
  });

  it("IMP-041-FIX (PR1-F03): uses amount_received, not amount, as the settled amount — a PaymentIntent whose amount_received diverges from amount is reported with the RECEIVED value", () => {
    const payload = paymentIntentEventPayload("payment_intent.succeeded", "pi_123", {
      id: "evt_succeeded",
      amount: 1000,
      amountReceived: 999,
      currency: "usd",
    });
    const signature = signPayload(payload);

    const result = verifyStripeWebhookEvent(payload, signature, WEBHOOK_SECRET);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event).toMatchObject({ settledAmountMinor: 999 });
  });

  it("IMP-041-FIX (PR1-F01): a payment_intent.payment_failed event whose PaymentIntent remains retryable (status requires_payment_method) maps to retryableFailure, not a terminal outcome", () => {
    const payload = paymentIntentEventPayload("payment_intent.payment_failed", "pi_456", {
      id: "evt_failed",
      status: "requires_payment_method",
    });
    const signature = signPayload(payload);

    const result = verifyStripeWebhookEvent(payload, signature, WEBHOOK_SECRET);

    expect(result).toEqual({
      ok: true,
      event: {
        kind: "retryableFailure",
        providerEventId: "evt_failed",
        eventType: "payment_intent.payment_failed",
        providerReference: "pi_456",
      },
    });
  });

  it.each(["requires_action", "requires_confirmation", "processing", "requires_capture"])(
    "IMP-041-FIX (PR1-F01): a payment_intent.payment_failed event with PaymentIntent status %s is also treated as retryable, never terminal",
    (status) => {
      const payload = paymentIntentEventPayload("payment_intent.payment_failed", "pi_456", {
        id: "evt_failed",
        status,
      });
      const signature = signPayload(payload);

      const result = verifyStripeWebhookEvent(payload, signature, WEBHOOK_SECRET);

      expect(result).toEqual({
        ok: true,
        event: {
          kind: "retryableFailure",
          providerEventId: "evt_failed",
          eventType: "payment_intent.payment_failed",
          providerReference: "pi_456",
        },
      });
    },
  );

  it("IMP-041-FIX (PR1-F01): a payment_intent.payment_failed event whose PaymentIntent has itself been canceled maps to a terminal CANCELLED outcome — never reused as if still payable", () => {
    const payload = paymentIntentEventPayload("payment_intent.payment_failed", "pi_456", {
      id: "evt_failed",
      status: "canceled",
    });
    const signature = signPayload(payload);

    const result = verifyStripeWebhookEvent(payload, signature, WEBHOOK_SECRET);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event).toMatchObject({ kind: "supported", outcome: "CANCELLED" });
  });

  it("accepts a validly-signed payment_intent.canceled event and maps it to a CANCELLED outcome", () => {
    const payload = paymentIntentEventPayload("payment_intent.canceled", "pi_789", {
      id: "evt_canceled",
    });
    const signature = signPayload(payload);

    const result = verifyStripeWebhookEvent(payload, signature, WEBHOOK_SECRET);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event).toMatchObject({
      kind: "supported",
      providerEventId: "evt_canceled",
      eventType: "payment_intent.canceled",
      providerReference: "pi_789",
      outcome: "CANCELLED",
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
