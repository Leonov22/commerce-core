import { describe, expect, it } from "vitest";
import {
  getProductById,
  getProductsByIds,
  listProducts,
  listCategories,
} from "@/modules/catalog/application/catalog-queries";
import type {
  ProductListFilter,
  ProductRepository,
} from "@/modules/catalog/repositories/product-repository";
import type { Product } from "@/modules/catalog/domain/product";
import type { Category } from "@/modules/catalog/domain/category";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "1",
    slug: "studio-chair",
    status: "ACTIVE",
    priceAmountMinor: 24000,
    currency: "USD",
    categorySlug: "seating",
    badge: null,
    isFeatured: false,
    sortOrder: 0,
    translation: {
      locale: "en",
      name: "Studio Chair",
      meta: "Oak & linen",
      description: "A studio chair.",
      material: "Oak",
      dimensions: "58 × 60 × 78 cm",
    },
    ...overrides,
  };
}

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: "cat-1",
    slug: "seating",
    sortOrder: 0,
    translation: { locale: "en", name: "Seating" },
    ...overrides,
  };
}

/**
 * A fake `ProductRepository` — the application layer must depend only on
 * this abstraction, never on the real Prisma implementation, so its tests
 * exercise the abstraction with an in-memory stand-in.
 */
function makeFakeRepository(products: Product[], categories: Category[]): ProductRepository {
  return {
    async findActiveById(id: string) {
      return products.find((product) => product.id === id) ?? null;
    },
    async findActiveByIds(ids: string[]) {
      return products.filter((product) => ids.includes(product.id));
    },
    async listActive(_locale: string, filter?: ProductListFilter) {
      return filter?.categorySlug
        ? products.filter((product) => product.categorySlug === filter.categorySlug)
        : products;
    },
    async listCategories() {
      return categories;
    },
  };
}

describe("catalog-queries", () => {
  describe("getProductById", () => {
    it("returns the product when the repository resolves it", async () => {
      const repository = makeFakeRepository([makeProduct()], []);
      const product = await getProductById(repository, "1", "en");
      expect(product?.id).toBe("1");
    });

    it("returns null when the repository has no match", async () => {
      const repository = makeFakeRepository([], []);
      const product = await getProductById(repository, "missing", "en");
      expect(product).toBeNull();
    });
  });

  describe("getProductsByIds", () => {
    it("returns only the requested, resolvable products", async () => {
      const repository = makeFakeRepository(
        [makeProduct({ id: "1" }), makeProduct({ id: "2" })],
        [],
      );
      const products = await getProductsByIds(repository, ["1", "3"], "en");
      expect(products.map((product) => product.id)).toEqual(["1"]);
    });
  });

  describe("listProducts", () => {
    it("passes the category filter through to the repository", async () => {
      const repository = makeFakeRepository(
        [
          makeProduct({ id: "1", categorySlug: "seating" }),
          makeProduct({ id: "3", categorySlug: "lighting" }),
        ],
        [],
      );
      const products = await listProducts(repository, "en", { categorySlug: "lighting" });
      expect(products.map((product) => product.id)).toEqual(["3"]);
    });

    it("returns every product when no filter is given", async () => {
      const repository = makeFakeRepository(
        [makeProduct({ id: "1" }), makeProduct({ id: "2" })],
        [],
      );
      const products = await listProducts(repository, "en");
      expect(products).toHaveLength(2);
    });
  });

  describe("listCategories", () => {
    it("returns categories from the repository", async () => {
      const repository = makeFakeRepository([], [makeCategory()]);
      const categories = await listCategories(repository, "en");
      expect(categories.map((category) => category.slug)).toEqual(["seating"]);
    });
  });
});
