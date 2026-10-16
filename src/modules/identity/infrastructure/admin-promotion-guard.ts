/**
 * IMP-044: fail-closed confirmation gate for `prisma/promote-user-to-admin.ts`,
 * mirroring `product-currency-migration-guard.ts`'s own rationale exactly —
 * merely having `DATABASE_URL` set proves nothing about operator intent, so
 * promoting a real user to `ADMIN` requires a separate, explicit
 * confirmation set anew for the run, never inferred from `DATABASE_URL`
 * itself or any invented environment name.
 *
 * Kept as a plain, framework-independent function so it is importable both
 * from the script (run via plain `tsx`) and from this file's own test.
 */

export const ADMIN_PROMOTION_CONFIRMATION_ENV_VAR = "ADMIN_PROMOTION_CONFIRM";
export const ADMIN_PROMOTION_CONFIRMATION_VALUE =
  "yes-i-have-verified-DATABASE_URL-targets-the-intended-database";

export const ADMIN_PROMOTION_EMAIL_ENV_VAR = "ADMIN_PROMOTION_EMAIL";

/**
 * `undefined`/missing, empty, or any value other than the exact
 * confirmation string is treated as "not confirmed" — there is no
 * partial-credit or case-insensitive match.
 */
export function isAdminPromotionConfirmed(env: Record<string, string | undefined>): boolean {
  return env[ADMIN_PROMOTION_CONFIRMATION_ENV_VAR] === ADMIN_PROMOTION_CONFIRMATION_VALUE;
}
