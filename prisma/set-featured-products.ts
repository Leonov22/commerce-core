/**
 * CR-037-01-SEED: the production-safe way to populate `Product.isFeatured`
 * for the Homepage's Featured Products section. Unlike `prisma/seed.ts`
 * (broad upserts, guarded against running outside development/test), this
 * script touches EXCLUSIVELY the `isFeatured` column on the listed,
 * already-existing product ids — it never creates a product and cannot
 * touch price, status, category, badge, sort order, slug, publication
 * date, or any translation. Safe to run against any environment,
 * including production, because there is nothing else here to overwrite.
 * Idempotent: running it any number of times produces the same result.
 *
 * The actual update call mirrors `markProductsFeatured` in
 * `src/modules/catalog/infrastructure/feature-products.ts` (which is the
 * one covered by an automated integration test) rather than importing it:
 * that file has `import "server-only"`, which throws unconditionally
 * outside Next.js/Vitest's module resolution — this script runs under
 * plain `tsx`, the same constraint `prisma/seed.ts` already works around
 * by never importing from `src/modules/catalog/infrastructure/prisma-client.ts`
 * either.
 *
 * CR-037-FIX-01: `updateMany` can silently match fewer rows than
 * `FEATURED_PRODUCT_IDS.length` (e.g. a configured id no longer exists)
 * while still resolving without error. `evaluateFeaturedProvisioning`
 * (imported — it has no `server-only`/Prisma dependency, so it's safe to
 * import under plain `tsx`, unlike `feature-products.ts` above) is what
 * turns that raw count into an actual pass/fail: this script now only
 * reports success, and only exits 0, when EVERY configured id was
 * actually updated — never merely because the query didn't error.
 *
 * Run with: pnpm exec tsx prisma/set-featured-products.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { evaluateFeaturedProvisioning } from "@/modules/catalog/infrastructure/featured-provisioning";

/** The same four seeded demo products IMP-037 originally featured. */
const FEATURED_PRODUCT_IDS = ["1", "3", "5", "6"];

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const result = await prisma.product.updateMany({
    where: { id: { in: FEATURED_PRODUCT_IDS } },
    data: { isFeatured: true },
  });

  const outcome = evaluateFeaturedProvisioning(FEATURED_PRODUCT_IDS.length, result.count);
  if (!outcome.ok) {
    // Caught below: printed once via console.error, and the process
    // exits non-zero — this must never be reported as a successful
    // provisioning run.
    throw new Error(outcome.message);
  }
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
