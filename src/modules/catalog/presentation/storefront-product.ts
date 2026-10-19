import type { Product } from "@/modules/catalog/domain/product";
import type { ProductDiscount } from "@/modules/catalog/domain/discount";

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
  /** The regular price, before any discount. */
  priceAmountMinor: number;
  currency: string;
  badge: "NEW" | "LIMITED" | null;
  /** IMP-046: see `Product.imageUrl`'s own doc comment. */
  imageUrl: string | null;
  imageAlt: string | null;
  /**
   * IMP-047: the price Cart/Checkout must actually charge — already
   * resolved server-side via `resolveEffectivePrice` inside Catalog, the
   * one shared calculation every price-displaying/charging surface uses.
   * Equal to `priceAmountMinor` when no discount currently applies.
   */
  effectivePriceAmountMinor: number;
  activeDiscount: ProductDiscount | null;
}

export function toStorefrontProductSummary(product: Product): StorefrontProductSummary {
  return {
    id: product.id,
    name: product.translation.name,
    meta: product.translation.meta,
    priceAmountMinor: product.priceAmountMinor,
    currency: product.currency,
    badge: product.badge,
    imageUrl: product.imageUrl,
    imageAlt: product.imageAlt,
    effectivePriceAmountMinor: product.effectivePriceAmountMinor,
    activeDiscount: product.activeDiscount,
  };
}
