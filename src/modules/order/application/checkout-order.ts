import "server-only";
import { getProductsByIds } from "@/modules/catalog";
import type { OrderRepository } from "@/modules/order/repositories/order-repository";
import type { Order } from "@/modules/order/domain/order";

export interface CheckoutOrderCustomer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface CheckoutOrderItemRequest {
  productId: string;
  quantity: number;
}

export interface CheckoutOrderRequest {
  customer: CheckoutOrderCustomer;
  items: CheckoutOrderItemRequest[];
  /**
   * Already resolved server-side from a submitted delivery *method* before
   * this function is called — never a client-supplied amount. See
   * `@/modules/checkout`'s `getDeliveryAmountMinor`.
   */
  deliveryAmountMinor: number;
  locale: string;
}

export type CreateOrderFromCheckoutResult =
  | { ok: true; order: Order }
  | { ok: false; error: "EMPTY_CART" }
  | { ok: false; error: "INVALID_QUANTITY"; productId: string }
  | { ok: false; error: "UNRESOLVED_PRODUCTS"; productIds: string[] }
  | { ok: false; error: "INCONSISTENT_CURRENCY" };

/**
 * The one path by which a Checkout submission may become a persisted Order.
 * Trusts only `productId`/`quantity` from the client — every monetary value
 * (unit price, line total, subtotal, total) and every product name/currency
 * is resolved fresh from Catalog's server-side boundary and calculated here,
 * never taken from client input. This is what resolves CR-IMP025-F01: the
 * lower-level `OrderRepository.create`/`NewOrderInput` contract still
 * technically accepts arbitrary totals (a repository has no business
 * rejecting data handed to it), but this function is the only place in the
 * codebase that is allowed to construct that input for a real checkout, and
 * it only ever does so from values it computed itself.
 *
 * Resolves all Cart product IDs in a single batched Catalog call — never
 * one request per product. If any item fails to resolve (nonexistent,
 * DRAFT, ARCHIVED — Catalog's own ACTIVE-only rule applies here exactly as
 * it does everywhere else), the whole Order is rejected; nothing is ever
 * partially persisted.
 */
export async function createOrderFromCheckout(
  repository: OrderRepository,
  request: CheckoutOrderRequest,
): Promise<CreateOrderFromCheckoutResult> {
  if (request.items.length === 0) {
    return { ok: false, error: "EMPTY_CART" };
  }

  for (const item of request.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      return { ok: false, error: "INVALID_QUANTITY", productId: item.productId };
    }
  }

  const uniqueProductIds = Array.from(new Set(request.items.map((item) => item.productId)));
  const products = await getProductsByIds(uniqueProductIds, request.locale);
  const productsById = new Map(products.map((product) => [product.id, product]));

  const unresolvedProductIds = Array.from(
    new Set(
      request.items
        .map((item) => item.productId)
        .filter((productId) => !productsById.has(productId)),
    ),
  );
  if (unresolvedProductIds.length > 0) {
    return { ok: false, error: "UNRESOLVED_PRODUCTS", productIds: unresolvedProductIds };
  }

  const items = request.items.map((item) => {
    // Non-null: every productId was just confirmed present in productsById above.
    const product = productsById.get(item.productId)!;
    return {
      productId: product.id,
      productName: product.translation.name,
      unitPriceAmountMinor: product.priceAmountMinor,
      quantity: item.quantity,
      lineTotalAmountMinor: product.priceAmountMinor * item.quantity,
      currency: product.currency,
    };
  });

  const currency = items[0]!.currency;
  if (items.some((item) => item.currency !== currency)) {
    // Every seeded product currently shares one currency; this only guards
    // against a future Catalog change silently mixing currencies into one
    // Order rather than pretending a single total is meaningful.
    return { ok: false, error: "INCONSISTENT_CURRENCY" };
  }

  const subtotalAmountMinor = items.reduce((sum, item) => sum + item.lineTotalAmountMinor, 0);
  const totalAmountMinor = subtotalAmountMinor + request.deliveryAmountMinor;

  const order = await repository.create({
    status: "PENDING",
    firstName: request.customer.firstName,
    lastName: request.customer.lastName,
    email: request.customer.email,
    phone: request.customer.phone,
    subtotalAmountMinor,
    deliveryAmountMinor: request.deliveryAmountMinor,
    totalAmountMinor,
    currency,
    items,
  });

  return { ok: true, order };
}
