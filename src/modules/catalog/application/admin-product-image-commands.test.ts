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
 *
 * `compareAndSetProductImage` here faithfully reproduces the real
 * Prisma implementation's atomicity contract: it only writes if the
 * product's CURRENT `imageUrl` still equals `expectedCurrentImageUrl`,
 * exactly as the real `updateMany`-based compare-and-set does — this is
 * what lets these tests genuinely exercise the race-condition fix
 * (CR-046-01) rather than just a happy path.
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
    effectivePriceAmountMinor: 24000,
    activeDiscount: null,
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
  casCalls: { productId: string; expectedCurrentImageUrl: string | null }[];
  findCalls: string[];
  /** Fires once, right after the NEXT `findByIdForAdmin` call reads its value — before that value is returned — to deterministically simulate a write landing between a caller's read and its own later compare-and-set. Awaited before the read returns, so the interleaving is deterministic, not a real race. */
  runAfterNextFind: { fn: (() => void | Promise<void>) | null };
} {
  const casCalls: { productId: string; expectedCurrentImageUrl: string | null }[] = [];
  const findCalls: string[] = [];
  const runAfterNextFind: { fn: (() => void | Promise<void>) | null } = { fn: null };

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
      findCalls.push(id);
      const value = products[id] ?? null;
      if (runAfterNextFind.fn) {
        const fn = runAfterNextFind.fn;
        runAfterNextFind.fn = null;
        await fn();
      }
      return value;
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
    async compareAndSetProductImage(productId, expectedCurrentImageUrl, image) {
      casCalls.push({ productId, expectedCurrentImageUrl });
      const existing = products[productId];
      if (!existing) return null;
      // The real atomicity contract: only writes if the CURRENT value
      // still equals what the caller expects — never an unconditional write.
      if (existing.imageUrl !== expectedCurrentImageUrl) return null;
      const updated = { ...existing, imageUrl: image.imageUrl, imageAlt: image.imageAlt };
      products[productId] = updated;
      return updated;
    },
    async listDiscountsForProduct() {
      throw new Error("not used by these tests");
    },
    async listAdminDiscounts() {
      throw new Error("not used by these tests");
    },
    async findAdminDiscountById() {
      throw new Error("not used by these tests");
    },
    async createProductDiscount() {
      throw new Error("not used by these tests");
    },
    async updateProductDiscount() {
      throw new Error("not used by these tests");
    },
    async setProductDiscountActive() {
      throw new Error("not used by these tests");
    },
    async deleteProductDiscount() {
      throw new Error("not used by these tests");
    },
  };

  return { repository, casCalls, findCalls, runAfterNextFind };
}

describe("confirmAdminProductImageUpload", () => {
  it("applies the upload and reports the base image as previousImageUrl for a product with no prior image", async () => {
    const { repository, casCalls } = makeFakeRepository({
      "product-1": makeAdminProduct({ imageUrl: null }),
    });

    const result = await confirmAdminProductImageUpload(repository, {
      productId: "product-1",
      imageUrl: "https://example.public.blob.vercel-storage.com/products/product-1/image-a",
      pathname: "products/product-1/image-a",
      imageAlt: null,
      baseImageUrl: null,
    });

    expect(result).toMatchObject({ ok: true, applied: true, previousImageUrl: null });
    expect(casCalls).toEqual([{ productId: "product-1", expectedCurrentImageUrl: null }]);
  });

  it("rejects with PATHNAME_MISMATCH before ever attempting the compare-and-set", async () => {
    const { repository, casCalls } = makeFakeRepository({
      "product-1": makeAdminProduct(),
    });

    const result = await confirmAdminProductImageUpload(repository, {
      productId: "product-1",
      imageUrl: "https://example.public.blob.vercel-storage.com/products/some-other-product/image",
      pathname: "products/some-other-product/image",
      imageAlt: null,
      baseImageUrl: null,
    });

    expect(result).toEqual({ ok: false, error: "PATHNAME_MISMATCH" });
    expect(casCalls).toHaveLength(0);
  });

  it("rejects with NOT_FOUND for a nonexistent product", async () => {
    const { repository } = makeFakeRepository({});

    const result = await confirmAdminProductImageUpload(repository, {
      productId: "nonexistent",
      imageUrl: "https://example.public.blob.vercel-storage.com/products/nonexistent/image-a",
      pathname: "products/nonexistent/image-a",
      imageAlt: null,
      baseImageUrl: null,
    });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("treats a retry of a completion that already succeeded as an idempotent, no-op duplicate", async () => {
    const { repository, casCalls } = makeFakeRepository({
      "product-1": makeAdminProduct({
        imageUrl: "https://example.public.blob.vercel-storage.com/products/product-1/image-a",
      }),
    });

    // Same imageUrl as current, but baseImageUrl is stale (as a real
    // retry of the ORIGINAL completion delivery would carry) —
    // the compare-and-set itself will fail (current != baseImageUrl
    // once it has already been applied once), but the current value
    // already matches, so this must be recognized as a harmless retry.
    const result = await confirmAdminProductImageUpload(repository, {
      productId: "product-1",
      imageUrl: "https://example.public.blob.vercel-storage.com/products/product-1/image-a",
      pathname: "products/product-1/image-a",
      imageAlt: null,
      baseImageUrl: null,
    });

    expect(result).toMatchObject({ ok: true, applied: false, reason: "DUPLICATE_CURRENT" });
    expect(casCalls).toHaveLength(1);
  });

  describe("CR-046-01: the required interleaving scenario — two replacements plus a delayed duplicate completion", () => {
    it("Upload A, then Upload B, then a delayed retry of A's completion: the product still references B, and B is never reverted or lost", async () => {
      const { repository } = makeFakeRepository({
        "product-1": makeAdminProduct({ imageUrl: "old" }),
      });

      // 1. Upload A completes. Its token was issued when the image was "old".
      const resultA = await confirmAdminProductImageUpload(repository, {
        productId: "product-1",
        imageUrl: "A",
        pathname: "products/product-1/image-a",
        imageAlt: null,
        baseImageUrl: "old",
      });
      expect(resultA).toMatchObject({ ok: true, applied: true, previousImageUrl: "old" });

      // 2. Upload B completes. Its token was issued AFTER A had already
      // landed, so its baseImageUrl is "A" — the image B actually saw.
      const resultB = await confirmAdminProductImageUpload(repository, {
        productId: "product-1",
        imageUrl: "B",
        pathname: "products/product-1/image-b",
        imageAlt: null,
        baseImageUrl: "A",
      });
      expect(resultB).toMatchObject({ ok: true, applied: true, previousImageUrl: "A" });

      // 3. A delayed retry of A's ORIGINAL completion delivery arrives —
      // same payload as step 1 (imageUrl "A", baseImageUrl "old").
      const retryOfA = await confirmAdminProductImageUpload(repository, {
        productId: "product-1",
        imageUrl: "A",
        pathname: "products/product-1/image-a",
        imageAlt: null,
        baseImageUrl: "old",
      });

      // The retry must be rejected as stale — it must NOT revert to A,
      // and it must report nothing to delete (no previousImageUrl is
      // ever present on an `applied: false` result).
      expect(retryOfA).toMatchObject({ ok: true, applied: false, reason: "STALE_SUPERSEDED" });
      expect("previousImageUrl" in retryOfA).toBe(false);

      // 4. The final product must still reference B.
      if (retryOfA.ok) {
        expect(retryOfA.product.imageUrl).toBe("B");
      }
    });

    it("a delayed retry of A's completion that arrives BEFORE B is a genuine first application, not stale", async () => {
      // Sanity check for the fix's precision: the SAME retry payload is
      // only stale relative to what has ALREADY happened. If it happens
      // to be the actual first delivery (B hasn't landed yet), it must
      // still apply normally.
      const { repository } = makeFakeRepository({
        "product-1": makeAdminProduct({ imageUrl: "old" }),
      });

      const result = await confirmAdminProductImageUpload(repository, {
        productId: "product-1",
        imageUrl: "A",
        pathname: "products/product-1/image-a",
        imageAlt: null,
        baseImageUrl: "old",
      });

      expect(result).toMatchObject({ ok: true, applied: true, previousImageUrl: "old" });
    });
  });
});

describe("removeAdminProductImage", () => {
  it("applies the removal and reports the previous imageUrl when nothing has changed concurrently", async () => {
    const { repository } = makeFakeRepository({
      "product-1": makeAdminProduct({
        imageUrl: "https://example.public.blob.vercel-storage.com/products/product-1/image-a",
      }),
    });

    const result = await removeAdminProductImage(repository, "product-1");

    expect(result).toEqual({
      ok: true,
      applied: true,
      previousImageUrl: "https://example.public.blob.vercel-storage.com/products/product-1/image-a",
    });
  });

  it("is idempotent for a product with no image: applied: false, ALREADY_CLEARED, never attempting a compare-and-set", async () => {
    const { repository, casCalls } = makeFakeRepository({
      "product-1": makeAdminProduct({ imageUrl: null }),
    });

    const result = await removeAdminProductImage(repository, "product-1");

    expect(result).toEqual({ ok: true, applied: false, reason: "ALREADY_CLEARED" });
    expect(casCalls).toHaveLength(0);
  });

  it("rejects with NOT_FOUND for a nonexistent product", async () => {
    const { repository } = makeFakeRepository({});
    const result = await removeAdminProductImage(repository, "nonexistent");
    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("CR-046-01: never clears a different image than the one it actually read — a concurrent upload landing between the read and the write leaves the newer image untouched and reports nothing to delete", async () => {
    const { repository, runAfterNextFind } = makeFakeRepository({
      "product-1": makeAdminProduct({ imageUrl: "old" }),
    });

    // Simulate a concurrent upload completion landing in the instant
    // between this call's own read and its compare-and-set write.
    runAfterNextFind.fn = async () => {
      await confirmAdminProductImageUpload(repository, {
        productId: "product-1",
        imageUrl: "new-concurrent-upload",
        pathname: "products/product-1/image-new",
        imageAlt: null,
        baseImageUrl: "old",
      });
    };

    const result = await removeAdminProductImage(repository, "product-1");

    expect(result).toEqual({ ok: true, applied: false, reason: "CHANGED_CONCURRENTLY" });

    const current = await repository.findByIdForAdmin("product-1");
    expect(current?.imageUrl).toBe("new-concurrent-upload");
  });
});
