import type { Product } from "@/modules/catalog/domain/product";

/**
 * Storefront-safe product shape returned by the read-only client transport.
 * Deliberately narrow — only what Cart/Checkout need to render a line item.
 * Never includes internal database fields, status, or anything not already
 * safe to show a shopper.
 */
export interface StorefrontProductSummary {
  id: string;
  name: string;
  meta: string;
  priceAmountMinor: number;
  currency: string;
  badge: "NEW" | "LIMITED" | null;
}

export function toStorefrontProductSummary(product: Product): StorefrontProductSummary {
  return {
    id: product.id,
    name: product.translation.name,
    meta: product.translation.meta,
    priceAmountMinor: product.priceAmountMinor,
    currency: product.currency,
    badge: product.badge,
  };
}
