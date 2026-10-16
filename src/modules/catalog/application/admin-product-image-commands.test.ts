import { describe, expect, it } from "vitest";
import {
  confirmAdminProductImageUpload,
  removeAdminProductImage,
} from "@/modules/catalog/application/admin-product-image-commands";
import type { ProductRepository } from "@/modules/catalog/repositories/product-repository";
import type { AdminProduct } from "@/modules/catalog/domain/admin-product";

/**
 * Pure application-layer tests — `ProductRepository` is injected, so a
 * fake is used and nothing is actually persisted, mirroring every other
 * `*-commands.test.ts` in this module.
 */
function makeAdminProduct(overrides: Partial<AdminProduct> = {}): AdminProduct {
  const now = new Date();
  return {
    id: "product-1",
    slug: "studio-chair",
    status: "ACTIVE",
    priceAmountMinor: 24000,
    currency: "EUR",
    categoryId: "category-1",
    categoryName: "Seating",
    badge: null,
    isFeatured: false,
    sortOrder: 0,
    imageUrl: null,
    imageAlt: null,
    name: "Studio Chair",
    meta: "",
    description: "",
    material: "",
    dimensions: "",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFakeRepository(products: Record<string, AdminProduct>): {
  repository: ProductRepository;
  setImageCalls: { productId: string; imageUrl: string; imageAlt: string | null }[];
  clearImageCalls: string[];
} {
  const setImageCalls: { productId: string; imageUrl: string; imageAlt: string | null }[] = [];
  const clearImageCalls: string[] = [];

  const repository: ProductRepository = {
    async findActiveById() {
      throw new Error("not used by these tests");
    },
    async findActiveByIds() {
      throw new Error("not used by these tests");
    },
    async listActive() {
      throw new Error("not used by these tests");
    },
    async listCategories() {
      throw new Error("not used by these tests");
    },
    async listForAdmin() {
      throw new Error("not used by these tests");
    },
    async findByIdForAdmin(id) {
      return products[id] ?? null;
    },
    async createProduct() {
      throw new Error("not used by these tests");
    },
    async updateProduct() {
      throw new Error("not used by these tests");
    },
    async categoryExists() {
      throw new Error("not used by these tests");
    },
    async slugExists() {
      throw new Error("not used by these tests");
    },
    async categorySlugExists() {
      throw new Error("not used by these tests");
    },
    async createCategory() {
      throw new Error("not used by these tests");
    },
    async setProductImage(productId, image) {
      setImageCalls.push({ productId, ...image });
      const existing = products[productId];
      if (!existing) return null;
      const updated = { ...existing, imageUrl: image.imageUrl, imageAlt: image.imageAlt };
      products[productId] = updated;
      return updated;
    },
    async clearProductImage(productId) {
      clearImageCalls.push(productId);
      const existing = products[productId];
      if (!existing) return null;
      const updated = { ...existing, imageUrl: null, imageAlt: null };
      products[productId] = updated;
      return updated;
    },
  };

  return { repository, setImageCalls, clearImageCalls };
}

describe("confirmAdminProductImageUpload", () => {
  it("sets the image and reports the previous (null) imageUrl for a product with no prior image", async () => {
    const { repository, setImageCalls } = makeFakeRepository({
      "product-1": makeAdminProduct({ imageUrl: null }),
    });

    const result = await confirmAdminProductImageUpload(repository, {
      productId: "product-1",
      imageUrl: "https://example.public.blob.vercel-storage.com/products/product-1/image-abc123",
      pathname: "products/product-1/image-abc123",
      imageAlt: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product.imageUrl).toBe(
      "https://example.public.blob.vercel-storage.com/products/product-1/image-abc123",
    );
    expect(result.previousImageUrl).toBeNull();
    expect(setImageCalls).toHaveLength(1);
  });

  it("replaces an existing image and reports the previous imageUrl so the caller can delete it", async () => {
    const { repository } = makeFakeRepository({
      "product-1": makeAdminProduct({
        imageUrl: "https://example.public.blob.vercel-storage.com/products/product-1/old",
      }),
    });

    const result = await confirmAdminProductImageUpload(repository, {
      productId: "product-1",
      imageUrl: "https://example.public.blob.vercel-storage.com/products/product-1/image-new",
      pathname: "products/product-1/image-new",
      imageAlt: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previousImageUrl).toBe(
      "https://example.public.blob.vercel-storage.com/products/product-1/old",
    );
  });

  it("rejects with NOT_FOUND for a nonexistent product, never calling setProductImage", async () => {
    const { repository, setImageCalls } = makeFakeRepository({});

    const result = await confirmAdminProductImageUpload(repository, {
      productId: "nonexistent",
      imageUrl: "https://example.public.blob.vercel-storage.com/products/nonexistent/image-abc123",
      pathname: "products/nonexistent/image-abc123",
      imageAlt: null,
    });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(setImageCalls).toHaveLength(0);
  });

  it("rejects with PATHNAME_MISMATCH when the blob's pathname does not belong to this product, never calling setProductImage", async () => {
    const { repository, setImageCalls } = makeFakeRepository({
      "product-1": makeAdminProduct(),
    });

    const result = await confirmAdminProductImageUpload(repository, {
      productId: "product-1",
      imageUrl:
        "https://example.public.blob.vercel-storage.com/products/some-other-product/image-abc123",
      pathname: "products/some-other-product/image-abc123",
      imageAlt: null,
    });

    expect(result).toEqual({ ok: false, error: "PATHNAME_MISMATCH" });
    expect(setImageCalls).toHaveLength(0);
  });

  it("is idempotent for a duplicate completion event: the same imageUrl is a no-op success with no previousImageUrl to delete", async () => {
    const currentUrl =
      "https://example.public.blob.vercel-storage.com/products/product-1/image-abc123";
    const { repository, setImageCalls } = makeFakeRepository({
      "product-1": makeAdminProduct({ imageUrl: currentUrl }),
    });

    const result = await confirmAdminProductImageUpload(repository, {
      productId: "product-1",
      imageUrl: currentUrl,
      pathname: "products/product-1/image-abc123",
      imageAlt: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previousImageUrl).toBeNull();
    // Already applied — never re-written.
    expect(setImageCalls).toHaveLength(0);
  });
});

describe("removeAdminProductImage", () => {
  it("clears the image and reports the previous imageUrl so the caller can delete the blob", async () => {
    const { repository, clearImageCalls } = makeFakeRepository({
      "product-1": makeAdminProduct({
        imageUrl: "https://example.public.blob.vercel-storage.com/products/product-1/image-abc123",
      }),
    });

    const result = await removeAdminProductImage(repository, "product-1");

    expect(result).toEqual({
      ok: true,
      previousImageUrl:
        "https://example.public.blob.vercel-storage.com/products/product-1/image-abc123",
    });
    expect(clearImageCalls).toEqual(["product-1"]);
  });

  it("is idempotent for a product with no image: a no-op success, never calling clearProductImage", async () => {
    const { repository, clearImageCalls } = makeFakeRepository({
      "product-1": makeAdminProduct({ imageUrl: null }),
    });

    const result = await removeAdminProductImage(repository, "product-1");

    expect(result).toEqual({ ok: true, previousImageUrl: null });
    expect(clearImageCalls).toHaveLength(0);
  });

  it("rejects with NOT_FOUND for a nonexistent product", async () => {
    const { repository } = makeFakeRepository({});
    const result = await removeAdminProductImage(repository, "nonexistent");
    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});
