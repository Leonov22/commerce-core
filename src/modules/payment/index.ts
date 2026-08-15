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

export type { Payment, PaymentStatus } from "@/modules/payment/domain/payment";
export type { InitializePaymentResult } from "@/modules/payment/application/initialize-payment";
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
