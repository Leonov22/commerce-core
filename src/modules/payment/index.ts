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
import { getOrderById, changeOrderStatus } from "@/modules/order";
import { prismaPaymentRepository } from "@/modules/payment/infrastructure/prisma-payment-repository";
import { prismaPaymentWebhookEventRepository } from "@/modules/payment/infrastructure/prisma-payment-webhook-event-repository";
import * as initializePaymentCommand from "@/modules/payment/application/initialize-payment";
import * as processPaymentCommand from "@/modules/payment/application/process-payment";
import * as startOrderPaymentCommand from "@/modules/payment/application/start-order-payment";
import * as processStripeWebhookEventCommand from "@/modules/payment/application/process-stripe-webhook-event";
import { getStripePaymentProvider } from "@/modules/payment/providers/stripe-payment-provider";
import {
  verifyStripeWebhookEvent,
  getStripeWebhookSecret,
} from "@/modules/payment/providers/stripe-webhook";
import type { PaymentProvider } from "@/modules/payment/providers/payment-provider";

export type { Payment, PaymentStatus } from "@/modules/payment/domain/payment";
export type { InitializePaymentResult } from "@/modules/payment/application/initialize-payment";
export type { ProcessPaymentResult } from "@/modules/payment/application/process-payment";
export type { StartOrderPaymentResult } from "@/modules/payment/application/start-order-payment";
export type { ProcessStripeWebhookEventResult } from "@/modules/payment/application/process-stripe-webhook-event";
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
 * Customer-facing payment UI (IMP-040) — a Client Component, re-exported
 * here the same way `@/modules/identity` exports `AccountLogoutButton`
 * alongside this file's own `import "server-only"`: the directive guards
 * this barrel from being imported into a client bundle, not the
 * individual components it re-exports, which carry their own `"use
 * client"` boundary. Composed into `CustomerOrderDetailView`'s
 * `paymentSlot` prop by `account/orders/[id]/page.tsx` — Order's
 * presentation layer never imports this module directly.
 */
export { OrderPaymentPanel } from "@/modules/payment/components/order-payment-panel";

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

/**
 * Initializes-or-resumes a Payment for an Order and starts it with the
 * real Stripe provider, returning a `clientSecret` (IMP-040) — the one
 * function a customer-facing "pay for this order" transport needs. Built
 * from `initializePayment`/`processPayment` above; see
 * `start-order-payment.ts` for the full reasoning. `getOrderById` is
 * injected exactly as `initializePayment` already does; the Stripe
 * provider is resolved here (not by the caller) since every real caller
 * of this specific function needs the real provider, unlike `processPayment`
 * above, which deliberately stays provider-agnostic for callers that may
 * supply a different one.
 */
export function startOrderPayment(orderId: string) {
  return startOrderPaymentCommand.startOrderPayment(
    prismaPaymentRepository,
    getStripePaymentProvider(),
    getOrderById,
    orderId,
  );
}

/**
 * The one-Payment-per-Order read (IMP-040) — a thin, logic-free
 * delegation straight to the repository (no application-layer file: there
 * is nothing to orchestrate), exposed so a customer-facing status
 * endpoint can report current Payment status without initializing or
 * starting anything. Not customer-scoped — exactly like `getOrderById`,
 * the caller (the API route) is responsible for verifying ownership of
 * `orderId` first.
 */
export function getPaymentForOrder(orderId: string) {
  return prismaPaymentRepository.findByOrderId(orderId);
}

/**
 * Processes one verified Stripe webhook delivery (IMP-039) — the first
 * transport-wired caller of `PaymentRepository.updateStatusIfCurrent`
 * (established since IMP-032, unused until now) and of Order's
 * `changeOrderStatus` (established since IMP-030). `changeOrderStatus` is
 * passed in as a plain function, never imported directly by the
 * application layer, mirroring `initializePayment`'s injected
 * `getOrderById` — Payment stays unaware of Order's own Prisma/repository
 * internals. Stripe signature verification/event mapping is similarly
 * injected (`verifyStripeWebhookEvent`, reading `STRIPE_WEBHOOK_SECRET`
 * only when this is actually called), so the application layer itself
 * never imports the Stripe SDK.
 *
 * `rawBody` must be the exact, unparsed request body (see
 * `stripe-webhook.ts`'s own doc comment on why) and `signatureHeader` the
 * verbatim `Stripe-Signature` header value.
 */
export function processStripeWebhookEvent(rawBody: string, signatureHeader: string) {
  return processStripeWebhookEventCommand.processStripeWebhookEvent(
    prismaPaymentRepository,
    prismaPaymentWebhookEventRepository,
    changeOrderStatus,
    (body, signature) => verifyStripeWebhookEvent(body, signature, getStripeWebhookSecret()),
    rawBody,
    signatureHeader,
  );
}
