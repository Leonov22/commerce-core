import type { Product, ProductStatus, ProductBadge } from "@/modules/catalog/domain/product";
import type { Category } from "@/modules/catalog/domain/category";
import type { AdminProduct, AdminProductListItem } from "@/modules/catalog/domain/admin-product";
import type { ProductDiscount, DiscountType } from "@/modules/catalog/domain/discount";

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
 * IMP-047: the fields an administrator sets when creating or editing a
 * discount. `productId` is immutable once created (moving a discount to a
 * different product is not a supported operation) — `updateProductDiscount`
 * never accepts a new `productId`, only `createProductDiscount` does.
 */
export interface AdminDiscountInput {
  productId: string;
  type: DiscountType;
  value: number;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
}

export interface AdminDiscountListItem {
  id: string;
  productId: string;
  productName: string;
  type: DiscountType;
  value: number;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  /** Computed server-side at list time via `isDiscountEffective` — whether this exact discount is the one currently being applied. */
  isEffectiveNow: boolean;
}

export interface AdminDiscountListOptions {
  /** 1-based. */
  page: number;
  pageSize: number;
}

export interface AdminDiscountListPage {
  items: AdminDiscountListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export type CreateProductDiscountResult =
  | { outcome: "created"; discount: ProductDiscount }
  | { outcome: "productNotFound" }
  /** A discount already exists for this product whose [startsAt, endsAt] window intersects the requested one — including a concurrent request that only lost the race inside the database itself (see the Prisma implementation's own doc comment). */
  | { outcome: "overlap" };

export type UpdateProductDiscountResult =
  | { outcome: "updated"; discount: ProductDiscount }
  | { outcome: "notFound" }
  | { outcome: "overlap" };

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

  /**
   * IMP-047: every discount configured for one product, regardless of
   * active state or date — the raw material `resolveEffectivePrice`
   * filters down to "the one effective right now", never pre-filtered
   * here. Used both by the admin discount form (to show a product's
   * discount history) and by the overlap check inside
   * `createProductDiscount`/`updateProductDiscount`.
   */
  listDiscountsForProduct(productId: string): Promise<ProductDiscount[]>;
  /** Every discount across every product, joined with the product's name for display — the admin Discounts list. */
  listAdminDiscounts(options: AdminDiscountListOptions): Promise<AdminDiscountListPage>;
  findAdminDiscountById(id: string): Promise<ProductDiscount | null>;

  /**
   * Atomic: checks for an overlapping discount on the same product AND
   * inserts the new one as one Serializable-isolation transaction — see
   * the Prisma implementation's own doc comment for why Serializable
   * isolation (not just an application-level pre-check) is what actually
   * closes the race between two concurrent admin requests for the same
   * product.
   */
  createProductDiscount(input: AdminDiscountInput): Promise<CreateProductDiscountResult>;
  /** Same atomicity guarantee as `createProductDiscount`, excluding the discount's own id from the overlap check against its sibling discounts. */
  updateProductDiscount(
    id: string,
    input: Omit<AdminDiscountInput, "productId">,
  ): Promise<UpdateProductDiscountResult>;
  /** Flips `isActive` only — never re-validated against overlap, since the discount already occupies this date range regardless of its active state (see `createProductDiscount`'s own doc comment on why overlap is checked against ALL discounts, not just active ones). Returns `null` if no discount exists with this id. */
  setProductDiscountActive(id: string, isActive: boolean): Promise<ProductDiscount | null>;
  /** Always safe: `OrderItem` never references `ProductDiscount` by foreign key — a historical order's `regularUnitPriceAmountMinor`/`unitPriceAmountMinor` snapshot is already fully immutable and independent of this row's continued existence. Returns `false` if no discount existed with this id. */
  deleteProductDiscount(id: string): Promise<boolean>;
}
