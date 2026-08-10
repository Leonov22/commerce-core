/**
 * Public entry point for the catalog module. Other modules, the app
 * router, and the read-only client transport must import catalog
 * functionality through here rather than reaching into
 * `@/modules/catalog/domain/...`, `.../infrastructure/...`, or
 * `.../repositories/...` directly.
 */
import "server-only";
import { prismaProductRepository } from "@/modules/catalog/infrastructure/prisma-product-repository";
import * as catalogQueries from "@/modules/catalog/application/catalog-queries";
import type { ProductListFilter } from "@/modules/catalog/repositories/product-repository";

export type {
  Product,
  ProductStatus,
  ProductBadge,
  ProductTranslation,
} from "@/modules/catalog/domain/product";
export type { Category, CategoryTranslation } from "@/modules/catalog/domain/category";
export type { ProductListFilter } from "@/modules/catalog/repositories/product-repository";
export type { StorefrontProductSummary } from "@/modules/catalog/presentation/storefront-product";
export { toStorefrontProductSummary } from "@/modules/catalog/presentation/storefront-product";

export function getProductById(id: string, locale: string) {
  return catalogQueries.getProductById(prismaProductRepository, id, locale);
}

export function getProductsByIds(ids: string[], locale: string) {
  return catalogQueries.getProductsByIds(prismaProductRepository, ids, locale);
}

export function listProducts(locale: string, filter?: ProductListFilter) {
  return catalogQueries.listProducts(prismaProductRepository, locale, filter);
}

export function listCategories(locale: string) {
  return catalogQueries.listCategories(prismaProductRepository, locale);
}
