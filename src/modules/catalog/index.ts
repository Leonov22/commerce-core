/**
 * Public entry point for the catalog module. Other modules, the app
 * router, and the read-only client transport must import catalog
 * functionality through here rather than reaching into
 * `@/modules/catalog/domain/...`, `.../infrastructure/...`, or
 * `.../repositories/...` directly.
 */
import "server-only";
import { prismaProductRepository } from "@/modules/catalog/infrastructure/prisma-product-repository";
import { prismaInventoryRepository } from "@/modules/catalog/infrastructure/prisma-inventory-repository";
import * as catalogQueries from "@/modules/catalog/application/catalog-queries";
import * as adminProductQueries from "@/modules/catalog/application/admin-product-queries";
import * as adminProductCommands from "@/modules/catalog/application/admin-product-commands";
import * as adminCategoryCommands from "@/modules/catalog/application/admin-category-commands";
import * as adminProductImageCommands from "@/modules/catalog/application/admin-product-image-commands";
import * as adminDiscountCommands from "@/modules/catalog/application/admin-discount-commands";
import * as adminDiscountQueries from "@/modules/catalog/application/admin-discount-queries";
import * as adminInventoryQueries from "@/modules/catalog/application/admin-inventory-queries";
import * as adminInventoryCommands from "@/modules/catalog/application/admin-inventory-commands";
import { deleteProductImageBlob as deleteProductImageBlobImpl } from "@/modules/catalog/infrastructure/product-image-blob-storage";
import type {
  ProductListFilter,
  AdminProductListOptions,
  AdminDiscountListOptions,
} from "@/modules/catalog/repositories/product-repository";
import type { RawAdminProductInput } from "@/modules/catalog/application/admin-product-commands";
import type { RawAdminCategoryInput } from "@/modules/catalog/application/admin-category-commands";
import type { ConfirmProductImageUploadInput } from "@/modules/catalog/application/admin-product-image-commands";
import type { RawAdminDiscountInput } from "@/modules/catalog/application/admin-discount-commands";
import type { ReserveStockInput } from "@/modules/catalog/repositories/inventory-repository";
import type { AdminInventoryListOptions } from "@/modules/catalog/application/admin-inventory-queries";
import type {
  RawSetTrackInventoryInput,
  RawAdjustStockInput,
} from "@/modules/catalog/application/admin-inventory-commands";
import type { StockAdjustmentListOptions } from "@/modules/catalog/repositories/inventory-repository";

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

// Admin Panel (IMP-043) — exported from this same barrel, not a separate
// module entry point: it is the same Catalog domain/repository, just with
// broader, authorization-gated operations the storefront never needed.
export type { AdminProduct, AdminProductListItem } from "@/modules/catalog/domain/admin-product";
export type {
  AdminProductListFilter,
  AdminProductListOptions,
  AdminProductListPage,
  AdminProductSortField,
} from "@/modules/catalog/repositories/product-repository";
export type {
  RawAdminProductInput,
  CreateAdminProductResult,
  UpdateAdminProductResult,
  AdminProductValidationError,
} from "@/modules/catalog/application/admin-product-commands";
export type {
  RawAdminCategoryInput,
  CreateAdminCategoryResult,
} from "@/modules/catalog/application/admin-category-commands";
export type {
  ConfirmProductImageUploadInput,
  ConfirmProductImageUploadResult,
  RemoveProductImageResult,
  AdminProductImageError,
} from "@/modules/catalog/application/admin-product-image-commands";
export type { DiscountType, ProductDiscount } from "@/modules/catalog/domain/discount";
export type {
  AdminDiscountListOptions,
  AdminDiscountListPage,
  AdminDiscountListItem,
} from "@/modules/catalog/repositories/product-repository";
export type {
  RawAdminDiscountInput,
  AdminDiscountValidationError,
  CreateAdminDiscountResult,
  UpdateAdminDiscountResult,
  SetAdminDiscountActiveResult,
  RemoveAdminDiscountResult,
} from "@/modules/catalog/application/admin-discount-commands";

// IMP-048 Increment 3: only the two operations Order's checkout
// integration needs (`reserveStock`, `releaseReservation`) are exposed
// here. `consumeReservation`/`securePaymentWindow`/etc. still have no
// caller and remain unexported. `adjustStock`/`getProductAvailability`/
// `listStockAdjustments`/`setTrackInventory` now have one: the Admin
// Panel inventory feature below (IMP-048 Increment 4) — exposed only
// through its own `AdminInventory*`/`AdjustProductStock*`/
// `SetTrackInventory*` wrapper functions and types, never by exporting
// `InventoryRepository`/`prismaInventoryRepository` themselves.
export type {
  ReserveStockInput,
  ReserveStockResult,
  ReleaseReservationResult,
} from "@/modules/catalog/repositories/inventory-repository";

// Admin Panel inventory management (IMP-048 Increment 4).
export type { StockAdjustment } from "@/modules/catalog/domain/inventory";
export type {
  AdminInventoryListItem,
  AdminInventoryListOptions,
  AdminInventoryListPage,
  AdminInventoryProductDetail,
} from "@/modules/catalog/application/admin-inventory-queries";
export type {
  StockAdjustmentListOptions,
  StockAdjustmentListItem,
  StockAdjustmentListPage,
} from "@/modules/catalog/repositories/inventory-repository";
export type {
  RawSetTrackInventoryInput,
  SetTrackInventoryResult,
  RawAdjustStockInput,
  AdjustProductStockResult,
} from "@/modules/catalog/application/admin-inventory-commands";
export type { AdjustStockResult } from "@/modules/catalog/repositories/inventory-repository";

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

export function listAdminProducts(options: AdminProductListOptions) {
  return adminProductQueries.listAdminProducts(prismaProductRepository, options);
}

export function getAdminProduct(id: string) {
  return adminProductQueries.getAdminProduct(prismaProductRepository, id);
}

export function createAdminProduct(input: RawAdminProductInput) {
  return adminProductCommands.createAdminProduct(prismaProductRepository, input);
}

export function updateAdminProduct(id: string, input: RawAdminProductInput) {
  return adminProductCommands.updateAdminProduct(prismaProductRepository, id, input);
}

export function createAdminCategory(input: RawAdminCategoryInput) {
  return adminCategoryCommands.createAdminCategory(prismaProductRepository, input);
}

export function confirmAdminProductImageUpload(input: ConfirmProductImageUploadInput) {
  return adminProductImageCommands.confirmAdminProductImageUpload(prismaProductRepository, input);
}

export function removeAdminProductImage(productId: string) {
  return adminProductImageCommands.removeAdminProductImage(prismaProductRepository, productId);
}

/** IMP-046: re-exported so route code never reaches into `@/modules/catalog/infrastructure` directly. */
export function deleteProductImageBlob(url: string) {
  return deleteProductImageBlobImpl(url);
}

export function listAdminDiscounts(options: AdminDiscountListOptions) {
  return adminDiscountQueries.listAdminDiscounts(prismaProductRepository, options);
}

export function getAdminDiscount(id: string) {
  return adminDiscountQueries.getAdminDiscount(prismaProductRepository, id);
}

export function createAdminDiscount(input: RawAdminDiscountInput) {
  return adminDiscountCommands.createAdminDiscount(prismaProductRepository, input);
}

export function updateAdminDiscount(id: string, input: RawAdminDiscountInput) {
  return adminDiscountCommands.updateAdminDiscount(prismaProductRepository, id, input);
}

export function setAdminDiscountActive(id: string, isActive: boolean) {
  return adminDiscountCommands.setAdminDiscountActive(prismaProductRepository, id, isActive);
}

export function removeAdminDiscount(id: string) {
  return adminDiscountCommands.removeAdminDiscount(prismaProductRepository, id);
}

// IMP-048 Increment 3 — see this file's own export-type comment above for
// why only these two inventory operations are exposed so far.
export function reserveStock(input: ReserveStockInput) {
  return prismaInventoryRepository.reserveStock(input);
}

export function releaseReservation(orderId: string, productId: string) {
  return prismaInventoryRepository.releaseReservation(orderId, productId);
}

// Admin Panel inventory management (IMP-048 Increment 4). Every function
// below is the ONLY sanctioned way for route/UI code to reach the
// inventory domain — none of them hands back `InventoryRepository` or
// `prismaInventoryRepository` itself.
export function listAdminInventory(options: AdminInventoryListOptions) {
  return adminInventoryQueries.listAdminInventory(
    prismaProductRepository,
    prismaInventoryRepository,
    options,
  );
}

export function getAdminInventoryProduct(productId: string) {
  return adminInventoryQueries.getAdminInventoryProduct(
    prismaProductRepository,
    prismaInventoryRepository,
    productId,
  );
}

export function listAdminStockHistory(options: StockAdjustmentListOptions) {
  return adminInventoryQueries.listAdminStockHistory(prismaInventoryRepository, options);
}

export function setProductTrackInventory(
  productId: string,
  input: RawSetTrackInventoryInput,
  adminUserId: string | null,
) {
  return adminInventoryCommands.setProductTrackInventory(
    prismaInventoryRepository,
    productId,
    input,
    adminUserId,
  );
}

export function adjustProductStock(input: RawAdjustStockInput, adminUserId: string | null) {
  return adminInventoryCommands.adjustProductStock(prismaInventoryRepository, input, adminUserId);
}
