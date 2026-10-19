import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/modules/catalog/infrastructure/prisma-client";
import { resolveEffectivePrice, isDiscountEffective } from "@/modules/catalog/domain/pricing";
import type {
  ProductRepository,
  ProductListFilter,
  AdminProductListOptions,
  AdminProductListPage,
  AdminProductInput,
  AdminDiscountInput,
  AdminDiscountListOptions,
  AdminDiscountListPage,
  AdminDiscountListItem,
  CreateProductDiscountResult,
  UpdateProductDiscountResult,
} from "@/modules/catalog/repositories/product-repository";
import type { Product, ProductStatus, ProductBadge } from "@/modules/catalog/domain/product";
import type { Category } from "@/modules/catalog/domain/category";
import type { AdminProduct, AdminProductListItem } from "@/modules/catalog/domain/admin-product";
import type { ProductDiscount, DiscountType } from "@/modules/catalog/domain/discount";

/** This project has exactly one locale today — see `admin-product.ts`'s own doc comment on why the admin shape is flattened to it rather than generalized. */
const ADMIN_LOCALE = "en";

const PRODUCT_INCLUDE = {
  category: { select: { slug: true } },
  translations: true,
  discounts: true,
} as const;

async function fetchOneActiveProduct(id: string) {
  return prisma.product.findFirst({
    where: { id, status: "ACTIVE" },
    include: PRODUCT_INCLUDE,
  });
}

type ProductRow = NonNullable<Awaited<ReturnType<typeof fetchOneActiveProduct>>>;

/** Shared by every row shape that includes a `discounts: ProductDiscount[]` relation (storefront and admin alike) — one mapping, never duplicated. */
function toDomainDiscount(row: {
  id: string;
  productId: string;
  type: string;
  value: number;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
}): ProductDiscount {
  return {
    id: row.id,
    productId: row.productId,
    type: row.type as DiscountType,
    value: row.value,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    isActive: row.isActive,
  };
}

function toDomainProduct(row: ProductRow, locale: string): Product | null {
  const translation = row.translations.find((t) => t.locale === locale) ?? row.translations[0];
  if (!translation) {
    // A product with no translation for any locale has nothing safe to
    // display — treat it as unavailable rather than showing empty fields.
    return null;
  }

  const { effectivePriceAmountMinor, activeDiscount } = resolveEffectivePrice(
    row.priceAmountMinor,
    row.discounts.map(toDomainDiscount),
    new Date(),
  );

  return {
    id: row.id,
    slug: row.slug,
    status: row.status as ProductStatus,
    priceAmountMinor: row.priceAmountMinor,
    currency: row.currency,
    categorySlug: row.category.slug,
    badge: row.badge as ProductBadge | null,
    isFeatured: row.isFeatured,
    sortOrder: row.sortOrder,
    imageUrl: row.imageUrl,
    imageAlt: row.imageAlt,
    effectivePriceAmountMinor,
    activeDiscount,
    translation: {
      locale: translation.locale,
      name: translation.name,
      meta: translation.meta,
      description: translation.description,
      material: translation.material,
      dimensions: translation.dimensions,
    },
  };
}

async function fetchAllCategories() {
  return prisma.category.findMany({
    include: { translations: true },
    orderBy: { sortOrder: "asc" },
  });
}

type CategoryRow = Awaited<ReturnType<typeof fetchAllCategories>>[number];

function toDomainCategory(row: CategoryRow, locale: string): Category | null {
  const translation = row.translations.find((t) => t.locale === locale) ?? row.translations[0];
  if (!translation) {
    return null;
  }

  return {
    id: row.id,
    slug: row.slug,
    sortOrder: row.sortOrder,
    translation: { locale: translation.locale, name: translation.name },
  };
}

const ADMIN_PRODUCT_INCLUDE = {
  category: { select: { id: true, translations: { where: { locale: ADMIN_LOCALE } } } },
  translations: { where: { locale: ADMIN_LOCALE } },
  discounts: true,
} as const;

type AdminProductRow = NonNullable<
  Awaited<ReturnType<typeof prisma.product.findFirst<{ include: typeof ADMIN_PRODUCT_INCLUDE }>>>
>;

function toAdminProduct(row: AdminProductRow): AdminProduct {
  // Every product this project creates (seed or admin) gets an `en`
  // translation written alongside it in the same transaction — see
  // `createProduct`/`updateProduct` below — so this is always present in
  // practice; falling back to empty strings rather than throwing keeps a
  // pre-existing, translation-less row (if one ever existed) from making
  // the whole admin list unusable.
  const translation = row.translations[0];
  const categoryTranslation = row.category.translations[0];
  const { effectivePriceAmountMinor, activeDiscount } = resolveEffectivePrice(
    row.priceAmountMinor,
    row.discounts.map(toDomainDiscount),
    new Date(),
  );
  return {
    id: row.id,
    slug: row.slug,
    status: row.status as ProductStatus,
    priceAmountMinor: row.priceAmountMinor,
    currency: row.currency,
    categoryId: row.categoryId,
    categoryName: categoryTranslation?.name ?? "",
    badge: row.badge as ProductBadge | null,
    isFeatured: row.isFeatured,
    sortOrder: row.sortOrder,
    imageUrl: row.imageUrl,
    imageAlt: row.imageAlt,
    effectivePriceAmountMinor,
    activeDiscount,
    name: translation?.name ?? "",
    meta: translation?.meta ?? "",
    description: translation?.description ?? "",
    material: translation?.material ?? "",
    dimensions: translation?.dimensions ?? "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAdminProductListItem(row: AdminProductRow): AdminProductListItem {
  const translation = row.translations[0];
  const categoryTranslation = row.category.translations[0];
  const { effectivePriceAmountMinor, activeDiscount } = resolveEffectivePrice(
    row.priceAmountMinor,
    row.discounts.map(toDomainDiscount),
    new Date(),
  );
  return {
    id: row.id,
    slug: row.slug,
    status: row.status as ProductStatus,
    priceAmountMinor: row.priceAmountMinor,
    currency: row.currency,
    categoryName: categoryTranslation?.name ?? "",
    name: translation?.name ?? "",
    updatedAt: row.updatedAt,
    effectivePriceAmountMinor,
    activeDiscount,
  };
}

/**
 * Prisma implementation of `ProductRepository`. This is the only file in
 * Catalog allowed to run Prisma queries for products/categories — the
 * application layer depends on the `ProductRepository` interface, never on
 * this class directly.
 */
export const prismaProductRepository: ProductRepository = {
  async findActiveById(id, locale) {
    const row = await fetchOneActiveProduct(id);
    return row ? toDomainProduct(row, locale) : null;
  },

  async findActiveByIds(ids, locale) {
    if (ids.length === 0) {
      return [];
    }
    const rows = await prisma.product.findMany({
      where: { id: { in: ids }, status: "ACTIVE" },
      include: PRODUCT_INCLUDE,
    });
    return rows
      .map((row) => toDomainProduct(row, locale))
      .filter((product): product is Product => product !== null);
  },

  async listActive(locale, filter?: ProductListFilter) {
    const rows = await prisma.product.findMany({
      where: {
        status: "ACTIVE",
        ...(filter?.categorySlug ? { category: { slug: filter.categorySlug } } : {}),
        ...(filter?.featuredOnly ? { isFeatured: true } : {}),
      },
      include: PRODUCT_INCLUDE,
      orderBy: { sortOrder: "asc" },
    });
    return rows
      .map((row) => toDomainProduct(row, locale))
      .filter((product): product is Product => product !== null);
  },

  async listCategories(locale) {
    const rows = await fetchAllCategories();
    return rows
      .map((row) => toDomainCategory(row, locale))
      .filter((category): category is Category => category !== null);
  },

  async listForAdmin(options: AdminProductListOptions): Promise<AdminProductListPage> {
    const { filter, sort, page, pageSize } = options;
    const where = {
      ...(filter?.status ? { status: filter.status } : {}),
      ...(filter?.categoryId ? { categoryId: filter.categoryId } : {}),
      ...(filter?.search
        ? {
            OR: [
              { slug: { contains: filter.search, mode: "insensitive" as const } },
              {
                translations: {
                  some: {
                    locale: ADMIN_LOCALE,
                    name: { contains: filter.search, mode: "insensitive" as const },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: ADMIN_PRODUCT_INCLUDE,
        orderBy: { [sort?.field ?? "updatedAt"]: sort?.direction ?? "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.product.count({ where }),
    ]);

    return {
      items: rows.map(toAdminProductListItem),
      total,
      page,
      pageSize,
    };
  },

  async findByIdForAdmin(id: string): Promise<AdminProduct | null> {
    const row = await prisma.product.findUnique({
      where: { id },
      include: ADMIN_PRODUCT_INCLUDE,
    });
    return row ? toAdminProduct(row) : null;
  },

  async createProduct(input: AdminProductInput): Promise<AdminProduct> {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          slug: input.slug,
          status: input.status,
          priceAmountMinor: input.priceAmountMinor,
          // EUR is this store's only currency (IMP-042) — never taken from
          // the admin's own input; see `AdminProductInput`'s own doc comment.
          currency: "EUR",
          categoryId: input.categoryId,
          badge: input.badge,
          isFeatured: input.isFeatured,
          sortOrder: input.sortOrder,
        },
      });
      await tx.productTranslation.create({
        data: {
          productId: created.id,
          locale: ADMIN_LOCALE,
          name: input.name,
          meta: input.meta,
          description: input.description,
          material: input.material,
          dimensions: input.dimensions,
        },
      });
      return tx.product.findUniqueOrThrow({
        where: { id: created.id },
        include: ADMIN_PRODUCT_INCLUDE,
      });
    });
    return toAdminProduct(row);
  },

  async updateProduct(id: string, input: AdminProductInput): Promise<AdminProduct | null> {
    const row = await prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { id } });
      if (!existing) {
        return null;
      }
      await tx.product.update({
        where: { id },
        data: {
          slug: input.slug,
          status: input.status,
          priceAmountMinor: input.priceAmountMinor,
          categoryId: input.categoryId,
          badge: input.badge,
          isFeatured: input.isFeatured,
          sortOrder: input.sortOrder,
          // `currency` is deliberately never updated here — an existing
          // product's currency is not something this editor changes; the
          // dedicated, guarded `set-product-currency.ts` script is the
          // only sanctioned way to migrate currency in bulk (IMP-042).
        },
      });
      await tx.productTranslation.upsert({
        where: { productId_locale: { productId: id, locale: ADMIN_LOCALE } },
        update: {
          name: input.name,
          meta: input.meta,
          description: input.description,
          material: input.material,
          dimensions: input.dimensions,
        },
        create: {
          productId: id,
          locale: ADMIN_LOCALE,
          name: input.name,
          meta: input.meta,
          description: input.description,
          material: input.material,
          dimensions: input.dimensions,
        },
      });
      return tx.product.findUniqueOrThrow({
        where: { id },
        include: ADMIN_PRODUCT_INCLUDE,
      });
    });
    return row ? toAdminProduct(row) : null;
  },

  async categoryExists(categoryId: string): Promise<boolean> {
    const count = await prisma.category.count({ where: { id: categoryId } });
    return count > 0;
  },

  async slugExists(slug: string, excludingId?: string): Promise<boolean> {
    const count = await prisma.product.count({
      where: { slug, ...(excludingId ? { id: { not: excludingId } } : {}) },
    });
    return count > 0;
  },

  async categorySlugExists(slug: string): Promise<boolean> {
    const count = await prisma.category.count({ where: { slug } });
    return count > 0;
  },

  async createCategory(input: {
    slug: string;
    name: string;
    sortOrder: number;
  }): Promise<Category> {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.category.create({
        data: { slug: input.slug, sortOrder: input.sortOrder },
      });
      await tx.categoryTranslation.create({
        data: { categoryId: created.id, locale: ADMIN_LOCALE, name: input.name },
      });
      return tx.category.findUniqueOrThrow({
        where: { id: created.id },
        include: { translations: true },
      });
    });
    const category = toDomainCategory(row, ADMIN_LOCALE);
    // Non-null: a translation was just created, in the same transaction, for this exact locale.
    return category!;
  },

  async compareAndSetProductImage(
    productId: string,
    expectedCurrentImageUrl: string | null,
    image: { imageUrl: string | null; imageAlt: string | null },
  ): Promise<AdminProduct | null> {
    // `updateMany` (not `update`), because `update`'s `where` can only
    // ever identify a row by a unique field — it cannot additionally
    // condition the write on `imageUrl`'s current value. `updateMany`
    // accepts an arbitrary filter, and its `count` tells us atomically,
    // in one round trip, whether the row actually matched BOTH `id` AND
    // `imageUrl: expectedCurrentImageUrl` at the moment of the write —
    // exactly the compare-and-set this needs. A separate
    // read-then-write (what the earlier `setProductImage`/
    // `clearProductImage` did) cannot give that guarantee: another
    // writer's update landing between the read and the write would be
    // silently overwritten. Mirrors `set-product-currency.ts`'s own
    // `updateMany` + exact-count-check precedent.
    const result = await prisma.product.updateMany({
      where: { id: productId, imageUrl: expectedCurrentImageUrl },
      data: { imageUrl: image.imageUrl, imageAlt: image.imageAlt },
    });
    if (result.count !== 1) {
      return null;
    }
    const row = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: ADMIN_PRODUCT_INCLUDE,
    });
    return toAdminProduct(row);
  },

  async listDiscountsForProduct(productId: string): Promise<ProductDiscount[]> {
    const rows = await prisma.productDiscount.findMany({
      where: { productId },
      orderBy: { startsAt: "asc" },
    });
    return rows.map(toDomainDiscount);
  },

  async listAdminDiscounts(options: AdminDiscountListOptions): Promise<AdminDiscountListPage> {
    const { page, pageSize } = options;
    const [rows, total] = await Promise.all([
      prisma.productDiscount.findMany({
        include: { product: { include: { translations: { where: { locale: ADMIN_LOCALE } } } } },
        orderBy: { startsAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.productDiscount.count(),
    ]);

    const now = new Date();
    const items: AdminDiscountListItem[] = rows.map((row) => {
      const discount = toDomainDiscount(row);
      return {
        id: discount.id,
        productId: discount.productId,
        productName: row.product.translations[0]?.name ?? "",
        type: discount.type,
        value: discount.value,
        startsAt: discount.startsAt,
        endsAt: discount.endsAt,
        isActive: discount.isActive,
        isEffectiveNow: isDiscountEffective(discount, now),
      };
    });

    return { items, total, page, pageSize };
  },

  async findAdminDiscountById(id: string): Promise<ProductDiscount | null> {
    const row = await prisma.productDiscount.findUnique({ where: { id } });
    return row ? toDomainDiscount(row) : null;
  },

  async createProductDiscount(input: AdminDiscountInput): Promise<CreateProductDiscountResult> {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const product = await tx.product.findUnique({ where: { id: input.productId } });
          if (!product) {
            return { outcome: "productNotFound" as const };
          }

          const siblings = await tx.productDiscount.findMany({
            where: { productId: input.productId },
          });
          if (
            siblings.some((sibling) =>
              rangesOverlap(input.startsAt, input.endsAt, sibling.startsAt, sibling.endsAt),
            )
          ) {
            return { outcome: "overlap" as const };
          }

          const created = await tx.productDiscount.create({
            data: {
              productId: input.productId,
              type: input.type,
              value: input.value,
              startsAt: input.startsAt,
              endsAt: input.endsAt,
              isActive: input.isActive,
            },
          });
          return { outcome: "created" as const, discount: toDomainDiscount(created) };
        },
        // CR-047-01: Serializable isolation is what actually prevents two
        // concurrent admin requests from both reading "no overlap" and
        // both inserting — see this method's own doc comment on
        // `ProductRepository` for why an application-level pre-check
        // alone cannot close this race. Under Serializable isolation,
        // Postgres detects the write-skew itself and aborts one of the
        // two transactions with a serialization failure (caught below).
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isSerializationFailure(error)) {
        return { outcome: "overlap" };
      }
      throw error;
    }
  },

  async updateProductDiscount(
    id: string,
    input: Omit<AdminDiscountInput, "productId">,
  ): Promise<UpdateProductDiscountResult> {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.productDiscount.findUnique({ where: { id } });
          if (!existing) {
            return { outcome: "notFound" as const };
          }

          const siblings = await tx.productDiscount.findMany({
            where: { productId: existing.productId, id: { not: id } },
          });
          if (
            siblings.some((sibling) =>
              rangesOverlap(input.startsAt, input.endsAt, sibling.startsAt, sibling.endsAt),
            )
          ) {
            return { outcome: "overlap" as const };
          }

          const updated = await tx.productDiscount.update({
            where: { id },
            data: {
              type: input.type,
              value: input.value,
              startsAt: input.startsAt,
              endsAt: input.endsAt,
              isActive: input.isActive,
            },
          });
          return { outcome: "updated" as const, discount: toDomainDiscount(updated) };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isSerializationFailure(error)) {
        return { outcome: "overlap" };
      }
      throw error;
    }
  },

  async setProductDiscountActive(id: string, isActive: boolean): Promise<ProductDiscount | null> {
    const existing = await prisma.productDiscount.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }
    const updated = await prisma.productDiscount.update({ where: { id }, data: { isActive } });
    return toDomainDiscount(updated);
  },

  async deleteProductDiscount(id: string): Promise<boolean> {
    try {
      await prisma.productDiscount.delete({ where: { id } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        // "Record to delete does not exist" — already gone; deletion is idempotent.
        return false;
      }
      throw error;
    }
  },
};

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Postgres's own write-skew detection under Serializable isolation.
 * Confirmed empirically (a genuine concurrent-write integration test
 * against the real database — see `prisma-product-repository.test.ts`'s
 * own "concurrent overlap protection" tests) to surface as TWO different
 * shapes depending on how deep into the stack it's caught, and this
 * checks for both rather than assuming only one:
 *
 *   1. `Prisma.PrismaClientKnownRequestError` with code `P2034`
 *      ("Transaction failed due to a write conflict or a deadlock") —
 *      Prisma's documented, query-engine-level wrapping.
 *   2. A raw `DriverAdapterError` (from `@prisma/driver-adapter-utils`,
 *      underneath `@prisma/adapter-pg`) whose `cause.kind` is
 *      `"TransactionWriteConflict"` — observed in practice with this
 *      project's Prisma 7 + driver-adapter setup, propagating
 *      UNWRAPPED out of `prisma.$transaction(...)` rather than being
 *      re-wrapped into (1) first. Duck-typed (not `instanceof`) since
 *      `DriverAdapterError` isn't part of `@/generated/prisma/client`'s
 *      own public `Prisma` namespace.
 *
 * Both outcomes are treated identically by every caller above — from
 * the business perspective, both mean "a conflicting discount already
 * exists for this product," one just caught one layer later than the
 * in-transaction check.
 */
function isSerializationFailure(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    return true;
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "DriverAdapterError" &&
    "cause" in error &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "kind" in error.cause &&
    error.cause.kind === "TransactionWriteConflict"
  ) {
    return true;
  }
  return false;
}
