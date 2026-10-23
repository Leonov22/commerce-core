/**
 * `sessionStorage` persistence for ONE product's unresolved stock-
 * adjustment outcome (IMP-048 Increment 4, Chat 3 Finding, round 5).
 * `AdminInventoryAdjustForm`'s own `hasUnknownOutcome` React state
 * previously lived only in memory, so remounting the form — e.g.
 * navigating away from this product's inventory page and back within
 * the same tab — silently reset a real, still-open ambiguity back to
 * "resolved" even though nothing about the underlying risk had
 * changed and the same item was still fully actionable.
 *
 * `sessionStorage` is the deliberate choice here, not `localStorage`:
 * it is scoped to exactly one browser tab (a new tab, or the same tab
 * after it's closed and reopened, starts empty) and never shared with
 * another tab — exactly the "within the current browser tab" scope
 * this round's own requirement asks for. Contrast with
 * `cart-storage.ts`'s `localStorage`, which deliberately DOES need to
 * survive a new tab and a hard page reload, for a different reason
 * (see that file's own doc comment).
 *
 * Keyed per `productId` so an unresolved outcome for one product can
 * never contaminate another product's form. Stores nothing but a
 * single flag — never the request's quantity, reason, error body, or
 * any other payload.
 */

const STORAGE_KEY_PREFIX = "commerce-core.admin-inventory-adjust.unresolved-outcome.";

function storageKey(productId: string): string {
  return `${STORAGE_KEY_PREFIX}${productId}`;
}

/**
 * Never throws. Returns `false` for every failure case — SSR (`window`
 * undefined), `sessionStorage` unavailable (private browsing, disabled),
 * or simply no flag ever stored for this product.
 */
export function hasUnresolvedAdjustmentOutcome(productId: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.sessionStorage.getItem(storageKey(productId)) === "true";
  } catch {
    return false;
  }
}

/**
 * Never throws. A write failure (quota exceeded, private browsing,
 * `sessionStorage` disabled entirely) is silently swallowed — the
 * warning still shows for the CURRENT mount via in-memory React state
 * regardless; it simply won't survive a remount in that one case, the
 * same mount-local-only behavior this form already had before this
 * round's persistence existed.
 *
 * Deliberately one-directional: there is no corresponding "clear" or
 * "resolve" function in this module. A later success, a non-2xx
 * response, or another network failure is never evidence that an
 * EARLIER, still-ambiguous request did or did not commit (see
 * `AdminInventoryAdjustForm`'s own doc comment) — so nothing here ever
 * un-sets this flag. It is cleared only by the browser itself, when
 * the tab closes (`sessionStorage`'s own ordinary lifetime); there is
 * no other dismissal mechanism in this round's scope.
 */
export function markAdjustmentOutcomeUnresolved(productId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(storageKey(productId), "true");
  } catch {
    // Intentionally ignored — see doc comment above.
  }
}
