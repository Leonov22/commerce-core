/**
 * CR-037-01-SEED: `prisma/seed.ts` performs BROAD upserts of product and
 * translation records, capable of overwriting existing catalog data —
 * price, status, category, badge, sort order, slug, publication date,
 * and every translation field. It is development/test fixture data
 * only and must never run against a shared or production database.
 *
 * This is the fail-closed gate that script checks before constructing a
 * Prisma client or touching the database at all: broad seeding proceeds
 * ONLY if this explicit, deliberately unambiguous confirmation value is
 * present. Deliberately NOT based on `NODE_ENV` — a standalone `tsx`
 * script invocation has no reliable guarantee that `NODE_ENV` reflects
 * which database `DATABASE_URL` actually points at, so treating
 * `NODE_ENV !== "production"` as "safe to seed" would be a false sense
 * of security, not a real one.
 *
 * Kept as a plain, framework-independent function (no `server-only`, no
 * Prisma import) specifically so it can be imported both from
 * `prisma/seed.ts` (run via plain `tsx`, outside Next.js/Vitest's
 * module resolution) and from this file's own Vitest test — a
 * `server-only`-guarded module cannot be imported from the former
 * context at all; see `server-only`'s own implementation, which throws
 * unconditionally outside the Next.js "react-server" resolution
 * condition Vitest configures for its own tests.
 */

export const SEED_CONFIRMATION_ENV_VAR = "SEED_ALLOW_BROAD_WRITE";
export const SEED_CONFIRMATION_VALUE = "yes-overwrite-demo-catalog";

export function isBroadSeedConfirmed(env: Record<string, string | undefined>): boolean {
  return env[SEED_CONFIRMATION_ENV_VAR] === SEED_CONFIRMATION_VALUE;
}
