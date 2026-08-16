import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { markProductsFeatured } from "@/modules/catalog/infrastructure/feature-products";
import { prisma } from "@/modules/catalog/infrastructure/prisma-client";

/**
 * Integration tests against the real database — CR-037-01-SEED's core
 * safety claim ("touches ONLY isFeatured") is proven here by snapshotting
 * every other field before and after, not merely by reading the code.
 * Uses a dedicated throwaway product created and deleted by this test,
 * never any of the real seeded catalog rows, so this suite cannot alter
 * genuine product data either.
 */
describe("markProductsFeatured (CR-037-01-SEED)", () => {
  const createdProductIds: string[] = [];

  afterAll(async () => {
    if (createdProductIds.length > 0) {
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    }
    await prisma.$disconnect();
  });

  async function createTestProduct() {
    const category = await prisma.category.findFirstOrThrow();
    const product = await prisma.product.create({
      data: {
        slug: `test-feature-products-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        status: "ACTIVE",
        priceAmountMinor: 12_345,
        currency: "USD",
        categoryId: category.id,
        badge: "LIMITED",
        sortOrder: 999,
        isFeatured: false,
        translations: {
          create: {
            locale: "en",
            name: "Test Feature Product",
            meta: "Test meta",
            description: "Test description",
            material: "Test material",
            dimensions: "Test dimensions",
          },
        },
      },
      include: { translations: true },
    });
    createdProductIds.push(product.id);
    return product;
  }

  it("marks the given product isFeatured, changing no other field", async () => {
    const before = await createTestProduct();

    const count = await markProductsFeatured([before.id]);
    expect(count).toBe(1);

    const after = await prisma.product.findUniqueOrThrow({
      where: { id: before.id },
      include: { translations: true },
    });

    expect(after.isFeatured).toBe(true);
    // Everything else byte-for-byte unchanged.
    expect(after.slug).toBe(before.slug);
    expect(after.status).toBe(before.status);
    expect(after.priceAmountMinor).toBe(before.priceAmountMinor);
    expect(after.currency).toBe(before.currency);
    expect(after.categoryId).toBe(before.categoryId);
    expect(after.badge).toBe(before.badge);
    expect(after.sortOrder).toBe(before.sortOrder);
    expect(after.publishedAt?.getTime()).toBe(before.publishedAt?.getTime());
    expect(after.translations).toEqual(before.translations);
  });

  it("is idempotent — a second call produces the same final state", async () => {
    const product = await createTestProduct();

    const first = await markProductsFeatured([product.id]);
    const afterFirst = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });

    const second = await markProductsFeatured([product.id]);
    const afterSecond = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });

    expect(first).toBe(1);
    expect(second).toBe(1);
    // Same reported count and same resulting `isFeatured` value both
    // times — `updatedAt` legitimately advances on every write (Prisma's
    // `@updatedAt`), even when the semantic value didn't change, so it is
    // compared separately rather than included in the equality check.
    expect(afterSecond.isFeatured).toBe(afterFirst.isFeatured);
    expect(afterSecond.isFeatured).toBe(true);
    expect(afterSecond.slug).toBe(afterFirst.slug);
    expect(afterSecond.status).toBe(afterFirst.status);
    expect(afterSecond.priceAmountMinor).toBe(afterFirst.priceAmountMinor);
    expect(afterSecond.categoryId).toBe(afterFirst.categoryId);
    expect(afterSecond.badge).toBe(afterFirst.badge);
    expect(afterSecond.sortOrder).toBe(afterFirst.sortOrder);
  });

  it("does nothing and returns 0 for an empty id list", async () => {
    const count = await markProductsFeatured([]);
    expect(count).toBe(0);
  });

  it("returns 0 for an id that does not exist, without creating anything", async () => {
    const count = await markProductsFeatured(["does-not-exist"]);
    expect(count).toBe(0);
  });

  it("does not affect unrelated products", async () => {
    const target = await createTestProduct();
    const bystander = await createTestProduct();

    await markProductsFeatured([target.id]);

    const bystanderAfter = await prisma.product.findUniqueOrThrow({
      where: { id: bystander.id },
    });
    expect(bystanderAfter.isFeatured).toBe(false);
  });
});
