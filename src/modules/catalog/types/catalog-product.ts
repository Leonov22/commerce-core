export type CatalogCategoryKey = "seating" | "lighting" | "textiles" | "decor";

export type CatalogBadgeKey = "new" | "limited";

/**
 * Presentation-level catalog product. Deliberately minimal — only what the
 * current static visual catalog needs to render. Not a Product domain
 * entity: no inventory, pricing rules, or persistence concerns.
 */
export interface CatalogProduct {
  id: string;
  translationKey: string;
  categoryKey?: CatalogCategoryKey;
  badgeKey?: CatalogBadgeKey;
}
