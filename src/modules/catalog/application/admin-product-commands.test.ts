import { describe, expect, it } from "vitest";
import {
  createAdminProduct,
  updateAdminProduct,
} from "@/modules/catalog/application/admin-product-commands";
import type {
  ProductRepository,
  AdminProductInput,
} from "@/modules/catalog/repositories/product-repository";
import type { AdminProduct } from "@/modules/catalog/domain/admin-product";

/**
 * Pure application-layer tests — `ProductRepository` is injected, so a
 * fake is used and nothing is actually persisted, mirroring
 * `checkout-order.test.ts`'s `makeFakeRepository()` pattern.
 */
function makeFakeRepository(
  options: {
    existingCategoryIds?: string[];
    existingSlugs?: string[];
  } = {},
): {
  repository: ProductRepository;
  createCalls: AdminProductInput[];
  updateCalls: { id: string; input: AdminProductInput }[];
} {
  const existingCategoryIds = new Set(options.existingCategoryIds ?? ["category-1"]);
  const existingSlugs = new Set(options.existingSlugs ?? []);
  const createCalls: AdminProductInput[] = [];
  const updateCalls: { id: string; input: AdminProductInput }[] = [];

  function toAdminProduct(id: string, input: AdminProductInput): AdminProduct {
    const now = new Date();
    return {
      id,
      slug: input.slug,
      status: input.status,
      priceAmountMinor: input.priceAmountMinor,
      currency: "EUR",
      categoryId: input.categoryId,
      categoryName: "Seating",
      badge: input.badge,
      isFeatured: input.isFeatured,
      sortOrder: input.sortOrder,
      imageUrl: null,
      imageAlt: null,
      effectivePriceAmountMinor: input.priceAmountMinor,
      activeDiscount: null,
      name: input.name,
      meta: input.meta,
      description: input.description,
      material: input.material,
      dimensions: input.dimensions,
      createdAt: now,
      updatedAt: now,
    };
  }

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
    async findByIdForAdmin() {
      throw new Error("not used by these tests");
    },
    async createProduct(input) {
      createCalls.push(input);
      return toAdminProduct("new-product-id", input);
    },
    async updateProduct(id, input) {
      updateCalls.push({ id, input });
      if (id === "nonexistent") return null;
      return toAdminProduct(id, input);
    },
    async categoryExists(categoryId) {
      return existingCategoryIds.has(categoryId);
    },
    async slugExists(slug, excludingId) {
      return existingSlugs.has(slug) && excludingId !== "product-with-this-slug";
    },
    async categorySlugExists() {
      throw new Error("not used by these tests");
    },
    async compareAndSetProductImage() {
      throw new Error("not used by these tests");
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
    async createCategory() {
      throw new Error("not used by these tests");
    },
  };

  return { repository, createCalls, updateCalls };
}

function validRawInput(overrides: Record<string, unknown> = {}) {
  return {
    slug: "studio-chair",
    status: "DRAFT",
    priceAmountMinor: 24000,
    categoryId: "category-1",
    badge: null,
    isFeatured: false,
    sortOrder: 0,
    name: "Studio Chair",
    meta: "Oak & linen",
    description: "A chair.",
    material: "Oak",
    dimensions: "58 x 60 x 78 cm",
    ...overrides,
  };
}

describe("createAdminProduct", () => {
  it("creates a product from valid input, never trusting currency from the caller", async () => {
    const { repository, createCalls } = makeFakeRepository();

    const result = await createAdminProduct(repository, validRawInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product.currency).toBe("EUR");
    expect(createCalls).toHaveLength(1);
    // The raw input has no `currency` field at all — confirms the
    // repository-level fixing of EUR, not something this test could
    // smuggle a different value into even if it tried.
    expect("currency" in createCalls[0]!).toBe(false);
  });

  it("rejects a non-numeric price, never calling the repository", async () => {
    const { repository, createCalls } = makeFakeRepository();

    const result = await createAdminProduct(
      repository,
      validRawInput({ priceAmountMinor: "24000" }),
    );

    expect(result).toEqual({ ok: false, error: "INVALID_PRICE" });
    expect(createCalls).toHaveLength(0);
  });

  it("rejects a negative price", async () => {
    const { repository } = makeFakeRepository();
    const result = await createAdminProduct(repository, validRawInput({ priceAmountMinor: -100 }));
    expect(result).toEqual({ ok: false, error: "INVALID_PRICE" });
  });

  it("rejects a price exceeding Postgres's INTEGER range", async () => {
    const { repository } = makeFakeRepository();
    const result = await createAdminProduct(
      repository,
      validRawInput({ priceAmountMinor: 2_147_483_648 }),
    );
    expect(result).toEqual({ ok: false, error: "INVALID_PRICE" });
  });

  it("rejects a status outside the known enum, never calling the repository", async () => {
    const { repository, createCalls } = makeFakeRepository();
    const result = await createAdminProduct(repository, validRawInput({ status: "PUBLISHED" }));
    expect(result).toEqual({ ok: false, error: "INVALID_STATUS" });
    expect(createCalls).toHaveLength(0);
  });

  it("rejects a category id that does not exist, never calling createProduct", async () => {
    const { repository, createCalls } = makeFakeRepository({ existingCategoryIds: ["category-1"] });
    const result = await createAdminProduct(
      repository,
      validRawInput({ categoryId: "no-such-category" }),
    );
    expect(result).toEqual({ ok: false, error: "CATEGORY_NOT_FOUND" });
    expect(createCalls).toHaveLength(0);
  });

  it("rejects a slug already used by another product", async () => {
    const { repository, createCalls } = makeFakeRepository({ existingSlugs: ["studio-chair"] });
    const result = await createAdminProduct(repository, validRawInput());
    expect(result).toEqual({ ok: false, error: "SLUG_ALREADY_EXISTS" });
    expect(createCalls).toHaveLength(0);
  });

  it("rejects a slug with uppercase letters or spaces", async () => {
    const { repository } = makeFakeRepository();
    const result = await createAdminProduct(repository, validRawInput({ slug: "Studio Chair" }));
    expect(result).toEqual({ ok: false, error: "INVALID_SLUG" });
  });

  it("rejects an empty name", async () => {
    const { repository } = makeFakeRepository();
    const result = await createAdminProduct(repository, validRawInput({ name: "   " }));
    expect(result).toEqual({ ok: false, error: "INVALID_NAME" });
  });

  it("rejects a non-boolean isFeatured flag", async () => {
    const { repository } = makeFakeRepository();
    const result = await createAdminProduct(repository, validRawInput({ isFeatured: "yes" }));
    expect(result).toEqual({ ok: false, error: "INVALID_FEATURED_FLAG" });
  });

  it("accepts a valid badge and null badge", async () => {
    const { repository } = makeFakeRepository();
    const withBadge = await createAdminProduct(
      repository,
      validRawInput({ badge: "NEW", slug: "a" }),
    );
    expect(withBadge.ok).toBe(true);
    const withNullBadge = await createAdminProduct(
      repository,
      validRawInput({ badge: null, slug: "b" }),
    );
    expect(withNullBadge.ok).toBe(true);
  });

  it("rejects an invalid badge value", async () => {
    const { repository } = makeFakeRepository();
    const result = await createAdminProduct(repository, validRawInput({ badge: "RARE" }));
    expect(result).toEqual({ ok: false, error: "INVALID_BADGE" });
  });
});

describe("updateAdminProduct", () => {
  it("updates a product from valid input", async () => {
    const { repository, updateCalls } = makeFakeRepository();
    const result = await updateAdminProduct(
      repository,
      "product-1",
      validRawInput({ status: "ACTIVE" }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product.status).toBe("ACTIVE");
    expect(updateCalls).toHaveLength(1);
  });

  it("returns NOT_FOUND when the repository reports no matching product, without otherwise treating it as a validation failure", async () => {
    const { repository } = makeFakeRepository();
    const result = await updateAdminProduct(repository, "nonexistent", validRawInput());
    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("rejects an invalid category reference before ever calling updateProduct", async () => {
    const { repository, updateCalls } = makeFakeRepository({ existingCategoryIds: ["category-1"] });
    const result = await updateAdminProduct(
      repository,
      "product-1",
      validRawInput({ categoryId: "ghost" }),
    );
    expect(result).toEqual({ ok: false, error: "CATEGORY_NOT_FOUND" });
    expect(updateCalls).toHaveLength(0);
  });

  it("rejects an invalid status change, never calling updateProduct", async () => {
    const { repository, updateCalls } = makeFakeRepository();
    const result = await updateAdminProduct(
      repository,
      "product-1",
      validRawInput({ status: "DELETED" }),
    );
    expect(result).toEqual({ ok: false, error: "INVALID_STATUS" });
    expect(updateCalls).toHaveLength(0);
  });
});
