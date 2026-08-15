/**
 * Public entry point for the payment module. Other modules and the app
 * router must import payment functionality through here rather than
 * reaching into `@/modules/payment/domain/...`, `.../infrastructure/...`,
 * or `.../repositories/...` directly.
 *
 * IMP-032 establishes the internal Payment foundation. IMP-033 adds the
 * provider-neutral `PaymentProvider` port. IMP-035 adds the first concrete
 * implementation of that port, a Stripe-backed adapter — but nothing
 * exported here is wired to any transport; no route or UI calls
 * `initializePayment` or `processPayment` yet.
 */
import "server-only";
import { getOrderById } from "@/modules/order";
import { prismaPaymentRepository } from "@/modules/payment/infrastructure/prisma-payment-repository";
import * as initializePaymentCommand from "@/modules/payment/application/initialize-payment";
import * as processPaymentCommand from "@/modules/payment/application/process-payment";
import type { PaymentProvider } from "@/modules/payment/providers/payment-provider";

export type { Payment, PaymentStatus } from "@/modules/payment/domain/payment";
export type { InitializePaymentResult } from "@/modules/payment/application/initialize-payment";
export type { ProcessPaymentResult } from "@/modules/payment/application/process-payment";
/**
 * The outbound provider port (IMP-033) — exported so a future caller can
 * depend on the provider-neutral type without reaching into
 * `@/modules/payment/providers/...` internals.
 */
export type {
  PaymentProvider,
  StartPaymentInput,
  StartPaymentResult,
} from "@/modules/payment/providers/payment-provider";
/**
 * The first concrete `PaymentProvider` implementation (IMP-035) — a
 * Stripe-backed adapter. Exported as a factory, not a pre-wired instance:
 * constructing a real Stripe client requires `STRIPE_SECRET_KEY`, and
 * eagerly building one at module-import time would make importing this
 * module (and anything that transitively imports it, including the app's
 * build) fail wherever that variable isn't set. A future transport-layer
 * caller obtains a provider with `getStripePaymentProvider()` and passes
 * it to `processPayment` below — `processPayment` itself remains entirely
 * provider-neutral and unaware that Stripe exists.
 */
export { getStripePaymentProvider } from "@/modules/payment/providers/stripe-payment-provider";

/**
 * Initializes a Payment for an existing Order (IMP-032). Not customer-
 * scoped and not wired to any transport — establishes the contract a
 * future payment-provider milestone will use, the same way IMP-030's
 * `changeOrderStatus` was established before any customer-facing caller
 * existed. Does not mutate Order status — the Order remains `PENDING`.
 */
export function initializePayment(orderId: string) {
  return initializePaymentCommand.initializePayment(prismaPaymentRepository, getOrderById, orderId);
}

/**
 * Processes an existing Payment through a supplied `PaymentProvider`
 * (IMP-034). Not wired to any transport. `PaymentRepository` is pre-wired
 * the same way as `initializePayment`; `provider` remains the caller's
 * responsibility to supply, even though a concrete one now exists
 * (`getStripePaymentProvider` above, IMP-035) — this function stays
 * provider-neutral by design, never importing or assuming Stripe itself,
 * so a future caller could equally supply a different `PaymentProvider`
 * implementation without any change here. Does not transition Payment
 * status — a successful provider call only attaches its opaque provider
 * reference while the Payment stays `PENDING`; only a future milestone,
 * once a provider genuinely reports a final result, is responsible for any
 * status transition.
 */
export function processPayment(provider: PaymentProvider, paymentId: string) {
  return processPaymentCommand.processPayment(prismaPaymentRepository, provider, paymentId);
}
