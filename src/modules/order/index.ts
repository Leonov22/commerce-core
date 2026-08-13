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
import * as customerOrdersCommands from "@/modules/order/application/customer-orders";
import type { NewOrderInput } from "@/modules/order/repositories/order-repository";
import type { CheckoutOrderRequest } from "@/modules/order/application/checkout-order";

export type { Order, OrderItem, OrderStatus } from "@/modules/order/domain/order";
export type {
  NewOrderInput,
  NewOrderItemInput,
  OrderListPage,
} from "@/modules/order/repositories/order-repository";
export type {
  CheckoutOrderRequest,
  CheckoutOrderCustomer,
  CheckoutOrderItemRequest,
  CreateOrderFromCheckoutResult,
} from "@/modules/order/application/checkout-order";
export { MAX_QUANTITY_PER_ITEM } from "@/modules/order/application/checkout-order";

// Customer-facing order-history UI (IMP-029) — thin
// `app/[locale]/account/orders/*` pages render these, the same way
// `checkout/page.tsx` renders `CheckoutView` from `@/modules/checkout`.
export { CustomerOrderListView } from "@/modules/order/presentation/customer-order-list-view";
export { CustomerOrderDetailView } from "@/modules/order/presentation/customer-order-detail-view";

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

/**
 * Customer order history (IMP-029). `userId` must be a server-derived,
 * already-authenticated id (see `@/modules/identity`'s `getCurrentUser()`)
 * — this function trusts it as the query owner and never re-derives or
 * re-checks it itself. Ownership is enforced inside the repository query,
 * not here.
 */
export function getCustomerOrders(userId: string, cursor?: string) {
  return customerOrdersCommands.getCustomerOrders(prismaOrderRepository, userId, cursor);
}

/** Returns `null` for both "no such order" and "belongs to someone else" — indistinguishable to the caller. */
export function getCustomerOrder(userId: string, orderId: string) {
  return customerOrdersCommands.getCustomerOrder(prismaOrderRepository, userId, orderId);
}
