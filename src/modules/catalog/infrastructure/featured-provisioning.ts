/**
 * CR-037-FIX-01: pure decision logic for whether
 * `prisma/set-featured-products.ts` actually succeeded.
 * `prisma.product.updateMany` can silently match FEWER rows than
 * expected (e.g. a configured id no longer exists) while still
 * resolving without error — the script previously logged whatever
 * count it got and always exited 0, regardless of whether that count
 * matched what was actually expected. This is the check that closes
 * that gap: exactly `expectedCount` rows updated is success; anything
 * else — zero, or a partial match — is a failure the script must
 * report and exit non-zero for, never silently accept.
 *
 * Kept as a plain, Prisma-independent function (mirroring
 * `seed-guard.ts`'s own reasoning) specifically so it is importable
 * both from `prisma/set-featured-products.ts` (run via plain `tsx`)
 * and from this file's own Vitest test, without either context
 * executing any database operation merely by importing it.
 */
export interface FeaturedProvisioningOutcome {
  ok: boolean;
  expectedCount: number;
  actualCount: number;
  message: string;
}

export function evaluateFeaturedProvisioning(
  expectedCount: number,
  actualCount: number,
): FeaturedProvisioningOutcome {
  if (actualCount === expectedCount) {
    return {
      ok: true,
      expectedCount,
      actualCount,
      message: `Marked ${actualCount} product(s) as featured, as expected.`,
    };
  }

  const detail =
    actualCount === 0
      ? "none of them matched"
      : `only ${actualCount} of them matched (partial match)`;

  return {
    ok: false,
    expectedCount,
    actualCount,
    message:
      `Expected ${expectedCount} featured product(s) to be updated, but ${detail}. ` +
      "Verify the configured product ids actually exist in this database before retrying.",
  };
}
