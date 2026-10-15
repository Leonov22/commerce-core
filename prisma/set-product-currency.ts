/**
 * The production-safe way to move an EXISTING catalog's products onto a
 * new currency code (business decision: EUR is now this store's
 * default/only currency) without the risk `prisma/seed.ts`'s broad
 * upserts carry. Unlike `seed.ts`, this script touches EXCLUSIVELY the
 * `currency` column on the listed, already-existing product ids — it
 * never creates a product and cannot touch price, status, category,
 * badge, sort order, slug, publication date, `isFeatured`, or any
 * translation. The numeric `priceAmountMinor` is never read or written
 * by this script — this is a currency CODE change only, deliberately
 * never an exchange-rate conversion. Idempotent: running it any number
 * of times produces the same result.
 *
 * Mirrors `prisma/set-featured-products.ts`'s narrowly-scoped-`updateMany`
 * + exact-expected-count verification shape, the established precedent
 * for a safe, targeted provisioning script since CR-037-01-SEED — with
 * one addition: the update and the count check run inside a single
 * `prisma.$transaction`, so a partial match (fewer than all configured
 * ids found) is rolled back entirely instead of leaving some products
 * already converted to EUR. See `evaluateProductCurrencyProvisioning`'s
 * own doc comment for the decision logic this relies on.
 *
 * PR2-F01: the narrow scope of the WRITE above says nothing about
 * whether `DATABASE_URL` actually points at the database the operator
 * intends to migrate — running this against the wrong database by
 * accident (a leftover connection string from a different project or
 * session) would silently "succeed" against data nobody meant to touch.
 * `assertMigrationIsConfirmed` below therefore refuses to proceed
 * (before any Prisma client is even constructed) unless the operator
 * has set an explicit, separate confirmation value for this run — see
 * `product-currency-migration-guard.ts`'s own doc comment for why this
 * is deliberately not based on `NODE_ENV` or any invented environment
 * name, and never compared against `DATABASE_URL` itself.
 *
 * Existing Order/Payment rows are never touched by this script (it only
 * updates `Product`) — their own `currency`/`amountMinor` are an
 * immutable snapshot captured at checkout time (see
 * `checkout-order.ts`'s own doc comment on why), so historical
 * orders/payments remain exactly as they were regardless of what this
 * script does to the current catalog.
 *
 * Before running, verify `DATABASE_URL` (in your shell environment or
 * `.env.local`) actually points at the database you intend to migrate.
 * Then run with:
 *   PRODUCT_CURRENCY_MIGRATION_CONFIRM="yes-i-have-verified-DATABASE_URL-targets-the-intended-database" \
 *     pnpm exec tsx prisma/set-product-currency.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { evaluateProductCurrencyProvisioning } from "@/modules/catalog/infrastructure/product-currency-provisioning";
import {
  isProductCurrencyMigrationConfirmed,
  PRODUCT_CURRENCY_MIGRATION_CONFIRMATION_ENV_VAR,
  PRODUCT_CURRENCY_MIGRATION_CONFIRMATION_VALUE,
} from "@/modules/catalog/infrastructure/product-currency-migration-guard";

/** The same six seeded demo products `prisma/seed.ts` defines. */
const PRODUCT_IDS = ["1", "2", "3", "4", "5", "6"];
const TARGET_CURRENCY = "EUR";

function assertMigrationIsConfirmed(): void {
  if (isProductCurrencyMigrationConfirmed(process.env)) {
    return;
  }
  console.error(
    "[prisma/set-product-currency.ts] Refused: this script writes to whichever " +
      "database DATABASE_URL currently points to. Having DATABASE_URL set is not " +
      "by itself confirmation that this is the intended target — a leftover or " +
      "copy-pasted connection string from a different project or session would " +
      "otherwise be written to silently.\n\n" +
      "Before running this script, verify DATABASE_URL points at the database " +
      "you actually intend to migrate, then set:\n" +
      `  ${PRODUCT_CURRENCY_MIGRATION_CONFIRMATION_ENV_VAR}=${PRODUCT_CURRENCY_MIGRATION_CONFIRMATION_VALUE}\n\n` +
      "in the environment before retrying.",
  );
  process.exit(1);
}

assertMigrationIsConfirmed();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // The update and the exact-count check run inside one interactive
  // transaction: `updateMany` can silently match fewer rows than
  // `PRODUCT_IDS.length` (e.g. a configured id no longer exists) while
  // still resolving without error, and checking the count only AFTER a
  // non-transactional write would leave that partial match permanently
  // applied. Throwing inside this callback makes Prisma roll back
  // everything the callback did via `tx`, so a partial match is undone
  // entirely rather than left half-migrated.
  const outcome = await prisma.$transaction(async (tx) => {
    const result = await tx.product.updateMany({
      where: { id: { in: PRODUCT_IDS } },
      data: { currency: TARGET_CURRENCY },
    });

    const evaluated = evaluateProductCurrencyProvisioning(PRODUCT_IDS.length, result.count);
    if (!evaluated.ok) {
      throw new Error(evaluated.message);
    }
    return evaluated;
  });

  console.log(outcome.message);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
