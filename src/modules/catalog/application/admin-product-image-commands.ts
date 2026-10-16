import type { ProductRepository } from "@/modules/catalog/repositories/product-repository";
import type { AdminProduct } from "@/modules/catalog/domain/admin-product";

/**
 * IMP-046 (CR-046-01: concurrent replacement race fix). The two use
 * cases behind the product image upload/remove API routes. Both are
 * called from Vercel Blob's own server-side hooks (`onUploadCompleted`
 * for confirm, a plain DELETE handler for remove), never from the
 * general `admin-product-commands.ts` create/update path — image
 * management is a deliberately separate concern with its own
 * authorization/validation (see the route files).
 *
 * Neither function imports `@vercel/blob` — that dependency stays at the
 * route/infrastructure edge (`product-image-blob-storage.ts`). These
 * functions only decide WHETHER and WHAT to write to the database; the
 * caller (the route) is responsible for actually deleting the old blob
 * afterward, and ONLY when `applied: true` — see each result type's own
 * doc comment for why a `false` outcome must never delete anything.
 *
 * Concurrency: `onUploadCompleted` is Vercel's own retry-prone webhook —
 * the same completion can be delivered more than once, and deliveries
 * for two DIFFERENT, sequential uploads of the same product can arrive
 * out of order (a delayed retry of an earlier upload's completion can
 * arrive after a later upload has already superseded it). A plain
 * "read the current image, then write the new one" cannot tell a
 * legitimate new replacement apart from a stale, superseded one — by
 * the time the stale completion runs its read, the image has already
 * moved on, and a stale completion's new value is just as "different
 * from current" as a real one. Both `confirmAdminProductImageUpload`
 * and `removeAdminProductImage` therefore go through
 * `ProductRepository.compareAndSetProductImage`, an atomic
 * compare-and-set keyed on the exact image value each caller actually
 * observed — never an unconditional write.
 */

export type AdminProductImageError = "NOT_FOUND" | "PATHNAME_MISMATCH";

export interface ConfirmProductImageUploadInput {
  productId: string;
  imageUrl: string;
  /** The Blob's own `pathname`, checked against the `products/{productId}/` prefix this app itself requested at token-generation time — see the upload route's `onBeforeGenerateToken`. */
  pathname: string;
  imageAlt: string | null;
  /**
   * The product's `imageUrl` as it was when this upload's token was
   * issued (`onBeforeGenerateToken`) — the compare-and-set precondition.
   * This is what makes staleness detectable: a delayed retry of an
   * OLDER completion still carries the OLDER `baseImageUrl` it was
   * issued with, which no longer matches the product's current image
   * once a newer replacement has landed, so the compare-and-set below
   * correctly refuses to apply it.
   */
  baseImageUrl: string | null;
}

export type ConfirmProductImageUploadResult =
  | { ok: true; applied: true; product: AdminProduct; previousImageUrl: string | null }
  | {
      ok: true;
      applied: false;
      product: AdminProduct;
      /**
       * `DUPLICATE_CURRENT`: a retry of a completion that already
       * succeeded — the product's image already equals this call's
       * `imageUrl`. `STALE_SUPERSEDED`: the product's image has moved
       * on to something else entirely since `baseImageUrl` was read —
       * a different, later replacement already landed. Either way,
       * nothing was written and the caller must not delete any blob.
       */
      reason: "DUPLICATE_CURRENT" | "STALE_SUPERSEDED";
    }
  | { ok: false; error: AdminProductImageError };

/**
 * Confirms a completed Blob upload and persists it as the product's
 * image — but ONLY if the product's image is still exactly
 * `input.baseImageUrl`, atomically (see `compareAndSetProductImage`).
 *
 * `applied: false` is a normal, expected outcome (a retry or a
 * since-superseded completion), not an error — callers must check
 * `applied` before deleting any blob, never just `ok`.
 */
export async function confirmAdminProductImageUpload(
  repository: ProductRepository,
  input: ConfirmProductImageUploadInput,
): Promise<ConfirmProductImageUploadResult> {
  const expectedPrefix = `products/${input.productId}/`;
  if (!input.pathname.startsWith(expectedPrefix)) {
    return { ok: false, error: "PATHNAME_MISMATCH" };
  }

  const updated = await repository.compareAndSetProductImage(input.productId, input.baseImageUrl, {
    imageUrl: input.imageUrl,
    imageAlt: input.imageAlt,
  });

  if (updated) {
    return { ok: true, applied: true, product: updated, previousImageUrl: input.baseImageUrl };
  }

  // The compare-and-set didn't match. Read-only from here: this branch
  // never writes to the database and never reports a blob to delete.
  const current = await repository.findByIdForAdmin(input.productId);
  if (!current) {
    return { ok: false, error: "NOT_FOUND" };
  }

  if (current.imageUrl === input.imageUrl) {
    return { ok: true, applied: false, product: current, reason: "DUPLICATE_CURRENT" };
  }

  return { ok: true, applied: false, product: current, reason: "STALE_SUPERSEDED" };
}

export type RemoveProductImageResult =
  | { ok: true; applied: true; previousImageUrl: string | null }
  | {
      ok: true;
      applied: false;
      /** `ALREADY_CLEARED`: the product already had no image. `CHANGED_CONCURRENTLY`: the image changed between this call's read and its attempted write (e.g. an upload completed at the same moment) — the newer image is left exactly as it is. */
      reason: "ALREADY_CLEARED" | "CHANGED_CONCURRENTLY";
    }
  | { ok: false; error: "NOT_FOUND" };

/**
 * Clears the product's image — but ONLY if it still equals the value
 * this call actually read, atomically. `applied: false` means nothing
 * was written; the caller must not delete any blob.
 */
export async function removeAdminProductImage(
  repository: ProductRepository,
  productId: string,
): Promise<RemoveProductImageResult> {
  const existing = await repository.findByIdForAdmin(productId);
  if (!existing) {
    return { ok: false, error: "NOT_FOUND" };
  }

  if (existing.imageUrl === null) {
    return { ok: true, applied: false, reason: "ALREADY_CLEARED" };
  }

  const updated = await repository.compareAndSetProductImage(productId, existing.imageUrl, {
    imageUrl: null,
    imageAlt: null,
  });

  if (!updated) {
    return { ok: true, applied: false, reason: "CHANGED_CONCURRENTLY" };
  }

  return { ok: true, applied: true, previousImageUrl: existing.imageUrl };
}
