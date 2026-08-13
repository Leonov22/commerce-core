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
