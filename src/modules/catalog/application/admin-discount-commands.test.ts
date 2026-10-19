import { describe, expect, it } from "vitest";
import {
  createAdminDiscount,
  updateAdminDiscount,
  setAdminDiscountActive,
  removeAdminDiscount,
} from "@/modules/catalog/application/admin-discount-commands";
import type {
  ProductRepository,
  AdminDiscountInput,
  CreateProductDiscountResult,
  UpdateProductDiscountResult,
} from "@/modules/catalog/repositories/product-repository";
import type { AdminProduct } from "@/modules/catalog/domain/admin-product";
import type { ProductDiscount } from "@/modules/catalog/domain/discount";

function makeAdminProduct(overrides: Partial<AdminProduct> = {}): AdminProduct {
  const now = new Date();
  return {
    id: "product-1",
    slug: "studio-chair",
    status: "ACTIVE",
    priceAmountMinor: 10000,
    currency: "EUR",
    categoryId: "category-1",
    categoryName: "Seating",
    badge: null,
    isFeatured: false,
    sortOrder: 0,
    imageUrl: null,
    imageAlt: null,
    effectivePriceAmountMinor: 10000,
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

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * This fake REPLICATES the real Prisma implementation's atomicity
 * contract (overlap checked and the write applied as one step) closely
 * enough to exercise `admin-discount-commands.ts`'s own logic — it does
 * not need to replicate the Serializable-transaction mechanics
 * themselves, which are a real-database integration test's job
 * (`prisma-product-repository.test.ts`).
 */
function makeFakeRepository(
  options: {
    product?: AdminProduct;
    existingDiscounts?: ProductDiscount[];
  } = {},
): {
  repository: ProductRepository;
  createCalls: AdminDiscountInput[];
} {
  const product = options.product ?? makeAdminProduct();
  let discounts: ProductDiscount[] = options.existingDiscounts ?? [];
  const createCalls: AdminDiscountInput[] = [];
  let nextId = 1;

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
      return id === product.id ? product : null;
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
    async compareAndSetProductImage() {
      throw new Error("not used by these tests");
    },
    async listDiscountsForProduct(productId) {
      return discounts.filter((discount) => discount.productId === productId);
    },
    async listAdminDiscounts() {
      throw new Error("not used by these tests");
    },
    async findAdminDiscountById(id) {
      return discounts.find((discount) => discount.id === id) ?? null;
    },
    async createProductDiscount(input): Promise<CreateProductDiscountResult> {
      createCalls.push(input);
      if (input.productId !== product.id) {
        return { outcome: "productNotFound" };
      }
      const overlap = discounts.some(
        (sibling) =>
          sibling.productId === input.productId &&
          rangesOverlap(input.startsAt, input.endsAt, sibling.startsAt, sibling.endsAt),
      );
      if (overlap) {
        return { outcome: "overlap" };
      }
      const created: ProductDiscount = { id: `discount-${nextId++}`, ...input };
      discounts = [...discounts, created];
      return { outcome: "created", discount: created };
    },
    async updateProductDiscount(id, input): Promise<UpdateProductDiscountResult> {
      const existing = discounts.find((discount) => discount.id === id);
      if (!existing) {
        return { outcome: "notFound" };
      }
      const overlap = discounts.some(
        (sibling) =>
          sibling.id !== id &&
          sibling.productId === existing.productId &&
          rangesOverlap(input.startsAt, input.endsAt, sibling.startsAt, sibling.endsAt),
      );
      if (overlap) {
        return { outcome: "overlap" };
      }
      const updated: ProductDiscount = { ...existing, ...input };
      discounts = discounts.map((discount) => (discount.id === id ? updated : discount));
      return { outcome: "updated", discount: updated };
    },
    async setProductDiscountActive(id, isActive) {
      const existing = discounts.find((discount) => discount.id === id);
      if (!existing) return null;
      const updated = { ...existing, isActive };
      discounts = discounts.map((discount) => (discount.id === id ? updated : discount));
      return updated;
    },
    async deleteProductDiscount(id) {
      const existed = discounts.some((discount) => discount.id === id);
      discounts = discounts.filter((discount) => discount.id !== id);
      return existed;
    },
  };

  return { repository, createCalls };
}

const FUTURE_START = "2026-07-01T00:00:00.000Z";
const FUTURE_END = "2026-07-31T23:59:59.000Z";

describe("createAdminDiscount", () => {
  it("creates a percentage discount", async () => {
    const { repository } = makeFakeRepository();
    const result = await createAdminDiscount(repository, {
      productId: "product-1",
      type: "PERCENTAGE",
      value: 20,
      startsAt: FUTURE_START,
      endsAt: FUTURE_END,
      isActive: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discount.type).toBe("PERCENTAGE");
    expect(result.discount.value).toBe(20);
  });

  it("creates a fixed-amount discount strictly less than the product's current price", async () => {
    const { repository } = makeFakeRepository({
      product: makeAdminProduct({ priceAmountMinor: 10000 }),
    });
    const result = await createAdminDiscount(repository, {
      productId: "product-1",
      type: "FIXED_AMOUNT",
      value: 1500,
      startsAt: FUTURE_START,
      endsAt: FUTURE_END,
      isActive: true,
    });
    expect(result.ok).toBe(true);
  });

  it("creates a discount scheduled for a future date without requiring it to start immediately", async () => {
    const { repository } = makeFakeRepository();
    const result = await createAdminDiscount(repository, {
      productId: "product-1",
      type: "PERCENTAGE",
      value: 10,
      startsAt: "2099-01-01T00:00:00.000Z",
      endsAt: "2099-01-31T00:00:00.000Z",
      isActive: true,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a percentage value of 0", async () => {
    const { repository } = makeFakeRepository();
    const result = await createAdminDiscount(repository, {
      productId: "product-1",
      type: "PERCENTAGE",
      value: 0,
      startsAt: FUTURE_START,
      endsAt: FUTURE_END,
    });
    expect(result).toEqual({ ok: false, error: "INVALID_PERCENTAGE_VALUE" });
  });

  it("rejects a percentage value of 100 or more", async () => {
    const { repository } = makeFakeRepository();
    const result = await createAdminDiscount(repository, {
      productId: "product-1",
      type: "PERCENTAGE",
      value: 100,
      startsAt: FUTURE_START,
      endsAt: FUTURE_END,
    });
    expect(result).toEqual({ ok: false, error: "INVALID_PERCENTAGE_VALUE" });
  });

  it("rejects a fixed amount of 0", async () => {
    const { repository } = makeFakeRepository();
    const result = await createAdminDiscount(repository, {
      productId: "product-1",
      type: "FIXED_AMOUNT",
      value: 0,
      startsAt: FUTURE_START,
      endsAt: FUTURE_END,
    });
    expect(result).toEqual({ ok: false, error: "INVALID_FIXED_VALUE" });
  });

  it("rejects a fixed amount equal to the product's current price", async () => {
    const { repository } = makeFakeRepository({
      product: makeAdminProduct({ priceAmountMinor: 10000 }),
    });
    const result = await createAdminDiscount(repository, {
      productId: "product-1",
      type: "FIXED_AMOUNT",
      value: 10000,
      startsAt: FUTURE_START,
      endsAt: FUTURE_END,
    });
    expect(result).toEqual({ ok: false, error: "INVALID_FIXED_VALUE" });
  });

  it("rejects a fixed amount greater than the product's current price", async () => {
    const { repository } = makeFakeRepository({
      product: makeAdminProduct({ priceAmountMinor: 10000 }),
    });
    const result = await createAdminDiscount(repository, {
      productId: "product-1",
      type: "FIXED_AMOUNT",
      value: 15000,
      startsAt: FUTURE_START,
      endsAt: FUTURE_END,
    });
    expect(result).toEqual({ ok: false, error: "INVALID_FIXED_VALUE" });
  });

  it("rejects an end date at or before the start date", async () => {
    const { repository } = makeFakeRepository();
    const result = await createAdminDiscount(repository, {
      productId: "product-1",
      type: "PERCENTAGE",
      value: 10,
      startsAt: FUTURE_END,
      endsAt: FUTURE_START,
    });
    expect(result).toEqual({ ok: false, error: "INVALID_DATE_RANGE" });
  });

  it("rejects an unrecognized product id, never calling createProductDiscount", async () => {
    const { repository, createCalls } = makeFakeRepository();
    const result = await createAdminDiscount(repository, {
      productId: "nonexistent",
      type: "PERCENTAGE",
      value: 10,
      startsAt: FUTURE_START,
      endsAt: FUTURE_END,
    });
    expect(result).toEqual({ ok: false, error: "PRODUCT_NOT_FOUND" });
    expect(createCalls).toHaveLength(0);
  });

  it("rejects an overlapping date range against an existing discount for the same product", async () => {
    const existing: ProductDiscount = {
      id: "discount-existing",
      productId: "product-1",
      type: "PERCENTAGE",
      value: 10,
      startsAt: new Date(FUTURE_START),
      endsAt: new Date(FUTURE_END),
      isActive: true,
    };
    const { repository, createCalls } = makeFakeRepository({ existingDiscounts: [existing] });

    const result = await createAdminDiscount(repository, {
      productId: "product-1",
      type: "FIXED_AMOUNT",
      value: 500,
      // Overlaps the middle of the existing discount's window.
      startsAt: "2026-07-15T00:00:00.000Z",
      endsAt: "2026-08-15T00:00:00.000Z",
    });
    expect(result).toEqual({ ok: false, error: "DISCOUNT_OVERLAP" });
    // Rejected by the application-layer pre-check — never even reaches
    // the repository's own atomic check in this non-concurrent case.
    expect(createCalls).toHaveLength(0);
  });

  it("allows a second, non-overlapping discount for the same product", async () => {
    const existing: ProductDiscount = {
      id: "discount-existing",
      productId: "product-1",
      type: "PERCENTAGE",
      value: 10,
      startsAt: new Date("2026-06-01T00:00:00.000Z"),
      endsAt: new Date("2026-06-30T00:00:00.000Z"),
      isActive: true,
    };
    const { repository } = makeFakeRepository({ existingDiscounts: [existing] });

    const result = await createAdminDiscount(repository, {
      productId: "product-1",
      type: "FIXED_AMOUNT",
      value: 500,
      startsAt: FUTURE_START,
      endsAt: FUTURE_END,
    });
    expect(result.ok).toBe(true);
  });
});

describe("updateAdminDiscount", () => {
  it("updates a discount's value and dates", async () => {
    const existing: ProductDiscount = {
      id: "discount-1",
      productId: "product-1",
      type: "PERCENTAGE",
      value: 10,
      startsAt: new Date(FUTURE_START),
      endsAt: new Date(FUTURE_END),
      isActive: true,
    };
    const { repository } = makeFakeRepository({ existingDiscounts: [existing] });

    const result = await updateAdminDiscount(repository, "discount-1", {
      type: "PERCENTAGE",
      value: 25,
      startsAt: FUTURE_START,
      endsAt: FUTURE_END,
      isActive: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discount.value).toBe(25);
  });

  it("rejects moving a discount's dates to overlap a sibling discount on the same product", async () => {
    const target: ProductDiscount = {
      id: "discount-1",
      productId: "product-1",
      type: "PERCENTAGE",
      value: 10,
      startsAt: new Date("2026-06-01T00:00:00.000Z"),
      endsAt: new Date("2026-06-30T00:00:00.000Z"),
      isActive: true,
    };
    const sibling: ProductDiscount = {
      id: "discount-2",
      productId: "product-1",
      type: "FIXED_AMOUNT",
      value: 500,
      startsAt: new Date(FUTURE_START),
      endsAt: new Date(FUTURE_END),
      isActive: true,
    };
    const { repository } = makeFakeRepository({ existingDiscounts: [target, sibling] });

    const result = await updateAdminDiscount(repository, "discount-1", {
      type: "PERCENTAGE",
      value: 10,
      // Moved to overlap `sibling`'s window.
      startsAt: FUTURE_START,
      endsAt: FUTURE_END,
      isActive: true,
    });
    expect(result).toEqual({ ok: false, error: "DISCOUNT_OVERLAP" });
  });

  it("rejects an unrecognized discount id", async () => {
    const { repository } = makeFakeRepository();
    const result = await updateAdminDiscount(repository, "nonexistent", {
      type: "PERCENTAGE",
      value: 10,
      startsAt: FUTURE_START,
      endsAt: FUTURE_END,
      isActive: true,
    });
    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});

describe("setAdminDiscountActive", () => {
  it("deactivates an active discount", async () => {
    const existing: ProductDiscount = {
      id: "discount-1",
      productId: "product-1",
      type: "PERCENTAGE",
      value: 10,
      startsAt: new Date(FUTURE_START),
      endsAt: new Date(FUTURE_END),
      isActive: true,
    };
    const { repository } = makeFakeRepository({ existingDiscounts: [existing] });

    const result = await setAdminDiscountActive(repository, "discount-1", false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discount.isActive).toBe(false);
  });

  it("rejects an unrecognized discount id", async () => {
    const { repository } = makeFakeRepository();
    const result = await setAdminDiscountActive(repository, "nonexistent", false);
    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});

describe("removeAdminDiscount", () => {
  it("removes an existing discount", async () => {
    const existing: ProductDiscount = {
      id: "discount-1",
      productId: "product-1",
      type: "PERCENTAGE",
      value: 10,
      startsAt: new Date(FUTURE_START),
      endsAt: new Date(FUTURE_END),
      isActive: true,
    };
    const { repository } = makeFakeRepository({ existingDiscounts: [existing] });

    const result = await removeAdminDiscount(repository, "discount-1");
    expect(result).toEqual({ ok: true });
  });

  it("rejects an unrecognized discount id", async () => {
    const { repository } = makeFakeRepository();
    const result = await removeAdminDiscount(repository, "nonexistent");
    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});
