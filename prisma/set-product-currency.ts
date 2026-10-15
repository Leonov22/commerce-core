/**
 * The production-safe way to move an EXISTING catalog's products onto a
 * new currency code (business decision: EUR is now this store's
 * default/only currency) without the risk `prisma/seed.ts`'s broad
 * upserts carry. Unlike `seed.ts`, this script touches EXCLUSIVELY the
 * `currency` column on the listed, already-existing product ids — it
 * never creates a product and cannot touch price, status, category,
 * badge, sort order, slug, publication date, `isFeatured`, or any
 * translation. Safe to run against any environment, including
 * production, because there is nothing else here to overwrite. The
 * numeric `priceAmountMinor` is never read or written by this script —
 * this is a currency CODE change only, deliberately never an
 * exchange-rate conversion. Idempotent: running it any number of times
 * produces the same result.
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
 * Existing Order/Payment rows are never touched by this script (it only
 * updates `Product`) — their own `currency`/`amountMinor` are an
 * immutable snapshot captured at checkout time (see
 * `checkout-order.ts`'s own doc comment on why), so historical
 * orders/payments remain exactly as they were regardless of what this
 * script does to the current catalog.
 *
 * Run with: pnpm exec tsx prisma/set-product-currency.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { evaluateProductCurrencyProvisioning } from "@/modules/catalog/infrastructure/product-currency-provisioning";

/** The same six seeded demo products `prisma/seed.ts` defines. */
const PRODUCT_IDS = ["1", "2", "3", "4", "5", "6"];
const TARGET_CURRENCY = "EUR";

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
