import { describe, expect, it } from "vitest";
import { createAdminCategory } from "@/modules/catalog/application/admin-category-commands";
import type { ProductRepository } from "@/modules/catalog/repositories/product-repository";
import type { Category } from "@/modules/catalog/domain/category";

function makeFakeRepository(existingSlugs: string[] = []): {
  repository: ProductRepository;
  createCalls: { slug: string; name: string; sortOrder: number }[];
} {
  const createCalls: { slug: string; name: string; sortOrder: number }[] = [];
  const repository: ProductRepository = {
    async findActiveById() {
      throw new Error("not used");
    },
    async findActiveByIds() {
      throw new Error("not used");
    },
    async listActive() {
      throw new Error("not used");
    },
    async listCategories() {
      throw new Error("not used");
    },
    async listForAdmin() {
      throw new Error("not used");
    },
    async findByIdForAdmin() {
      throw new Error("not used");
    },
    async createProduct() {
      throw new Error("not used");
    },
    async updateProduct() {
      throw new Error("not used");
    },
    async categoryExists() {
      throw new Error("not used");
    },
    async slugExists() {
      throw new Error("not used");
    },
    async categorySlugExists(slug) {
      return existingSlugs.includes(slug);
    },
    async setProductImage() {
      throw new Error("not used");
    },
    async clearProductImage() {
      throw new Error("not used");
    },
    async createCategory(input): Promise<Category> {
      createCalls.push(input);
      return {
        id: "new-category-id",
        slug: input.slug,
        sortOrder: input.sortOrder,
        translation: { locale: "en", name: input.name },
      };
    },
  };
  return { repository, createCalls };
}

describe("createAdminCategory", () => {
  it("creates a category from valid input", async () => {
    const { repository, createCalls } = makeFakeRepository();
    const result = await createAdminCategory(repository, {
      slug: "lighting-2",
      name: "Lighting 2",
      sortOrder: 5,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.category.slug).toBe("lighting-2");
    expect(createCalls).toHaveLength(1);
  });

  it("rejects an invalid slug", async () => {
    const { repository } = makeFakeRepository();
    const result = await createAdminCategory(repository, {
      slug: "Lighting 2",
      name: "Lighting 2",
    });
    expect(result).toEqual({ ok: false, error: "INVALID_SLUG" });
  });

  it("rejects an empty name", async () => {
    const { repository } = makeFakeRepository();
    const result = await createAdminCategory(repository, { slug: "lighting-2", name: "  " });
    expect(result).toEqual({ ok: false, error: "INVALID_NAME" });
  });

  it("rejects a slug already used by another category, never calling createCategory", async () => {
    const { repository, createCalls } = makeFakeRepository(["seating"]);
    const result = await createAdminCategory(repository, { slug: "seating", name: "Seating" });
    expect(result).toEqual({ ok: false, error: "SLUG_ALREADY_EXISTS" });
    expect(createCalls).toHaveLength(0);
  });

  it("defaults sortOrder to 0 when omitted or invalid", async () => {
    const { repository, createCalls } = makeFakeRepository();
    await createAdminCategory(repository, { slug: "lighting-2", name: "Lighting 2" });
    expect(createCalls[0]?.sortOrder).toBe(0);
  });
});
