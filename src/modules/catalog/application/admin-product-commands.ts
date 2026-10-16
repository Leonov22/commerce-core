import type {
  ProductRepository,
  AdminProductInput,
} from "@/modules/catalog/repositories/product-repository";
import type { AdminProduct } from "@/modules/catalog/domain/admin-product";
import type { ProductStatus, ProductBadge } from "@/modules/catalog/domain/product";

/**
 * Admin Panel write use cases (IMP-043). Every field here is validated
 * against the raw, untrusted shape a request body actually has — never
 * the typed `AdminProductInput` directly, since nothing upstream of this
 * function can be trusted to have actually sent well-formed data. This
 * mirrors `checkout-order.ts`'s own rule: a client's input decides *which*
 * product/category/price to apply to, never *whether* those values are
 * valid — that is always re-derived or re-checked here, never trusted.
 */

export interface RawAdminProductInput {
  slug?: unknown;
  status?: unknown;
  priceAmountMinor?: unknown;
  categoryId?: unknown;
  badge?: unknown;
  isFeatured?: unknown;
  sortOrder?: unknown;
  name?: unknown;
  meta?: unknown;
  description?: unknown;
  material?: unknown;
  dimensions?: unknown;
}

export type AdminProductValidationError =
  | "INVALID_SLUG"
  | "SLUG_ALREADY_EXISTS"
  | "INVALID_STATUS"
  | "INVALID_PRICE"
  | "INVALID_CATEGORY"
  | "CATEGORY_NOT_FOUND"
  | "INVALID_BADGE"
  | "INVALID_FEATURED_FLAG"
  | "INVALID_SORT_ORDER"
  | "INVALID_NAME";

export type CreateAdminProductResult =
  { ok: true; product: AdminProduct } | { ok: false; error: AdminProductValidationError };

export type UpdateAdminProductResult =
  | { ok: true; product: AdminProduct }
  | { ok: false; error: AdminProductValidationError | "NOT_FOUND" };

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VALID_STATUSES: readonly ProductStatus[] = ["DRAFT", "ACTIVE", "ARCHIVED"];
const VALID_BADGES: readonly ProductBadge[] = ["NEW", "LIMITED"];

/**
 * Postgres's `INTEGER` column (the type every money field in this schema
 * uses) is a signed 32-bit integer — the same boundary
 * `checkout-order.ts`'s `MAX_AMOUNT_MINOR` protects on the Order side.
 * Defined again here rather than imported from Order: Catalog must not
 * depend on Order (the dependency runs the other way), and this is a
 * generic database-column limit, not an Order-specific business rule.
 */
const MAX_PRICE_AMOUNT_MINOR = 2_147_483_647;

interface ValidatedAdminProductInput {
  ok: true;
  input: AdminProductInput;
}
interface InvalidAdminProductInput {
  ok: false;
  error: AdminProductValidationError;
}

function validateInput(
  raw: RawAdminProductInput,
): ValidatedAdminProductInput | InvalidAdminProductInput {
  if (typeof raw.slug !== "string" || !SLUG_PATTERN.test(raw.slug)) {
    return { ok: false, error: "INVALID_SLUG" };
  }
  if (typeof raw.status !== "string" || !VALID_STATUSES.includes(raw.status as ProductStatus)) {
    return { ok: false, error: "INVALID_STATUS" };
  }
  if (
    typeof raw.priceAmountMinor !== "number" ||
    !Number.isInteger(raw.priceAmountMinor) ||
    raw.priceAmountMinor < 0 ||
    raw.priceAmountMinor > MAX_PRICE_AMOUNT_MINOR
  ) {
    return { ok: false, error: "INVALID_PRICE" };
  }
  if (typeof raw.categoryId !== "string" || raw.categoryId.length === 0) {
    return { ok: false, error: "INVALID_CATEGORY" };
  }
  let badge: ProductBadge | null = null;
  if (raw.badge !== null && raw.badge !== undefined) {
    if (typeof raw.badge !== "string" || !VALID_BADGES.includes(raw.badge as ProductBadge)) {
      return { ok: false, error: "INVALID_BADGE" };
    }
    badge = raw.badge as ProductBadge;
  }
  if (typeof raw.isFeatured !== "boolean") {
    return { ok: false, error: "INVALID_FEATURED_FLAG" };
  }
  if (typeof raw.sortOrder !== "number" || !Number.isInteger(raw.sortOrder)) {
    return { ok: false, error: "INVALID_SORT_ORDER" };
  }
  if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
    return { ok: false, error: "INVALID_NAME" };
  }
  const meta = typeof raw.meta === "string" ? raw.meta : "";
  const description = typeof raw.description === "string" ? raw.description : "";
  const material = typeof raw.material === "string" ? raw.material : "";
  const dimensions = typeof raw.dimensions === "string" ? raw.dimensions : "";

  return {
    ok: true,
    input: {
      slug: raw.slug,
      status: raw.status as ProductStatus,
      priceAmountMinor: raw.priceAmountMinor,
      categoryId: raw.categoryId,
      badge,
      isFeatured: raw.isFeatured,
      sortOrder: raw.sortOrder,
      name: raw.name.trim(),
      meta,
      description,
      material,
      dimensions,
    },
  };
}

export async function createAdminProduct(
  repository: ProductRepository,
  raw: RawAdminProductInput,
): Promise<CreateAdminProductResult> {
  const validated = validateInput(raw);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const categoryExists = await repository.categoryExists(validated.input.categoryId);
  if (!categoryExists) {
    return { ok: false, error: "CATEGORY_NOT_FOUND" };
  }

  const slugTaken = await repository.slugExists(validated.input.slug);
  if (slugTaken) {
    return { ok: false, error: "SLUG_ALREADY_EXISTS" };
  }

  const product = await repository.createProduct(validated.input);
  return { ok: true, product };
}

export async function updateAdminProduct(
  repository: ProductRepository,
  id: string,
  raw: RawAdminProductInput,
): Promise<UpdateAdminProductResult> {
  const validated = validateInput(raw);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const categoryExists = await repository.categoryExists(validated.input.categoryId);
  if (!categoryExists) {
    return { ok: false, error: "CATEGORY_NOT_FOUND" };
  }

  const slugTaken = await repository.slugExists(validated.input.slug, id);
  if (slugTaken) {
    return { ok: false, error: "SLUG_ALREADY_EXISTS" };
  }

  const product = await repository.updateProduct(id, validated.input);
  if (!product) {
    return { ok: false, error: "NOT_FOUND" };
  }
  return { ok: true, product };
}
