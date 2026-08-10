import "server-only";
import { prisma } from "@/modules/catalog/infrastructure/prisma-client";
import type {
  ProductRepository,
  ProductListFilter,
} from "@/modules/catalog/repositories/product-repository";
import type { Product, ProductStatus, ProductBadge } from "@/modules/catalog/domain/product";
import type { Category } from "@/modules/catalog/domain/category";

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
};
