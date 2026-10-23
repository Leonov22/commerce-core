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

/** EUR is this store's only currency (business decision) — shown only if the cart has no resolved products at all. */
const DEFAULT_CURRENCY = "EUR";

export interface CartSubtotal {
  amountMinor: number;
  currency: string;
}

/**
 * Sums each resolved line's `effectivePriceAmountMinor` — the price
 * actually charged after any discount, the SAME field Checkout's own
 * `createOrderFromCheckout` sums via `lineTotalAmountMinor` (see that
 * module's own doc comment) — never `priceAmountMinor`, today's regular,
 * pre-discount price, which is shown elsewhere only as a strikethrough
 * comparison. A cart line whose product hasn't resolved (removed,
 * inactive, still loading) contributes nothing to the sum; `canCheckout`
 * is what gates whether checkout is reachable in that case, not this
 * calculation. Pulled out of `CartSummary` so the subtotal math is
 * directly unit-testable without rendering a React tree.
 */
export function calculateCartSubtotal(
  items: CartItem[],
  productsById: ReadonlyMap<string, { effectivePriceAmountMinor: number; currency: string }>,
): CartSubtotal {
  let amountMinor = 0;
  let currency = DEFAULT_CURRENCY;
  for (const item of items) {
    const product = productsById.get(item.productId);
    if (product) {
      amountMinor += product.effectivePriceAmountMinor * item.quantity;
      currency = product.currency;
    }
  }
  return { amountMinor, currency };
}
