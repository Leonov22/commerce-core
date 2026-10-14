import "server-only";
import {
  initializePayment,
  type GetOrderById,
} from "@/modules/payment/application/initialize-payment";
import { processPayment } from "@/modules/payment/application/process-payment";
import type { PaymentRepository } from "@/modules/payment/repositories/payment-repository";
import type { PaymentProvider } from "@/modules/payment/providers/payment-provider";
import type { Payment } from "@/modules/payment/domain/payment";

export type StartOrderPaymentResult =
  | { ok: true; payment: Payment; clientSecret: string }
  | { ok: false; error: "ORDER_NOT_FOUND" }
  | { ok: false; error: "ORDER_ALREADY_PAID" }
  | { ok: false; error: "ORDER_CANCELLED" }
  /**
   * The Payment already reached a terminal status (`SUCCEEDED`/`FAILED`/
   * `CANCELLED`) — most likely the IMP-039 webhook settled it before this
   * call, possibly before `Order.status` itself caught up (see IMP-039's
   * own documented consistency window). There is nothing left to start.
   * `payment` carries the current (terminal) row so a caller can tell
   * "already succeeded" apart from "already failed/cancelled" — without
   * it, a customer whose payment actually SUCCEEDED during this window
   * would see a generic "unavailable" message instead of confirmation.
   */
  | { ok: false; error: "PAYMENT_NOT_PENDING"; payment: Payment }
  | { ok: false; error: "PROVIDER_ERROR" };

/**
 * Orchestrates the one thing a customer-facing "pay for this order"
 * transport needs (IMP-040): initialize a Payment for the Order if one
 * doesn't exist yet, or resume the existing one, then start it with the
 * provider and return a `clientSecret` a client-side payment UI (e.g.
 * Stripe Payment Element) can use directly. Built entirely from
 * `initializePayment` (IMP-032) and `processPayment` (IMP-034) — both
 * already safe under concurrency and duplicate submission on their own;
 * this function adds no new persistence, no new provider call shape, and
 * no new concurrency primitive, only the branching needed to treat
 * "resume an existing Payment" and "start a fresh one" as the same
 * customer-facing outcome.
 *
 * Ownership/authorization is deliberately NOT this function's concern —
 * exactly like `initializePayment`'s own unscoped `getOrder`, the caller
 * (the API route) is responsible for verifying the requesting customer
 * owns `orderId` (via `@/modules/order`'s `getCustomerOrder`) BEFORE ever
 * reaching this function, the same layering `initializePayment` already
 * established.
 */
export async function startOrderPayment(
  paymentRepository: PaymentRepository,
  paymentProvider: PaymentProvider,
  getOrder: GetOrderById,
  orderId: string,
): Promise<StartOrderPaymentResult> {
  const initialized = await initializePayment(paymentRepository, getOrder, orderId);

  let paymentId: string;
  if (initialized.ok) {
    paymentId = initialized.payment.id;
  } else if (initialized.error === "PAYMENT_ALREADY_EXISTS") {
    // Not an error from this function's perspective — resume the
    // existing Payment exactly as if it had just been created.
    paymentId = initialized.payment.id;
  } else {
    // ORDER_NOT_FOUND | ORDER_ALREADY_PAID | ORDER_CANCELLED
    return initialized;
  }

  const processed = await processPayment(paymentRepository, paymentProvider, paymentId);

  if (processed.ok) {
    return { ok: true, payment: processed.payment, clientSecret: processed.clientSecret };
  }

  if (processed.error === "PROVIDER_REFERENCE_ALREADY_SET" && processed.clientSecret) {
    // IMP-040's "reuse a valid existing PaymentIntent" requirement: a
    // concurrent/earlier call already attached the reference this call's
    // own startPayment resolved too — the secret is still genuinely usable.
    return { ok: true, payment: processed.payment, clientSecret: processed.clientSecret };
  }

  if (
    processed.error === "PAYMENT_NOT_FOUND" ||
    processed.error === "PROVIDER_REFERENCE_ALREADY_SET"
  ) {
    // PAYMENT_NOT_FOUND cannot realistically happen (paymentId was just
    // resolved moments earlier); PROVIDER_REFERENCE_ALREADY_SET without a
    // usable clientSecret means no secret could be safely attributed to
    // the persisted reference (see `ProcessPaymentResult`'s own doc
    // comment). Both fold into the same generic, retry-worthy outcome
    // rather than inventing dedicated result variants for cases this
    // function cannot meaningfully act on differently.
    return { ok: false, error: "PROVIDER_ERROR" };
  }

  // "PAYMENT_NOT_PENDING" | "PROVIDER_ERROR"
  return processed;
}
