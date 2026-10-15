/**
 * PR2-F01 (independent Code Review of PR #2): fail-closed confirmation
 * gate for `prisma/set-product-currency.ts`, checked before any Prisma
 * client is constructed or any query runs.
 *
 * Unlike CR-037-01-SEED's `SEED_ALLOW_BROAD_WRITE` (which guards against
 * an unintentionally BROAD write touching fields it shouldn't), this
 * script's write is already narrow — only `Product.currency`, only the
 * six configured ids — so the write itself carries no accidental-
 * overwrite risk. The risk this guards against is different: running the
 * script while `DATABASE_URL` points at a database the operator did not
 * actually mean to target (e.g. a connection string left exported from a
 * different project or a previous session). Merely having *some*
 * `DATABASE_URL` set proves nothing about operator intent, so this is a
 * separate, explicit confirmation that must be set anew for the run,
 * independent of whatever `DATABASE_URL` happens to contain — the two
 * are deliberately never compared against each other, since this
 * project defines no machine-checkable mapping from a connection string
 * to an environment name, and attempting to parse/compare one would
 * either leak connection details into an error message or create a
 * false sense of having actually verified the target.
 *
 * Deliberately NOT based on `NODE_ENV` or any invented staging/
 * production environment taxonomy — this project's own `docs/08-devops/`
 * is an undocumented placeholder and no code anywhere distinguishes a
 * "staging" environment, so inventing one here would be exactly the kind
 * of false sense of security `seed-guard.ts`'s own doc comment warns
 * against for the same reason. The operator must consciously confirm,
 * every run, that they have personally checked where `DATABASE_URL`
 * actually points before this script is allowed to write anything.
 *
 * Kept as a plain, framework-independent function (no `server-only`, no
 * Prisma import, no access to `process.env` itself) so it is importable
 * both from `prisma/set-product-currency.ts` (run via plain `tsx`) and
 * from this file's own Vitest test, and so it never has the opportunity
 * to read or print `DATABASE_URL`'s actual value.
 */

export const PRODUCT_CURRENCY_MIGRATION_CONFIRMATION_ENV_VAR = "PRODUCT_CURRENCY_MIGRATION_CONFIRM";
export const PRODUCT_CURRENCY_MIGRATION_CONFIRMATION_VALUE =
  "yes-i-have-verified-DATABASE_URL-targets-the-intended-database";

/**
 * `undefined`/missing, empty, or any value other than the exact
 * confirmation string is treated as "not confirmed" — there is no
 * partial-credit or case-insensitive match, so a copy-paste error is
 * never mistaken for a deliberate confirmation.
 */
export function isProductCurrencyMigrationConfirmed(
  env: Record<string, string | undefined>,
): boolean {
  return (
    env[PRODUCT_CURRENCY_MIGRATION_CONFIRMATION_ENV_VAR] ===
    PRODUCT_CURRENCY_MIGRATION_CONFIRMATION_VALUE
  );
}
