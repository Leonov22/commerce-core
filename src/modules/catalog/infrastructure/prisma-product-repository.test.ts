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

  /**
   * IMP-046 (CR-046-01: concurrent replacement race fix). Integration
   * tests against the real Prisma `updateMany`-based compare-and-set —
   * confirming it actually behaves atomically against real Postgres
   * (including the `IS NULL` semantics for a product with no image),
   * not just in the application-layer fakes (`admin-product-image-commands.test.ts`).
   */
  describe("compareAndSetProductImage", () => {
    async function createTestProduct() {
      const category = await prisma.category.findFirstOrThrow();
      const product = await prisma.product.create({
        data: {
          slug: `test-cas-product-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          status: "DRAFT",
          priceAmountMinor: 1000,
          currency: "USD",
          categoryId: category.id,
          translations: {
            create: {
              locale: "en",
              name: "CAS Test Product",
              meta: "test",
              description: "test",
              material: "test",
              dimensions: "test",
            },
          },
        },
      });
      createdProductIds.push(product.id);
      return product;
    }

    it("writes the new image when the expected current imageUrl (null) matches", async () => {
      const product = await createTestProduct();
      const updated = await prismaProductRepository.compareAndSetProductImage(product.id, null, {
        imageUrl: "https://example.public.blob.vercel-storage.com/products/test/image-a",
        imageAlt: null,
      });
      expect(updated?.imageUrl).toBe(
        "https://example.public.blob.vercel-storage.com/products/test/image-a",
      );
    });

    it("refuses to write when the expected current imageUrl no longer matches — the real compare-and-set precondition", async () => {
      const product = await createTestProduct();
      await prismaProductRepository.compareAndSetProductImage(product.id, null, {
        imageUrl: "https://example.public.blob.vercel-storage.com/products/test/image-a",
        imageAlt: null,
      });

      // A stale caller still expecting `null` (the ORIGINAL state) must
      // be refused now that the image has already moved on to "image-a".
      const staleResult = await prismaProductRepository.compareAndSetProductImage(
        product.id,
        null,
        {
          imageUrl: "https://example.public.blob.vercel-storage.com/products/test/image-stale",
          imageAlt: null,
        },
      );
      expect(staleResult).toBeNull();

      const current = await prismaProductRepository.findByIdForAdmin(product.id);
      expect(current?.imageUrl).toBe(
        "https://example.public.blob.vercel-storage.com/products/test/image-a",
      );
    });

    it("returns null for a nonexistent product", async () => {
      const result = await prismaProductRepository.compareAndSetProductImage("nonexistent", null, {
        imageUrl: "https://example.public.blob.vercel-storage.com/products/test/image-a",
        imageAlt: null,
      });
      expect(result).toBeNull();
    });

    it("can clear the image back to null via compare-and-set", async () => {
      const product = await createTestProduct();
      await prismaProductRepository.compareAndSetProductImage(product.id, null, {
        imageUrl: "https://example.public.blob.vercel-storage.com/products/test/image-a",
        imageAlt: null,
      });

      const cleared = await prismaProductRepository.compareAndSetProductImage(
        product.id,
        "https://example.public.blob.vercel-storage.com/products/test/image-a",
        { imageUrl: null, imageAlt: null },
      );
      expect(cleared?.imageUrl).toBeNull();
    });
  });

  /**
   * IMP-047 (CR-047-01: concurrent overlap protection). Genuine
   * concurrent requests against the real database — the one thing a
   * fake `ProductRepository` cannot prove, since it never runs two
   * calls on separate connections racing against the same rows.
   */
  describe("createProductDiscount — concurrent overlap protection", () => {
    async function createTestProduct() {
      const category = await prisma.category.findFirstOrThrow();
      const product = await prisma.product.create({
        data: {
          slug: `test-discount-product-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          status: "DRAFT",
          priceAmountMinor: 10000,
          currency: "USD",
          categoryId: category.id,
          translations: {
            create: {
              locale: "en",
              name: "Discount Test Product",
              meta: "test",
              description: "test",
              material: "test",
              dimensions: "test",
            },
          },
        },
      });
      createdProductIds.push(product.id);
      return product;
    }

    it("only one of two genuinely concurrent requests for the same, overlapping date range succeeds — the other is rejected as an overlap, never both committed", async () => {
      const product = await createTestProduct();
      const startsAt = new Date("2027-01-01T00:00:00.000Z");
      const endsAt = new Date("2027-01-31T00:00:00.000Z");

      const [first, second] = await Promise.all([
        prismaProductRepository.createProductDiscount({
          productId: product.id,
          type: "PERCENTAGE",
          value: 10,
          startsAt,
          endsAt,
          isActive: true,
        }),
        prismaProductRepository.createProductDiscount({
          productId: product.id,
          type: "FIXED_AMOUNT",
          value: 500,
          startsAt,
          endsAt,
          isActive: true,
        }),
      ]);

      const outcomes = [first.outcome, second.outcome].sort();
      // Exactly one "created", exactly one "overlap" — never both
      // "created" (which would mean two simultaneously-effective
      // discounts silently coexisting, the exact anomaly IMP-047 §5.3
      // forbids) and never both failing either.
      expect(outcomes).toEqual(["created", "overlap"]);

      const remaining = await prismaProductRepository.listDiscountsForProduct(product.id);
      expect(remaining).toHaveLength(1);
    });

    it("a non-overlapping request made after a committed discount still succeeds normally", async () => {
      const product = await createTestProduct();
      const first = await prismaProductRepository.createProductDiscount({
        productId: product.id,
        type: "PERCENTAGE",
        value: 10,
        startsAt: new Date("2027-02-01T00:00:00.000Z"),
        endsAt: new Date("2027-02-28T00:00:00.000Z"),
        isActive: true,
      });
      expect(first.outcome).toBe("created");

      const second = await prismaProductRepository.createProductDiscount({
        productId: product.id,
        type: "FIXED_AMOUNT",
        value: 500,
        startsAt: new Date("2027-03-01T00:00:00.000Z"),
        endsAt: new Date("2027-03-31T00:00:00.000Z"),
        isActive: true,
      });
      expect(second.outcome).toBe("created");
    });
  });
});
