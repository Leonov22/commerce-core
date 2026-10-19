import type {
  ProductRepository,
  AdminDiscountListOptions,
  AdminDiscountListPage,
} from "@/modules/catalog/repositories/product-repository";
import type { ProductDiscount } from "@/modules/catalog/domain/discount";

/**
 * IMP-047: Admin Panel discount read use cases. Orchestration only,
 * exactly like `admin-product-queries.ts` — the actual data access lives
 * behind `ProductRepository`, passed in explicitly so tests can supply a
 * fake one.
 */

export async function listAdminDiscounts(
  repository: ProductRepository,
  options: AdminDiscountListOptions,
): Promise<AdminDiscountListPage> {
  return repository.listAdminDiscounts(options);
}

export async function getAdminDiscount(
  repository: ProductRepository,
  id: string,
): Promise<ProductDiscount | null> {
  return repository.findAdminDiscountById(id);
}
