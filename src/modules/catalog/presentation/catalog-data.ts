import type { CatalogCategoryKey, CatalogProduct } from "@/modules/catalog/types/catalog-product";

/**
 * Static presentation data source for the catalog visual foundation.
 *
 * This intentionally mirrors the shape a future repository/API call would
 * return (`CatalogProduct[]`), so `CatalogView`/`CatalogBrowser` can be
 * rewired to a real data source later without changing their props or
 * rendering logic. No Prisma, no database, no Product domain entity.
 */
export function getCatalogProducts(): CatalogProduct[] {
  return [
    { id: "1", translationKey: "studioChair", categoryKey: "seating", badgeKey: "new" },
    { id: "2", translationKey: "loungeChair", categoryKey: "seating" },
    { id: "3", translationKey: "tableLamp", categoryKey: "lighting", badgeKey: "limited" },
    { id: "4", translationKey: "pendantLight", categoryKey: "lighting" },
    { id: "5", translationKey: "woolThrow", categoryKey: "textiles" },
    { id: "6", translationKey: "ceramicVase", categoryKey: "decor" },
  ];
}

export function getCatalogCategories(): CatalogCategoryKey[] {
  return ["seating", "lighting", "textiles", "decor"];
}
