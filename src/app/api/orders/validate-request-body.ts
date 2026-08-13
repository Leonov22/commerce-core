/**
 * `request.json()` parses any valid JSON document — `null`, arrays,
 * strings, numbers, and booleans all succeed — but only a genuine object is
 * a usable request body; anything else must be rejected before property
 * access like `body.customer` is attempted downstream.
 *
 * Kept in its own module (rather than inline in `route.ts`) so it can be
 * unit-tested without importing the route handler itself, which transitively
 * pulls in a `.tsx` component this project's Vitest config has no JSX
 * transform for.
 */
export function isPlainRequestObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
