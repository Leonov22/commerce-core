"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { upload } from "@vercel/blob/client";
import Image from "next/image";
import { useRouter } from "@/core/i18n/navigation";
import { Button } from "@/shared/components/ui/button";

interface AdminProductImageFieldProps {
  /** `null` while creating a new product — there is nothing to attach an image to until it's saved once. */
  productId: string | null;
  imageUrl: string | null;
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Mirrors the route's own `MAX_PRODUCT_IMAGE_BYTES` — kept in sync manually since the client can't import a server route's constants. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Upload/replace/remove UI for a product's single image (IMP-046).
 * Uploads go directly from this browser to Vercel Blob storage via
 * `upload()` — this component never sends file bytes to our own server
 * (see the route's own doc comment for why).
 *
 * The database isn't updated by this component at all: Vercel Blob calls
 * our server's `onUploadCompleted` hook once the upload actually lands in
 * storage, and THAT is what persists the new `imageUrl`. This component
 * only shows an optimistic local preview from the URL `upload()` itself
 * returns, then asks the server component tree to refetch. On localhost,
 * `onUploadCompleted` cannot fire (Vercel can't reach your machine), so
 * the database won't actually reflect a locally-tested upload — only a
 * real deployment can complete that last step. This is a known, disclosed
 * limitation, not a bug in this component.
 */
export function AdminProductImageField({ productId, imageUrl }: AdminProductImageFieldProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(imageUrl);
  const [isBusy, setIsBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !productId) return;

    setErrorCode(null);

    // Client-side checks are only for fast feedback — the server
    // independently enforces `allowedContentTypes`/`maximumSizeInBytes`
    // when issuing the upload token, so this is never the real boundary.
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setErrorCode("INVALID_FILE_TYPE");
      return;
    }
    if (file.size > MAX_BYTES) {
      setErrorCode("FILE_TOO_LARGE");
      return;
    }

    setIsBusy(true);
    try {
      const blob = await upload(`products/${productId}/image`, file, {
        access: "public",
        handleUploadUrl: `/api/admin/products/${productId}/image`,
        contentType: file.type,
      });
      setPreviewUrl(blob.url);
      router.refresh();
    } catch {
      setErrorCode("UPLOAD_FAILED");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRemove() {
    if (!productId) return;
    setErrorCode(null);
    setIsBusy(true);
    try {
      const response = await fetch(`/api/admin/products/${productId}/image`, { method: "DELETE" });
      if (!response.ok) {
        setErrorCode("REMOVE_FAILED");
        return;
      }
      setPreviewUrl(null);
      router.refresh();
    } catch {
      setErrorCode("NETWORK_ERROR");
    } finally {
      setIsBusy(false);
    }
  }

  if (!productId) {
    return (
      <p className="mt-2 text-sm text-muted-foreground">
        Save the product first, then come back here to upload an image.
      </p>
    );
  }

  return (
    <div className="mt-4 flex items-start gap-4">
      <div className="flex h-32 w-32 flex-none items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
        {previewUrl ? (
          <Image
            src={previewUrl}
            alt=""
            width={128}
            height={128}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-xs text-muted-foreground">No image</span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {errorCode ? (
          <p role="alert" className="text-sm text-destructive">
            {errorCode}
          </p>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          onChange={handleFileChange}
          disabled={isBusy}
          className="text-sm"
        />
        <p className="text-xs text-muted-foreground">JPEG, PNG, or WebP, up to 8 MB.</p>
        {previewUrl ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRemove}
            disabled={isBusy}
          >
            Remove image
          </Button>
        ) : null}
      </div>
    </div>
  );
}
