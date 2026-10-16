import "server-only";
import { del } from "@vercel/blob";

/**
 * IMP-046: the only file in Catalog that imports `@vercel/blob`'s delete
 * operation — kept separate from `prisma-product-repository.ts` so the
 * database write and the storage cleanup are two distinct, independently
 * failable steps, never bundled into one Prisma transaction (Blob isn't
 * transactional with Postgres).
 *
 * Deliberately best-effort: a failed delete only ever leaves a harmless
 * orphaned blob (accepted, documented risk — no automatic sweep in this
 * milestone), never surfaces as a failure to the admin or blocks the
 * database update that already succeeded. Callers must only invoke this
 * AFTER the database has already been updated to point at the new image
 * (see `admin-product-image-commands.ts`), never before.
 */
export async function deleteProductImageBlob(url: string): Promise<void> {
  try {
    await del(url);
  } catch (error) {
    console.error("[product-image-blob-storage] failed to delete blob", url, error);
  }
}
