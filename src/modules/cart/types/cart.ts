/**
 * Cart owns cart state, not product data. A CartItem only references a
 * product by its existing catalog identifier and how many units are in the
 * cart — it never duplicates name, price, category, or image data. Product
 * display information always comes from the catalog presentation layer.
 */
export interface CartItem {
  productId: string;
  quantity: number;
}

export type CartState = CartItem[];

/**
 * Checkout is reachable only once Catalog resolution has finished and every
 * Cart line resolves to a real, currently-ACTIVE product. `resolvedProductIds`
 * is whatever the Catalog transport returned for the requested ids — a
 * missing id there means unresolved, unavailable, or non-ACTIVE, and Cart
 * has no way (and no need) to tell those apart.
 */
export function canCheckout(
  items: CartItem[],
  resolvedProductIds: ReadonlyMap<string, unknown>,
  isCatalogLoading: boolean,
): boolean {
  return (
    items.length > 0 &&
    !isCatalogLoading &&
    items.every((item) => resolvedProductIds.has(item.productId))
  );
}
