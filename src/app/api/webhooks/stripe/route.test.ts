import { describe, expect, it, vi } from "vitest";

/**
 * Mirrors `api/orders/route.test.ts`'s CR029-03 pattern exactly: importing
 * `route.ts` directly under Vitest would otherwise transitively evaluate
 * `@/modules/payment/index.ts`, which imports `@/modules/order`'s barrel —
 * and that barrel re-exports `.tsx` presentation components this project's
 * Vitest config has no JSX transform for. `vi.mock` replaces
 * `@/modules/payment` before `route.ts` loads, so the real (JSX-containing)
 * chain is never evaluated — this lets the real route handler run under
 * test without introducing any new testing framework or dependency.
 */
const { mockProcessStripeWebhookEvent } = vi.hoisted(() => ({
  mockProcessStripeWebhookEvent: vi.fn(),
}));

vi.mock("@/modules/payment", () => ({
  processStripeWebhookEvent: mockProcessStripeWebhookEvent,
}));

const webhookRouteModule = await import("@/app/api/webhooks/stripe/route");
const { POST } = webhookRouteModule;

function makeRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

describe("POST /api/webhooks/stripe", () => {
  it("returns 400 MISSING_SIGNATURE and never calls processStripeWebhookEvent when the Stripe-Signature header is absent", async () => {
    mockProcessStripeWebhookEvent.mockClear();
    const request = makeRequest('{"id":"evt_1"}');

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "MISSING_SIGNATURE" });
    expect(mockProcessStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it("passes the exact raw body and signature header through to processStripeWebhookEvent, unmodified", async () => {
    mockProcessStripeWebhookEvent.mockClear();
    mockProcessStripeWebhookEvent.mockResolvedValueOnce({ outcome: "applied" });
    const rawBody = '{"id":"evt_1","type":"payment_intent.succeeded"}';
    const request = makeRequest(rawBody, { "stripe-signature": "t=1,v1=abc" });

    await POST(request);

    expect(mockProcessStripeWebhookEvent).toHaveBeenCalledWith(rawBody, "t=1,v1=abc");
  });

  it("returns 400 INVALID_SIGNATURE when processStripeWebhookEvent reports invalidSignature", async () => {
    mockProcessStripeWebhookEvent.mockClear();
    mockProcessStripeWebhookEvent.mockResolvedValueOnce({ outcome: "invalidSignature" });
    const request = makeRequest("body", { "stripe-signature": "bad" });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_SIGNATURE" });
  });

  it.each([
    "ignored",
    "unknownPayment",
    "conflict",
    "applied",
    "alreadyAtTarget",
    "retryableFailure",
    "amountMismatch",
  ])("returns 200 { received: true } for outcome %s — Stripe must not retry", async (outcome) => {
    mockProcessStripeWebhookEvent.mockClear();
    mockProcessStripeWebhookEvent.mockResolvedValueOnce({ outcome });
    const request = makeRequest("body", { "stripe-signature": "sig" });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
  });

  it("returns 500 INTERNAL_ERROR and never leaks the underlying error when processing throws", async () => {
    mockProcessStripeWebhookEvent.mockClear();
    mockProcessStripeWebhookEvent.mockRejectedValueOnce(
      new Error("simulated database connection failure with a secret-looking value"),
    );
    const request = makeRequest("body", { "stripe-signature": "sig" });

    const response = await POST(request);

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toEqual({ error: "INTERNAL_ERROR" });
    expect(JSON.stringify(json)).not.toContain("secret-looking value");
  });

  it("never calls getCurrentUser or requires a customer session — the Stripe signature alone is the trust boundary", async () => {
    // The route module's only import from the payment module is
    // `processStripeWebhookEvent` (mocked above) — there is no import of
    // `@/modules/identity` anywhere in `route.ts` for this test to even
    // stub, which is itself the structural proof: a session-based bypass
    // is not merely unused, it is not wired into this route's dependency
    // graph at all.
    mockProcessStripeWebhookEvent.mockClear();
    mockProcessStripeWebhookEvent.mockResolvedValueOnce({ outcome: "applied" });
    const request = makeRequest("body", { "stripe-signature": "sig" });

    const response = await POST(request);

    expect(response.status).toBe(200);
  });
});
