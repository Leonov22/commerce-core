import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prismaProductRepository } from "@/modules/catalog/infrastructure/prisma-product-repository";
import { prisma } from "@/modules/catalog/infrastructure/prisma-client";

/**
 * Integration tests against the real local Postgres database (seeded via
 * `prisma/seed.ts`). These exercise the actual Prisma queries, not a fake —
 * the application-layer tests (`catalog-queries.test.ts`) cover use-case
 * orchestration against a fake `ProductRepository` instead.
 */
describe("prismaProductRepository", () => {
  const createdProductIds: string[] = [];

  afterAll(async () => {
    if (createdProductIds.length > 0) {
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    }
    await prisma.$disconnect();
  });

  describe("findActiveById", () => {
    it("returns a seeded, active product", async () => {
      const product = await prismaProductRepository.findActiveById("1", "en");
      expect(product).not.toBeNull();
      expect(product?.slug).toBe("studio-chair");
      expect(product?.translation.name).toBe("Studio Chair");
      expect(product?.priceAmountMinor).toBe(24000);
      expect(product?.currency).toBe("USD");
    });

    it("returns null for a nonexistent product id", async () => {
      const product = await prismaProductRepository.findActiveById("does-not-exist", "en");
      expect(product).toBeNull();
    });

    it("falls back to the first available translation for an unknown locale", async () => {
      const product = await prismaProductRepository.findActiveById("1", "fr");
      expect(product?.translation.name).toBe("Studio Chair");
    });

    it("excludes DRAFT and ARCHIVED products", async () => {
      const category = await prisma.category.findUniqueOrThrow({ where: { slug: "seating" } });

      const draft = await prisma.product.create({
        data: {
          slug: "test-draft-product",
          status: "DRAFT",
          priceAmountMinor: 1000,
          currency: "USD",
          categoryId: category.id,
          translations: {
            create: {
              locale: "en",
              name: "Draft Product",
              meta: "test",
              description: "test",
              material: "test",
              dimensions: "test",
            },
          },
        },
      });
      const archived = await prisma.product.create({
        data: {
          slug: "test-archived-product",
          status: "ARCHIVED",
          priceAmountMinor: 1000,
          currency: "USD",
          categoryId: category.id,
          translations: {
            create: {
              locale: "en",
              name: "Archived Product",
              meta: "test",
              description: "test",
              material: "test",
              dimensions: "test",
            },
          },
        },
      });
      createdProductIds.push(draft.id, archived.id);

      expect(await prismaProductRepository.findActiveById(draft.id, "en")).toBeNull();
      expect(await prismaProductRepository.findActiveById(archived.id, "en")).toBeNull();

      const active = await prismaProductRepository.listActive("en");
      expect(active.some((product) => product.id === draft.id)).toBe(false);
      expect(active.some((product) => product.id === archived.id)).toBe(false);
    });
  });

  describe("findActiveByIds", () => {
    it("returns only the matching, active products, ignoring unknown ids", async () => {
      const products = await prismaProductRepository.findActiveByIds(["1", "2", "missing"], "en");
      expect(products.map((product) => product.id).sort()).toEqual(["1", "2"]);
    });

    it("returns an empty array for an empty id list", async () => {
      const products = await prismaProductRepository.findActiveByIds([], "en");
      expect(products).toEqual([]);
    });
  });

  describe("listActive", () => {
    it("lists every seeded active product without a filter", async () => {
      const products = await prismaProductRepository.listActive("en");
      const ids = products.map((product) => product.id);
      expect(ids).toEqual(expect.arrayContaining(["1", "2", "3", "4", "5", "6"]));
    });

    it("filters by category slug", async () => {
      const products = await prismaProductRepository.listActive("en", {
        categorySlug: "lighting",
      });
      expect(products.map((product) => product.id).sort()).toEqual(["3", "4"]);
    });

    it("IMP-037: filters by featuredOnly, returning the seeded featured products", async () => {
      const products = await prismaProductRepository.listActive("en", { featuredOnly: true });
      expect(products.map((product) => product.id).sort()).toEqual(["1", "3", "5", "6"]);
      expect(products.every((product) => product.isFeatured)).toBe(true);
    });
  });

  describe("listCategories", () => {
    it("returns all seeded categories with their translations, ordered by sortOrder", async () => {
      const categories = await prismaProductRepository.listCategories("en");
      expect(categories.map((category) => category.slug)).toEqual([
        "seating",
        "lighting",
        "textiles",
        "decor",
      ]);
      expect(categories[0]?.translation.name).toBe("Seating");
    });
  });
});
