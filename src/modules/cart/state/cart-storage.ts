import type { CartItem, CartState } from "@/modules/cart/types/cart";

/**
 * `localStorage` persistence for Cart (account-first checkout milestone).
 * Cart state itself (`cart-context.tsx`) was previously pure in-memory
 * `useReducer` state — it survived only as long as the React tree stayed
 * mounted, which is NOT guaranteed across the sign-in/registration
 * redirect round-trip (a hard page load, a refresh, or a new tab all lose
 * it). This module is the persistence layer underneath that state; it
 * never reads or writes anything beyond this one key, and never assumes
 * `localStorage` is available or that its contents are trustworthy —
 * `quantity`/`productId` are never re-trusted for pricing (Catalog/Order
 * creation already resolve those fresh server-side; see
 * `checkout-order.ts`), only for "which products, how many" to re-display.
 */

const CART_STORAGE_KEY = "commerce-core.cart";

function isValidCartItem(value: unknown): value is CartItem {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.productId === "string" &&
    candidate.productId.length > 0 &&
    typeof candidate.quantity === "number" &&
    Number.isInteger(candidate.quantity) &&
    candidate.quantity > 0
  );
}

/**
 * Never throws. Returns `[]` for every failure case — SSR (`window`
 * undefined), `localStorage` unavailable (private browsing, disabled),
 * missing/empty key, malformed JSON, or a value that isn't even an array.
 * A partially-malformed array (e.g. one corrupt entry mixed with valid
 * ones) keeps its valid entries rather than discarding the whole cart.
 */
export function loadCartFromStorage(): CartState {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isValidCartItem);
  } catch {
    return [];
  }
}

/**
 * Never throws. A write failure (quota exceeded, private browsing,
 * `localStorage` disabled entirely) is silently swallowed — the cart keeps
 * working for the current tab via in-memory state regardless; it simply
 * won't survive a refresh in that case, which is the same behavior this
 * cart already had before persistence existed at all.
 */
export function saveCartToStorage(items: CartState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Intentionally ignored — see doc comment above.
  }
}
