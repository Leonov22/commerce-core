import "server-only";
import { prisma } from "@/modules/catalog/infrastructure/prisma-client";

/**
 * CR-037-01-SEED: the safe, production-usable way to populate
 * `Product.isFeatured` — unlike `prisma/seed.ts` (broad upserts, now
 * guarded against running outside development/test), this touches
 * EXCLUSIVELY the `isFeatured` column on rows that must already exist.
 * It can never create a product (`updateMany` is a no-op against
 * non-matching ids, never an insert), and the `data` object below has
 * no field capable of touching price, status, category, badge, sort
 * order, slug, publication date, or any translation — there is nothing
 * else here TO overwrite.
 *
 * Idempotent: `updateMany` unconditionally (re-)writes the same value,
 * so calling this any number of times with the same `ids` produces the
 * same final state and the same returned count.
 */
export async function markProductsFeatured(ids: string[]): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const result = await prisma.product.updateMany({
    where: { id: { in: ids } },
    data: { isFeatured: true },
  });
  return result.count;
}
