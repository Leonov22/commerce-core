/**
 * `sessionStorage` persistence for ONE product's unresolved stock-
 * adjustment outcome (IMP-048 Increment 4, Chat 3 Finding, rounds 5–6).
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
 *
 * Round 6: a plain boolean return from a read can't distinguish "no
 * flag was ever stored" from "storage could not be read at all" (a
 * thrown exception swallowed into the same `false`) — the form needs
 * to react very differently to those two cases (see
 * `AdminInventoryAdjustForm`'s own doc comment for why conflating them
 * was a real bug, not a style nitpick). `readUnresolvedAdjustmentOutcome`
 * now returns a tri-state result instead. Likewise, a write's success
 * now has to be reported back — a form that just set its in-memory
 * flag to `true` needs to know whether that same fact actually made it
 * into storage, so it can be honest about whether the warning will
 * survive a remount.
 */

const STORAGE_KEY_PREFIX = "commerce-core.admin-inventory-adjust.unresolved-outcome.";

function storageKey(productId: string): string {
  return `${STORAGE_KEY_PREFIX}${productId}`;
}

export type UnresolvedOutcomeReadResult =
  /** A flag was found — a prior attempt for this product, in this tab, is still unresolved. */
  | { status: "present" }
  /** No flag was ever stored for this product — reading succeeded, and there is definitively nothing to restore. */
  | { status: "absent" }
  /** Reading could not complete reliably (SSR, private-browsing storage restrictions, or any other thrown error) — this is NOT the same as "absent"; the caller must not treat it as a clean state. */
  | { status: "unreadable" };

/**
 * Never throws. Distinguishes "no flag" from "could not check" — see
 * `UnresolvedOutcomeReadResult`'s own doc comment. SSR (`window`
 * undefined) is reported as `"unreadable"`, not `"absent"`, for the
 * same reason: this function is never actually called during SSR by
 * `AdminInventoryAdjustForm` (the read only happens inside a
 * client-only `useEffect`), but a caller that ever did invoke it
 * during SSR must not be told "definitely no unresolved outcome" when
 * the truth is "we didn't check."
 */
export function readUnresolvedAdjustmentOutcome(productId: string): UnresolvedOutcomeReadResult {
  if (typeof window === "undefined") {
    return { status: "unreadable" };
  }
  try {
    const raw = window.sessionStorage.getItem(storageKey(productId));
    return raw === "true" ? { status: "present" } : { status: "absent" };
  } catch {
    return { status: "unreadable" };
  }
}

/**
 * Never throws. Returns whether the write is actually believed to
 * have persisted — `false` on SSR, a quota failure, private-browsing
 * storage restrictions, or `sessionStorage` disabled entirely. The
 * in-memory `hasUnknownOutcome` flag in the calling component is set
 * regardless of this return value (the CURRENT mount's warning must
 * show either way) — the return value exists purely so the caller can
 * be honest about whether that warning will survive a remount, rather
 * than silently promising persistence that didn't actually happen.
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
export function markAdjustmentOutcomeUnresolved(productId: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    window.sessionStorage.setItem(storageKey(productId), "true");
    return true;
  } catch {
    return false;
  }
}
