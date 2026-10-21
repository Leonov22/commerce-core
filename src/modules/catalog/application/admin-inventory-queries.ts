import type { ProductRepository } from "@/modules/catalog/repositories/product-repository";
import type {
  InventoryRepository,
  StockAdjustmentListOptions,
  StockAdjustmentListPage,
} from "@/modules/catalog/repositories/inventory-repository";

/**
 * IMP-048 Increment 4: Admin Panel inventory read use cases. Orchestration
 * only, exactly like `admin-product-queries.ts`/`admin-discount-queries.ts`
 * — `available`/`reserved`/`stockQuantity` are never recomputed here, only
 * ever read from `InventoryRepository.getProductAvailability`, the one
 * place that calculation lives.
 */

/**
 * Display-only "low stock" threshold for the inventory list, independent
 * of `InventoryRepository.listLowStockProducts` (which this file does not
 * use — this view lists every searched-for product, tracked or not, and
 * only flags the already-computed `available` value against this
 * threshold, never a second availability calculation).
 */
const LOW_STOCK_THRESHOLD = 5;

export interface AdminInventoryListItem {
  productId: string;
  name: string;
  slug: string;
  trackInventory: boolean;
  stockQuantity: number;
  reserved: number;
  available: number | null;
  lowStock: boolean;
}

export interface AdminInventoryListOptions {
  search?: string;
  page: number;
  pageSize: number;
}

export interface AdminInventoryListPage {
  items: AdminInventoryListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listAdminInventory(
  productRepository: ProductRepository,
  inventoryRepository: InventoryRepository,
  options: AdminInventoryListOptions,
): Promise<AdminInventoryListPage> {
  const { search, page, pageSize } = options;
  const { items: products, total } = await productRepository.listForAdmin({
    filter: search ? { search } : undefined,
    sort: { field: "updatedAt", direction: "desc" },
    page,
    pageSize,
  });

  const items = await Promise.all(
    products.map(async (product) => {
      const availability = await inventoryRepository.getProductAvailability(product.id);
      const available = availability?.available ?? null;
      return {
        productId: product.id,
        name: product.name,
        slug: product.slug,
        trackInventory: availability?.trackInventory ?? false,
        stockQuantity: availability?.stockQuantity ?? 0,
        reserved: availability?.reserved ?? 0,
        available,
        lowStock: available !== null && available <= LOW_STOCK_THRESHOLD,
      };
    }),
  );

  return { items, total, page, pageSize };
}

export interface AdminInventoryProductDetail {
  productId: string;
  name: string;
  slug: string;
  trackInventory: boolean;
  stockQuantity: number;
  reserved: number;
  available: number | null;
}

export async function getAdminInventoryProduct(
  productRepository: ProductRepository,
  inventoryRepository: InventoryRepository,
  productId: string,
): Promise<AdminInventoryProductDetail | null> {
  const product = await productRepository.findByIdForAdmin(productId);
  if (!product) {
    return null;
  }
  // `product` existing guarantees `getProductAvailability` returns
  // non-null (same row), but it is still read through the one shared
  // calculation rather than re-derived from `product` directly.
  const availability = await inventoryRepository.getProductAvailability(productId);
  return {
    productId: product.id,
    name: product.name,
    slug: product.slug,
    trackInventory: availability?.trackInventory ?? false,
    stockQuantity: availability?.stockQuantity ?? 0,
    reserved: availability?.reserved ?? 0,
    available: availability?.available ?? null,
  };
}

export async function listAdminStockHistory(
  inventoryRepository: InventoryRepository,
  options: StockAdjustmentListOptions,
): Promise<StockAdjustmentListPage> {
  return inventoryRepository.listStockAdjustments(options);
}
