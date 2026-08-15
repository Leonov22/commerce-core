/**
 * Public entry point for the payment module. Other modules and the app
 * router must import payment functionality through here rather than
 * reaching into `@/modules/payment/domain/...`, `.../infrastructure/...`,
 * or `.../repositories/...` directly.
 *
 * IMP-032 establishes the internal Payment foundation only — no external
 * payment provider, no route, no UI. Nothing exported here is wired to any
 * transport; a future payment-provider milestone is the intended caller of
 * `initializePayment`.
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
 * The outbound provider port (IMP-033) — no implementation exists yet;
 * exported so a future payment-provider milestone can implement it
 * without reaching into `@/modules/payment/providers/...` internals.
 */
export type {
  PaymentProvider,
  StartPaymentInput,
  StartPaymentResult,
} from "@/modules/payment/providers/payment-provider";

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
 * (IMP-034). Not wired to any transport, and — unlike `initializePayment`
 * — not wired to a concrete provider either: IMP-033 established the
 * `PaymentProvider` port with no implementation, so there is nothing real
 * to pre-wire here yet. `PaymentRepository` (the one dependency that IS
 * concrete today) is pre-wired the same way as `initializePayment`; a
 * future milestone supplies `provider` once a real adapter exists. Does
 * not transition Payment status — a successful provider call only
 * attaches its opaque provider reference while the Payment stays
 * `PENDING`; only a future milestone, once a provider genuinely reports a
 * final result, is responsible for any status transition.
 */
export function processPayment(provider: PaymentProvider, paymentId: string) {
  return processPaymentCommand.processPayment(prismaPaymentRepository, provider, paymentId);
}
