/**
 * Pure decision logic for whether `prisma/set-product-currency.ts` actually
 * succeeded. `prisma.product.updateMany` can silently match FEWER rows than
 * expected (e.g. a configured id no longer exists) while still resolving
 * without error — this is the check that closes that gap: exactly
 * `expectedCount` rows updated is success; anything else — zero, or a
 * partial match — is a failure the script must report and roll back,
 * never silently accept.
 *
 * Kept as a plain, Prisma-independent function (mirroring
 * `featured-provisioning.ts`'s own reasoning) specifically so it is
 * importable both from `prisma/set-product-currency.ts` (run via plain
 * `tsx`) and from this file's own Vitest test, without either context
 * executing any database operation merely by importing it.
 */
export interface ProductCurrencyProvisioningOutcome {
  ok: boolean;
  expectedCount: number;
  actualCount: number;
  message: string;
}

export function evaluateProductCurrencyProvisioning(
  expectedCount: number,
  actualCount: number,
): ProductCurrencyProvisioningOutcome {
  if (actualCount === expectedCount) {
    return {
      ok: true,
      expectedCount,
      actualCount,
      message: `Updated ${actualCount} product(s) to the target currency, as expected.`,
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
      `Expected ${expectedCount} product(s) to be updated, but ${detail}. ` +
      "No changes were applied (the transaction was rolled back) — verify the " +
      "configured product ids actually exist in this database before retrying.",
  };
}
