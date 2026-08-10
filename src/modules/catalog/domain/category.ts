/**
 * Catalog domain entity for Category. Framework independent — see
 * `product.ts` for the same rule applied there.
 */

export interface CategoryTranslation {
  locale: string;
  name: string;
}

export interface Category {
  id: string;
  slug: string;
  sortOrder: number;
  /** Translation resolved for the locale that was requested. */
  translation: CategoryTranslation;
}
