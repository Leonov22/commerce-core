import type { ProductRepository } from "@/modules/catalog/repositories/product-repository";
import type { Category } from "@/modules/catalog/domain/category";

/**
 * Admin Panel category creation (IMP-043). Deliberately minimal — this
 * milestone's scope is Product management; Categories only needs to be
 * "functional," not a full editor. Editing/deleting an existing category
 * is not implemented: `Product.categoryId` has `onDelete: Restrict`, so a
 * category in use can't be deleted without first reassigning every
 * product on it — a real workflow decision for a future milestone, not
 * invented here.
 */

export interface RawAdminCategoryInput {
  slug?: unknown;
  name?: unknown;
  sortOrder?: unknown;
}

export type CreateAdminCategoryResult =
  | { ok: true; category: Category }
  | {
      ok: false;
      error: "INVALID_SLUG" | "SLUG_ALREADY_EXISTS" | "INVALID_NAME" | "INVALID_SORT_ORDER";
    };

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function createAdminCategory(
  repository: ProductRepository,
  raw: RawAdminCategoryInput,
): Promise<CreateAdminCategoryResult> {
  if (typeof raw.slug !== "string" || !SLUG_PATTERN.test(raw.slug)) {
    return { ok: false, error: "INVALID_SLUG" };
  }
  if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
    return { ok: false, error: "INVALID_NAME" };
  }
  const sortOrder =
    typeof raw.sortOrder === "number" && Number.isInteger(raw.sortOrder) ? raw.sortOrder : 0;

  const slugTaken = await repository.categorySlugExists(raw.slug);
  if (slugTaken) {
    return { ok: false, error: "SLUG_ALREADY_EXISTS" };
  }

  const category = await repository.createCategory({
    slug: raw.slug,
    name: raw.name.trim(),
    sortOrder,
  });
  return { ok: true, category };
}
