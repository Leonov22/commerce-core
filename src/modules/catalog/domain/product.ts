/**
 * Catalog domain entity for Product. Framework independent: no Prisma,
 * React, Next.js, or persistence details. Infrastructure is responsible for
 * mapping its own (Prisma-generated) representation onto this shape, never
 * the other way around.
 */

import type { ProductDiscount } from "@/modules/catalog/domain/discount";

export type ProductStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export type ProductBadge = "NEW" | "LIMITED";

export interface ProductTranslation {
  locale: string;
  name: string;
  meta: string;
  description: string;
  material: string;
  dimensions: string;
}

export interface Product {
  id: string;
  slug: string;
  status: ProductStatus;
  /** Integer minor units (e.g. $240.00 -> 24000). Never a float. */
  priceAmountMinor: number;
  currency: string;
  categorySlug: string;
  badge: ProductBadge | null;
  isFeatured: boolean;
  sortOrder: number;
  /** IMP-046: the product's single image, if one has been uploaded. A Vercel Blob public URL, never a local path. */
  imageUrl: string | null;
  /** Admin-set alt text; `null` means the storefront should fall back to the product's own name. */
  imageAlt: string | null;
  /**
   * IMP-047: the price after the currently-effective discount, computed
   * once by `resolveEffectivePrice` at read time — equal to
   * `priceAmountMinor` when no discount currently applies. Every caller
   * that charges or displays a price uses THIS field, never
   * `priceAmountMinor` directly (which remains the regular price, for
   * display/comparison only).
   */
  effectivePriceAmountMinor: number;
  /** The discount actually producing `effectivePriceAmountMinor`, or `null`. */
  activeDiscount: ProductDiscount | null;
  /** Translation resolved for the locale that was requested. */
  translation: ProductTranslation;
}

/**
 * The only status considered publicly visible on the storefront. Draft and
 * archived products exist for editorial/history reasons but must never be
 * served to shoppers.
 */
export function isPubliclyVisible(status: ProductStatus): boolean {
  return status === "ACTIVE";
}
