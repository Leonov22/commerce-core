const DEFAULT_CALLBACK_URL = "/account";

/**
 * Validates an untrusted `callbackUrl` query-string value before it is ever
 * handed to `router.push()` after sign-in/registration (IMP-0XX, account-
 * first checkout). A `callbackUrl` read from the URL is attacker-
 * influenceable input — passing it through unvalidated would be an open
 * redirect. Only a same-origin, internal path is accepted; anything else
 * falls back to `/account`, never the raw value.
 *
 * Rejects, specifically:
 * - absolute URLs with a scheme (`https://evil.example`, `javascript:...`);
 * - protocol-relative URLs (`//evil.example`) — browsers resolve these
 *   against the current scheme, so they are external despite having no
 *   explicit scheme;
 * - backslash variants (`/\evil.example`, `\\evil.example`) — some browsers
 *   normalize a leading backslash the same as a forward slash, which would
 *   otherwise smuggle a protocol-relative URL past a naive `startsWith("/")`
 *   check;
 * - anything not starting with exactly one `/` (relative paths without a
 *   leading slash, empty strings, `undefined`/`null`).
 *
 * Kept as a plain, framework-independent function — no Next.js, no
 * `next-intl` — so it is directly unit-testable and reusable from any page
 * or form that needs to propagate a return destination.
 */
export function resolveSafeCallbackUrl(value: string | null | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    return DEFAULT_CALLBACK_URL;
  }

  // Exactly one leading "/", never "//" or "/\" or a bare "\".
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return DEFAULT_CALLBACK_URL;
  }
  if (value.includes("\\")) {
    return DEFAULT_CALLBACK_URL;
  }

  // A scheme (`javascript:`, `https:`, ...) anywhere before the first "/"
  // or "?" would make this an absolute URL in some parsers despite the
  // leading "/" check above (e.g. "/\t/evil.example" variants some URL
  // parsers still treat as relative) — reject any colon before the query
  // string as a defense-in-depth measure, not just the obvious cases.
  const queryIndex = value.indexOf("?");
  const pathPart = queryIndex === -1 ? value : value.slice(0, queryIndex);
  if (pathPart.includes(":")) {
    return DEFAULT_CALLBACK_URL;
  }

  return value;
}
