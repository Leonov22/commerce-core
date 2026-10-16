import type {
  ProductRepository,
  AdminProductListOptions,
  AdminProductListPage,
} from "@/modules/catalog/repositories/product-repository";
import type { AdminProduct } from "@/modules/catalog/domain/admin-product";

/**
 * Admin Panel read use cases (IMP-043). Orchestration only, exactly like
 * `catalog-queries.ts` — the actual data access lives behind
 * `ProductRepository`, passed in explicitly so tests can supply a fake one.
 */

export async function listAdminProducts(
  repository: ProductRepository,
  options: AdminProductListOptions,
): Promise<AdminProductListPage> {
  return repository.listForAdmin(options);
}

export async function getAdminProduct(
  repository: ProductRepository,
  id: string,
): Promise<AdminProduct | null> {
  return repository.findByIdForAdmin(id);
}
