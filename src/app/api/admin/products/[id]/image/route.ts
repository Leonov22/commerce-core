import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getCurrentUser, isAdminUser } from "@/modules/identity";
import {
  confirmAdminProductImageUpload,
  removeAdminProductImage,
  deleteProductImageBlob,
} from "@/modules/catalog";

/**
 * Admin product image upload/removal boundary (IMP-046).
 *
 * POST handles the Vercel Blob *client upload* flow via `handleUpload` —
 * it is called twice per upload, for two different reasons, both routed
 * through this one handler because that's how `@vercel/blob/client`'s
 * protocol works:
 *   1. `onBeforeGenerateToken` — called when the browser asks this route
 *      for permission to upload. This is the ONLY place admin
 *      authorization for an upload is checked; nothing else gates it.
 *   2. `onUploadCompleted` — called by Vercel's own backend (not the
 *      browser) once the file has actually landed in Blob storage. This
 *      is the ONLY place the database is written — never on the browser's
 *      initial request, which only ever receives a short-lived token.
 *
 * File bytes never pass through this (or any) Next.js function — the
 * browser uploads directly to Blob storage, which is why the 4.5 MB
 * Vercel Functions request-body limit (confirmed against Vercel's docs
 * during IMP-046's planning) does not apply here.
 *
 * DELETE removes the current image, independent of the JSON
 * create/update endpoints in `../route.ts` — image management is a
 * deliberately separate concern with its own authorization path.
 */

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];
/**
 * Not constrained by the old 4.5 MB Functions body limit (bytes never
 * transit this function) — chosen generously enough for real product
 * photography while still bounding storage/cost per upload.
 */
const MAX_PRODUCT_IMAGE_BYTES = 8 * 1024 * 1024;

function expectedPathname(productId: string): string {
  return `products/${productId}/image`;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: productId } = await params;
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const user = await getCurrentUser();
        if (!user) {
          throw new Error("UNAUTHENTICATED");
        }
        if (!isAdminUser(user)) {
          throw new Error("FORBIDDEN");
        }

        // The client is expected to request exactly this fixed,
        // server-defined pathname (never the uploaded file's own name) —
        // see `admin-product-image-field.tsx`. `addRandomSuffix` below is
        // what actually makes each upload's stored path unique; rejecting
        // anything else here is defense in depth against a request that
        // bypasses that client code and calls this endpoint directly.
        if (pathname !== expectedPathname(productId)) {
          throw new Error("INVALID_PATHNAME");
        }

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_PRODUCT_IMAGE_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ productId }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Vercel retries this webhook (up to 5 times) on anything but a
        // 200 — `confirmAdminProductImageUpload` is idempotent for a
        // duplicate delivery of the same blob, so a retry here is safe.
        const payload = tokenPayload ? (JSON.parse(tokenPayload) as { productId?: string }) : {};
        if (payload.productId !== productId) {
          // The token was issued for a different product than this
          // completion claims — never trust `blob.url`/`blob.pathname`
          // alone as proof of which product it belongs to.
          throw new Error("PRODUCT_MISMATCH");
        }

        const result = await confirmAdminProductImageUpload({
          productId,
          imageUrl: blob.url,
          pathname: blob.pathname,
          imageAlt: null,
        });

        if (!result.ok) {
          throw new Error(result.error);
        }

        // Only delete the OLD blob after the database already points at
        // the new one — never before (see `admin-product-image-commands.ts`).
        if (result.previousImageUrl) {
          await deleteProductImageBlob(result.previousImageUrl);
        }
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "UNKNOWN_ERROR" },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: productId } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (!isAdminUser(user)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const result = await removeAdminProductImage(productId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  // Database already cleared above — only now attempt to delete the
  // blob, best-effort (see `deleteProductImageBlob`'s own doc comment).
  if (result.previousImageUrl) {
    await deleteProductImageBlob(result.previousImageUrl);
  }

  return NextResponse.json({ ok: true });
}
