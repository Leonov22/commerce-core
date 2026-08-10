import type { Product } from "@/modules/catalog/domain/product";
import type { Category } from "@/modules/catalog/domain/category";

export interface ProductListFilter {
  categorySlug?: string;
}

/**
 * Read-only abstraction the Catalog application layer depends on. It never
 * depends on the Prisma implementation directly — only on this interface.
 * All methods here return only publicly visible (ACTIVE) products; there is
 * intentionally no generic "find any status" method, since nothing in the
 * current storefront needs one.
 */
export interface ProductRepository {
  findActiveById(id: string, locale: string): Promise<Product | null>;
  findActiveByIds(ids: string[], locale: string): Promise<Product[]>;
  listActive(locale: string, filter?: ProductListFilter): Promise<Product[]>;
  listCategories(locale: string): Promise<Category[]>;
}
