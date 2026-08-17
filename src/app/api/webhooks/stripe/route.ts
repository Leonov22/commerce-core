import { NextResponse } from "next/server";
import { processStripeWebhookEvent } from "@/modules/payment";

/**
 * Stripe Webhook boundary (IMP-039).
 *
 * POST /api/webhooks/stripe
 * Header: Stripe-Signature: <stripe-generated signature> (required)
 *
 * Trust boundary is the Stripe signature alone — this route deliberately
 * never calls `getCurrentUser()` or accepts any customer session; Stripe
 * itself is the caller, not a customer's browser. All business logic
 * (signature verification, event mapping, Payment/Order transitions) is
 * delegated to `@/modules/payment`'s `processStripeWebhookEvent` — this
 * route only translates its result into an HTTP response, per this
 * repository's existing API-route convention (see `/api/orders`).
 *
 * The raw request body is read via `request.text()`, never `request.json()`
 * — Stripe's signature is computed over the exact raw bytes, and parsing
 * first would invalidate it for a genuine event (see
 * `stripe-webhook.ts`).
 */
export async function POST(request: Request) {
  const signatureHeader = request.headers.get("stripe-signature");
  if (!signatureHeader) {
    return NextResponse.json({ error: "MISSING_SIGNATURE" }, { status: 400 });
  }

  const rawBody = await request.text();

  try {
    const result = await processStripeWebhookEvent(rawBody, signatureHeader);

    switch (result.outcome) {
      case "invalidSignature":
        return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 400 });
      case "ignored":
      case "unknownPayment":
      case "conflict":
      case "applied":
      case "alreadyAtTarget":
        // All acknowledged: Stripe must not retry any of these. `ignored`
        // (an event type this milestone doesn't act on),
        // `unknownPayment`/`conflict` (logged anomalies retrying cannot
        // resolve), and `applied`/`alreadyAtTarget` (successful — including
        // an already-fully-processed duplicate delivery) are all terminal
        // outcomes from this delivery's perspective.
        return NextResponse.json({ received: true }, { status: 200 });
      default:
        return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
    }
  } catch (error) {
    // A genuine infrastructure failure (e.g. a transient database error)
    // during processing — never falsely acknowledge it. Returning 5xx lets
    // Stripe's own automatic retry deliver this event again later; see
    // `process-stripe-webhook-event.ts`'s doc comment for why that retry is
    // safe to resume from wherever this attempt left off.
    console.error("[api/webhooks/stripe] failed to process webhook event", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
