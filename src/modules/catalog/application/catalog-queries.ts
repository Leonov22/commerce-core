import type {
  ProductRepository,
  ProductListFilter,
} from "@/modules/catalog/repositories/product-repository";
import type { Product } from "@/modules/catalog/domain/product";
import type { Category } from "@/modules/catalog/domain/category";

/**
 * Catalog read use cases. Orchestration only — the actual data access lives
 * behind `ProductRepository`, which is passed in explicitly by the caller
 * (the module's public API wires the real Prisma-backed repository; tests
 * pass a fake one). This keeps Application depending on the repository
 * *abstraction* only, never on `PrismaProductRepository` directly.
 */

export async function getProductById(
  repository: ProductRepository,
  id: string,
  locale: string,
): Promise<Product | null> {
  return repository.findActiveById(id, locale);
}

export async function getProductsByIds(
  repository: ProductRepository,
  ids: string[],
  locale: string,
): Promise<Product[]> {
  return repository.findActiveByIds(ids, locale);
}

export async function listProducts(
  repository: ProductRepository,
  locale: string,
  filter?: ProductListFilter,
): Promise<Product[]> {
  return repository.listActive(locale, filter);
}

export async function listCategories(
  repository: ProductRepository,
  locale: string,
): Promise<Category[]> {
  return repository.listCategories(locale);
}
