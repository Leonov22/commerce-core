import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDel } = vi.hoisted(() => ({ mockDel: vi.fn() }));

vi.mock("@vercel/blob", () => ({ del: mockDel }));

const { deleteProductImageBlob } =
  await import("@/modules/catalog/infrastructure/product-image-blob-storage");

describe("deleteProductImageBlob (IMP-046)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes the blob at the given URL", async () => {
    mockDel.mockResolvedValueOnce(undefined);
    await deleteProductImageBlob(
      "https://example.public.blob.vercel-storage.com/products/product-1/image",
    );
    expect(mockDel).toHaveBeenCalledWith(
      "https://example.public.blob.vercel-storage.com/products/product-1/image",
    );
  });

  it("swallows a failed delete rather than throwing — a failed old-blob deletion must never surface as a failure to the caller", async () => {
    mockDel.mockRejectedValueOnce(new Error("blob not found"));
    await expect(
      deleteProductImageBlob(
        "https://example.public.blob.vercel-storage.com/products/product-1/image",
      ),
    ).resolves.toBeUndefined();
  });
});
