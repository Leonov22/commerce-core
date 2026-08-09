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
    {
      id: "1",
      translationKey: "studioChair",
      categoryKey: "seating",
      badgeKey: "new",
      priceAmount: 240,
    },
    { id: "2", translationKey: "loungeChair", categoryKey: "seating", priceAmount: 310 },
    {
      id: "3",
      translationKey: "tableLamp",
      categoryKey: "lighting",
      badgeKey: "limited",
      priceAmount: 96,
    },
    { id: "4", translationKey: "pendantLight", categoryKey: "lighting", priceAmount: 145 },
    { id: "5", translationKey: "woolThrow", categoryKey: "textiles", priceAmount: 128 },
    { id: "6", translationKey: "ceramicVase", categoryKey: "decor", priceAmount: 86 },
  ];
}

export function getCatalogCategories(): CatalogCategoryKey[] {
  return ["seating", "lighting", "textiles", "decor"];
}

export function getCatalogProductById(id: string): CatalogProduct | undefined {
  return getCatalogProducts().find((product) => product.id === id);
}
