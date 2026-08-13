/**
 * Kept separate from `route.ts` for the same reason
 * `api/orders/validate-request-body.ts` is separate from `api/orders/route.ts`:
 * this project's Vitest config has no JSX transform, so importing the route
 * handler itself (which pulls in `@/modules/identity`'s presentation
 * components transitively) can't be done from a test file. This module has
 * no such dependency and is fully unit-testable in isolation.
 *
 * Deliberately does not call `registerUser` or touch Identity at all — it
 * only decides whether the raw request body is well-formed enough to
 * attempt registration. Password/email *rule* validation (format, minimum
 * length, duplicate email) stays exclusively inside `registerUser()` — this
 * parser must never reimplement any of that.
 */

const MAX_EMAIL_LENGTH = 254; // RFC 5321 practical limit.
const MAX_PASSWORD_LENGTH = 200; // Basic oversized-input guard, not a strength rule.

export type ParseRegistrationRequestResult =
  | { ok: true; email: string; password: string }
  | { ok: false; error: "INVALID_REQUEST" }
  | { ok: false; error: "PASSWORD_MISMATCH" };

export function parseRegistrationRequestBody(rawBody: unknown): ParseRegistrationRequestResult {
  if (typeof rawBody !== "object" || rawBody === null || Array.isArray(rawBody)) {
    return { ok: false, error: "INVALID_REQUEST" };
  }

  const { email, password, confirmPassword } = rawBody as Record<string, unknown>;

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    typeof confirmPassword !== "string" ||
    email.length === 0 ||
    email.length > MAX_EMAIL_LENGTH ||
    password.length === 0 ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return { ok: false, error: "INVALID_REQUEST" };
  }

  if (password !== confirmPassword) {
    return { ok: false, error: "PASSWORD_MISMATCH" };
  }

  return { ok: true, email, password };
}
