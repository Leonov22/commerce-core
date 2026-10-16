import type { ProductStatus, ProductBadge } from "@/modules/catalog/domain/product";

/**
 * Admin-facing projection of the same `Product` aggregate the storefront's
 * `Product` type already models (IMP-043) — not a second Product model.
 * Differs from the storefront shape in exactly the ways an administrator
 * needs and a shopper never sees: `categoryId` (not just `categorySlug`,
 * since the editor needs to actually change it), every status (not only
 * `ACTIVE`), and `createdAt`/`updatedAt`.
 *
 * This project has exactly one locale (`en`) today, so the editable
 * translation fields are flattened onto this type directly rather than
 * exposed as a `translations[]` array — there is nothing to pick between
 * yet. If a second locale is ever added, this is the one place that would
 * need to grow a locale dimension; nothing about the admin UI/API shape
 * forces that decision now.
 */
export interface AdminProduct {
  id: string;
  slug: string;
  status: ProductStatus;
  priceAmountMinor: number;
  currency: string;
  categoryId: string;
  categoryName: string;
  badge: ProductBadge | null;
  isFeatured: boolean;
  sortOrder: number;
  /** IMP-046: see `Product.imageUrl`'s own doc comment — same meaning, same Vercel Blob URL. */
  imageUrl: string | null;
  imageAlt: string | null;
  name: string;
  meta: string;
  description: string;
  material: string;
  dimensions: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminProductListItem {
  id: string;
  slug: string;
  status: ProductStatus;
  priceAmountMinor: number;
  currency: string;
  categoryName: string;
  name: string;
  updatedAt: Date;
}
