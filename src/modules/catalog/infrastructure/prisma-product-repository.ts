import "server-only";
import { prisma } from "@/modules/catalog/infrastructure/prisma-client";
import type {
  ProductRepository,
  ProductListFilter,
  AdminProductListOptions,
  AdminProductListPage,
  AdminProductInput,
} from "@/modules/catalog/repositories/product-repository";
import type { Product, ProductStatus, ProductBadge } from "@/modules/catalog/domain/product";
import type { Category } from "@/modules/catalog/domain/category";
import type { AdminProduct, AdminProductListItem } from "@/modules/catalog/domain/admin-product";

/** This project has exactly one locale today — see `admin-product.ts`'s own doc comment on why the admin shape is flattened to it rather than generalized. */
const ADMIN_LOCALE = "en";

const PRODUCT_INCLUDE = {
  category: { select: { slug: true } },
  translations: true,
} as const;

async function fetchOneActiveProduct(id: string) {
  return prisma.product.findFirst({
    where: { id, status: "ACTIVE" },
    include: PRODUCT_INCLUDE,
  });
}

type ProductRow = NonNullable<Awaited<ReturnType<typeof fetchOneActiveProduct>>>;

function toDomainProduct(row: ProductRow, locale: string): Product | null {
  const translation = row.translations.find((t) => t.locale === locale) ?? row.translations[0];
  if (!translation) {
    // A product with no translation for any locale has nothing safe to
    // display — treat it as unavailable rather than showing empty fields.
    return null;
  }

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
  return {
    id: row.id,
    slug: row.slug,
    status: row.status as ProductStatus,
    priceAmountMinor: row.priceAmountMinor,
    currency: row.currency,
    categoryName: categoryTranslation?.name ?? "",
    name: translation?.name ?? "",
    updatedAt: row.updatedAt,
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

  async setProductImage(
    productId: string,
    image: { imageUrl: string; imageAlt: string | null },
  ): Promise<AdminProduct | null> {
    const existing = await prisma.product.findUnique({ where: { id: productId } });
    if (!existing) {
      return null;
    }
    const row = await prisma.product.update({
      where: { id: productId },
      data: { imageUrl: image.imageUrl, imageAlt: image.imageAlt },
      include: ADMIN_PRODUCT_INCLUDE,
    });
    return toAdminProduct(row);
  },

  async clearProductImage(productId: string): Promise<AdminProduct | null> {
    const existing = await prisma.product.findUnique({ where: { id: productId } });
    if (!existing) {
      return null;
    }
    const row = await prisma.product.update({
      where: { id: productId },
      data: { imageUrl: null, imageAlt: null },
      include: ADMIN_PRODUCT_INCLUDE,
    });
    return toAdminProduct(row);
  },
};
