/**
 * Catalog domain entity for Product. Framework independent: no Prisma,
 * React, Next.js, or persistence details. Infrastructure is responsible for
 * mapping its own (Prisma-generated) representation onto this shape, never
 * the other way around.
 */

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
