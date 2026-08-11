import type { useCart } from "@/modules/cart";
import type { StorefrontProductSummary } from "@/modules/catalog/client";

/**
 * Derived from Cart's own public shape rather than duplicated here —
 * Checkout never redefines what a cart line item is, it only reads through
 * Cart's public API (`@/modules/cart`).
 */
export type CheckoutCartItem = ReturnType<typeof useCart>["items"][number];

/**
 * Checkout only reads product data through Catalog's client-safe transport
 * (`@/modules/catalog/client`), the same read-only DTO Cart uses — Checkout
 * runs entirely client-side and can never import the Prisma-backed
 * `@/modules/catalog` entry point.
 */
export type CheckoutCatalogProduct = StorefrontProductSummary;

export interface CheckoutContactValues {
  fullName: string;
  email: string;
  phone: string;
}

export interface CheckoutDeliveryAddressValues {
  address: string;
  city: string;
  postalCode: string;
}

export type DeliveryMethodKey = "standard" | "express";

export interface CheckoutFormValues {
  contact: CheckoutContactValues;
  deliveryAddress: CheckoutDeliveryAddressValues;
  deliveryMethod: DeliveryMethodKey | null;
}

export type CheckoutFormErrors = Partial<
  Record<
    keyof CheckoutContactValues | keyof CheckoutDeliveryAddressValues | "deliveryMethod",
    string
  >
>;

/**
 * Presentation-level delivery options only — no real shipping provider
 * integration. `priceAmountMinor` uses the same integer minor-unit
 * convention as Catalog pricing so it can be combined with the product
 * subtotal and formatted through a single `formatProductPrice` call.
 */
export interface DeliveryOption {
  key: DeliveryMethodKey;
  priceAmountMinor: number;
}

export const DELIVERY_OPTIONS: DeliveryOption[] = [
  { key: "standard", priceAmountMinor: 800 },
  { key: "express", priceAmountMinor: 1800 },
];

export interface CheckoutLine {
  item: CheckoutCartItem;
  product: CheckoutCatalogProduct;
  /** Integer minor units: `product.priceAmountMinor * item.quantity`. Never a float. */
  lineTotalAmountMinor: number;
}

/**
 * Result of resolving a Cart against currently-known Catalog data. `loading`
 * is its own explicit state (not just an empty `ready` result) so a cart
 * whose Catalog resolution hasn't finished yet can never be mistaken for a
 * cart with a genuinely zero/partial subtotal.
 */
export type CheckoutSummaryState =
  | { status: "loading" }
  | {
      status: "ready";
      lines: CheckoutLine[];
      /** Cart items whose productId Catalog did not return — unresolved, unavailable, or non-ACTIVE. */
      unresolvedCount: number;
      subtotalAmountMinor: number;
      currency: string;
    };

/**
 * Pure Checkout summary logic — no Prisma, no React, no fetch. Given a Cart
 * and whatever the Catalog transport has resolved so far, produces exactly
 * what the Checkout summary needs to render: per-line totals, a subtotal,
 * and how many cart items (if any) Catalog couldn't confirm. A cart item
 * with no matching resolved product is excluded from the total rather than
 * priced at zero or guessed at — it is only counted.
 */
export function resolveCheckoutSummary(
  items: CheckoutCartItem[],
  productsById: ReadonlyMap<string, CheckoutCatalogProduct>,
  isCatalogLoading: boolean,
): CheckoutSummaryState {
  if (isCatalogLoading) {
    return { status: "loading" };
  }

  const lines: CheckoutLine[] = [];
  let unresolvedCount = 0;

  for (const item of items) {
    const product = productsById.get(item.productId);
    if (!product) {
      unresolvedCount += 1;
      continue;
    }
    lines.push({ item, product, lineTotalAmountMinor: product.priceAmountMinor * item.quantity });
  }

  const subtotalAmountMinor = lines.reduce((sum, line) => sum + line.lineTotalAmountMinor, 0);
  const currency = lines[0]?.product.currency ?? "USD";

  return { status: "ready", lines, unresolvedCount, subtotalAmountMinor, currency };
}
