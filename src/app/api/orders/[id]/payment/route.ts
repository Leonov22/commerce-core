import { NextResponse } from "next/server";
import { getCurrentUser } from "@/modules/identity";
import { getCustomerOrder } from "@/modules/order";
import { startOrderPayment, getPaymentForOrder } from "@/modules/payment";

/**
 * Customer Payment boundary for an existing Order (IMP-040).
 *
 * GET  /api/orders/[id]/payment  — current Order/Payment status (polling,
 *      recovery after refresh/redirect).
 * POST /api/orders/[id]/payment  — initializes-or-resumes the Order's
 *      Payment and starts it with Stripe, returning a `clientSecret` for
 *      Stripe Payment Element.
 *
 * Both methods require an authenticated session AND ownership of the
 * Order — the same null-collapsing ownership check
 * `account/orders/[id]/page.tsx` already uses
 * (`getCustomerOrder`), never a second access model. There is
 * deliberately no guest-checkout path through this route: a guest order
 * has no `userId` to verify a session against, and this milestone does
 * not invent a new guest-access mechanism (see the Roadmap's IMP-040
 * entry for the full reasoning) — a guest must sign in (and, since
 * today's Order has no post-checkout linking step, re-register under the
 * email used at checkout) to reach this route for their order.
 *
 * Never accepts or trusts any client-supplied amount, currency, payment
 * status, or provider reference — every value `startOrderPayment` acts on
 * comes from the already-persisted, authoritative Order/Payment records.
 */

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  // Deliberately identical whether the order doesn't exist or belongs to
  // another customer — never reveals which case it is.
  const order = await getCustomerOrder(user.id, id);
  if (!order) {
    return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  }

  try {
    const payment = await getPaymentForOrder(id);
    return NextResponse.json({
      orderStatus: order.status,
      paymentStatus: payment?.status ?? null,
    });
  } catch (error) {
    console.error("[api/orders/[id]/payment] failed to read payment status", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const order = await getCustomerOrder(user.id, id);
  if (!order) {
    return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  }

  try {
    const result = await startOrderPayment(id);

    if (result.ok) {
      return NextResponse.json({
        clientSecret: result.clientSecret,
        orderStatus: order.status,
        paymentStatus: result.payment.status,
      });
    }

    switch (result.error) {
      case "ORDER_NOT_FOUND":
        // Can only happen if the Order were deleted between the
        // ownership check above and here — Orders are never deleted, so
        // this is unreachable in practice, handled defensively anyway.
        return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
      case "ORDER_ALREADY_PAID":
      case "ORDER_CANCELLED":
      case "PAYMENT_NOT_PENDING":
        // All three are "nothing to start" conflicts, never a reason for
        // Stripe-style retry logic — the caller should re-fetch status
        // (GET above) rather than resubmit.
        return NextResponse.json({ error: result.error }, { status: 409 });
      case "PROVIDER_ERROR":
        // The upstream provider call itself failed — distinct from this
        // route's own failure, hence 502 rather than 500.
        return NextResponse.json({ error: "PROVIDER_ERROR" }, { status: 502 });
      default:
        return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
    }
  } catch (error) {
    // Never leak raw database/Stripe SDK errors to the client.
    console.error("[api/orders/[id]/payment] failed to start payment", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
