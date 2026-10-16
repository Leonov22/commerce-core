import type { Product, ProductStatus, ProductBadge } from "@/modules/catalog/domain/product";
import type { Category } from "@/modules/catalog/domain/category";
import type { AdminProduct, AdminProductListItem } from "@/modules/catalog/domain/admin-product";

export interface ProductListFilter {
  categorySlug?: string;
  /** IMP-037: restricts to products with `isFeatured: true` — the Homepage's "Selected pieces" section. */
  featuredOnly?: boolean;
}

export interface AdminProductListFilter {
  status?: ProductStatus;
  categoryId?: string;
  /** Matched against the product's slug and its `en` translation's name — case-insensitive, substring. */
  search?: string;
}

/**
 * Only direct scalar columns on `Product` itself — sorting by the
 * translated `name` would require sorting across a one-to-many relation
 * (`ProductTranslation`), which Prisma cannot express as a simple
 * `orderBy` without raw SQL. Searching by name is still supported (see
 * `AdminProductListFilter.search`); only *sorting* by it is out of scope
 * for this milestone, disclosed rather than implemented fragilely.
 */
export type AdminProductSortField = "updatedAt" | "priceAmountMinor" | "sortOrder";

export interface AdminProductListOptions {
  filter?: AdminProductListFilter;
  sort?: { field: AdminProductSortField; direction: "asc" | "desc" };
  /** 1-based. */
  page: number;
  pageSize: number;
}

export interface AdminProductListPage {
  items: AdminProductListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Only the fields an administrator actually sets when creating or editing a
 * product — never a price/status/category trusted from the browser without
 * this same server-side shape validating it first (see
 * `admin-product-commands.ts`). `currency` is deliberately not part of this
 * input: this store has exactly one currency (EUR, IMP-042) and the admin
 * editor does not reintroduce a per-product currency choice.
 */
export interface AdminProductInput {
  slug: string;
  status: ProductStatus;
  priceAmountMinor: number;
  categoryId: string;
  badge: ProductBadge | null;
  isFeatured: boolean;
  sortOrder: number;
  name: string;
  meta: string;
  description: string;
  material: string;
  dimensions: string;
}

/**
 * Read-only abstraction the Catalog application layer depends on. It never
 * depends on the Prisma implementation directly — only on this interface.
 *
 * `findActive*`/`listActive`/`listCategories` return only publicly visible
 * (ACTIVE) products, for the storefront. The `*ForAdmin`/`createProduct`/
 * `updateProduct` methods below are the Admin Panel's own extension of this
 * SAME repository (IMP-043) — deliberately not a separate repository or a
 * second Product model, since it's the same underlying aggregate, just with
 * broader, authorization-gated access the storefront never needed.
 */
export interface ProductRepository {
  findActiveById(id: string, locale: string): Promise<Product | null>;
  findActiveByIds(ids: string[], locale: string): Promise<Product[]>;
  listActive(locale: string, filter?: ProductListFilter): Promise<Product[]>;
  listCategories(locale: string): Promise<Category[]>;

  listForAdmin(options: AdminProductListOptions): Promise<AdminProductListPage>;
  findByIdForAdmin(id: string): Promise<AdminProduct | null>;
  createProduct(input: AdminProductInput): Promise<AdminProduct>;
  /** Returns `null` if no product exists with this id — never throws for "not found". */
  updateProduct(id: string, input: AdminProductInput): Promise<AdminProduct | null>;
  /** `true` if a category with this id exists — used to validate `categoryId` server-side before trusting it. */
  categoryExists(categoryId: string): Promise<boolean>;
  /** `true` if another product already uses this slug (optionally excluding one id, for updates). */
  slugExists(slug: string, excludingId?: string): Promise<boolean>;

  /** `true` if a category already uses this slug. */
  categorySlugExists(slug: string): Promise<boolean>;
  /** Creates a category with its `en` translation in one transaction, mirroring `createProduct`. */
  createCategory(input: { slug: string; name: string; sortOrder: number }): Promise<Category>;

  /**
   * IMP-046 (CR-046-01: concurrent replacement race fix). Atomic
   * compare-and-set for the product's single image: writes the new
   * `image` ONLY if the product's current `imageUrl` still equals
   * `expectedCurrentImageUrl` exactly (a plain read-then-write, as the
   * old `setProductImage`/`clearProductImage` methods did, cannot
   * express this — a second writer's update between the read and the
   * write would be silently lost). `expectedCurrentImageUrl: null`
   * matches a product that currently has no image.
   *
   * Returns the updated `AdminProduct` if the compare-and-set
   * succeeded (exactly one row matched both the id and the expected
   * current image). Returns `null` if no product exists with this id
   * OR the product's image has already changed since
   * `expectedCurrentImageUrl` was read — callers that need to tell
   * these two cases apart re-check existence themselves (see
   * `admin-product-image-commands.ts`).
   *
   * Used for both setting/replacing (`image.imageUrl` a string) and
   * clearing (`image.imageUrl: null`) — one primitive for both, since
   * both are "only change the image if it's still what I last saw".
   */
  compareAndSetProductImage(
    productId: string,
    expectedCurrentImageUrl: string | null,
    image: { imageUrl: string | null; imageAlt: string | null },
  ): Promise<AdminProduct | null>;
}
