/**
 * Public entry point for the order module. Other modules and the app
 * router must import order functionality through here rather than
 * reaching into `@/modules/order/domain/...`, `.../infrastructure/...`,
 * or `.../repositories/...` directly.
 */
import "server-only";
import { prismaOrderRepository } from "@/modules/order/infrastructure/prisma-order-repository";
import * as orderCommands from "@/modules/order/application/order-commands";
import * as checkoutOrderCommands from "@/modules/order/application/checkout-order";
import type { NewOrderInput } from "@/modules/order/repositories/order-repository";
import type { CheckoutOrderRequest } from "@/modules/order/application/checkout-order";

export type { Order, OrderItem, OrderStatus } from "@/modules/order/domain/order";
export type {
  NewOrderInput,
  NewOrderItemInput,
} from "@/modules/order/repositories/order-repository";
export type {
  CheckoutOrderRequest,
  CheckoutOrderCustomer,
  CheckoutOrderItemRequest,
  CreateOrderFromCheckoutResult,
} from "@/modules/order/application/checkout-order";

export function createOrder(input: NewOrderInput) {
  return orderCommands.createOrder(prismaOrderRepository, input);
}

/**
 * The only sanctioned way a real Checkout submission becomes an Order.
 * Resolves Catalog data and calculates every monetary value server-side —
 * see `checkout-order.ts` for why this exists as a distinct function from
 * `createOrder` above rather than accepting client-derived totals directly.
 */
export function createOrderFromCheckout(request: CheckoutOrderRequest) {
  return checkoutOrderCommands.createOrderFromCheckout(prismaOrderRepository, request);
}
