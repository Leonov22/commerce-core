import type { ProductRepository } from "@/modules/catalog/repositories/product-repository";
import type { AdminProduct } from "@/modules/catalog/domain/admin-product";

/**
 * IMP-046: the two use cases behind the product image upload/remove API
 * routes. Both are called from Vercel Blob's own server-side hooks
 * (`onUploadCompleted` for confirm, a plain DELETE handler for remove),
 * never from the general `admin-product-commands.ts` create/update path —
 * image management is a deliberately separate concern with its own
 * authorization/validation (see the route files).
 *
 * Neither function imports `@vercel/blob` — that dependency stays at the
 * route/infrastructure edge (`product-image-blob-storage.ts`). These
 * functions only decide WHETHER and WHAT to write to the database; the
 * caller (the route) is responsible for actually deleting the old blob
 * afterward, using the `previousImageUrl` these return, per the required
 * ordering: never delete the old blob until the new one is already
 * committed to the product record.
 */

export type AdminProductImageError = "NOT_FOUND" | "PATHNAME_MISMATCH";

export interface ConfirmProductImageUploadInput {
  productId: string;
  imageUrl: string;
  /** The Blob's own `pathname`, checked against the `products/{productId}/` prefix this app itself requested at token-generation time — see the upload route's `onBeforeGenerateToken`. */
  pathname: string;
  imageAlt: string | null;
}

export type ConfirmProductImageUploadResult =
  | { ok: true; product: AdminProduct; previousImageUrl: string | null }
  | { ok: false; error: AdminProductImageError };

/**
 * Confirms a completed Blob upload and persists it as the product's image.
 *
 * Idempotent: if the product's `imageUrl` already equals the given one
 * (a duplicate `onUploadCompleted` delivery — Vercel retries up to 5
 * times on a non-200 response), this is a no-op success that reports no
 * `previousImageUrl` to delete, since nothing changed and there is no
 * "old" blob distinct from the current one.
 */
export async function confirmAdminProductImageUpload(
  repository: ProductRepository,
  input: ConfirmProductImageUploadInput,
): Promise<ConfirmProductImageUploadResult> {
  const expectedPrefix = `products/${input.productId}/`;
  if (!input.pathname.startsWith(expectedPrefix)) {
    return { ok: false, error: "PATHNAME_MISMATCH" };
  }

  const existing = await repository.findByIdForAdmin(input.productId);
  if (!existing) {
    return { ok: false, error: "NOT_FOUND" };
  }

  if (existing.imageUrl === input.imageUrl) {
    return { ok: true, product: existing, previousImageUrl: null };
  }

  const updated = await repository.setProductImage(input.productId, {
    imageUrl: input.imageUrl,
    imageAlt: input.imageAlt,
  });
  if (!updated) {
    return { ok: false, error: "NOT_FOUND" };
  }

  return { ok: true, product: updated, previousImageUrl: existing.imageUrl };
}

export type RemoveProductImageResult =
  { ok: true; previousImageUrl: string | null } | { ok: false; error: "NOT_FOUND" };

/**
 * Clears the product's image. Idempotent: removing an already-imageless
 * product is a no-op success with no blob to delete.
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
    return { ok: true, previousImageUrl: null };
  }

  await repository.clearProductImage(productId);
  return { ok: true, previousImageUrl: existing.imageUrl };
}
