/**
 * Validates the `Idempotency-Key` header value (IMP-031). Bounded length and
 * a safe, restricted character set — this is an opaque correlation token,
 * never authorization and never a payload carrier, so it must not accept
 * arbitrary-length or arbitrary-content strings.
 *
 * Kept in its own module (rather than inline in `route.ts`) so it can be
 * unit-tested without importing the route handler itself, which transitively
 * pulls in a `.tsx` component this project's Vitest config has no JSX
 * transform for — same reasoning as `validate-request-body.ts`.
 */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const IDEMPOTENCY_KEY_MIN_LENGTH = 16;
const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

export function isValidIdempotencyKey(value: string): boolean {
  return (
    value.length >= IDEMPOTENCY_KEY_MIN_LENGTH &&
    value.length <= IDEMPOTENCY_KEY_MAX_LENGTH &&
    IDEMPOTENCY_KEY_PATTERN.test(value)
  );
}
