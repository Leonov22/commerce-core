import { isAdminUser } from "@/modules/identity/domain/user";
import type { User } from "@/modules/identity/domain/user";

/**
 * Pure redirect decisions for the Customer account pages (IMP-028) — no
 * Next.js `redirect()`, no React, so they're unit-testable without
 * rendering anything. Callers (Server Component pages) resolve the current
 * user via `getCurrentUser()`, pass it in here, and call Next's `redirect()`
 * themselves only when a path is returned.
 */

/** `/account`: guests are sent to sign in; authenticated customers proceed. */
export function resolveProtectedPageRedirect(user: User | null): string | null {
  return user ? null : "/account/login";
}

/** `/account/login`, `/account/register`: already-authenticated customers are sent to their dashboard instead. */
export function resolveGuestOnlyPageRedirect(user: User | null): string | null {
  return user ? "/account" : null;
}

/**
 * `/admin/**` (IMP-043): a guest is sent to sign in (the same login page
 * every customer uses — there is deliberately no separate admin
 * authentication system); an authenticated customer who isn't an admin is
 * sent home rather than shown a dead end or a misleading "sign in" prompt
 * they've already satisfied. This is the UI-level redirect only — every
 * admin API route independently re-checks `isAdminUser` itself (see e.g.
 * `api/admin/products/route.ts`), since hiding navigation or redirecting a
 * page is not an authorization boundary on its own.
 */
export function resolveAdminPageRedirect(user: User | null): string | null {
  if (!user) {
    return "/account/login";
  }
  if (!isAdminUser(user)) {
    return "/";
  }
  return null;
}
