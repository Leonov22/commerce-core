import type { ProductRepository } from "@/modules/catalog/repositories/product-repository";
import type { ProductDiscount, DiscountType } from "@/modules/catalog/domain/discount";

/**
 * IMP-047: Admin Panel discount write use cases. Every field is validated
 * against the raw, untrusted shape a request body actually has — never
 * the typed `AdminDiscountInput` directly, mirroring
 * `admin-product-commands.ts`'s own rule: a client's input decides which
 * product/type/value/dates to apply, never whether those values are
 * valid — that is always re-derived or re-checked here.
 *
 * Overlap is detected twice, deliberately: once here (a fast,
 * non-atomic pre-check against `listDiscountsForProduct`, purely for a
 * quick, specific error on the happy path) and once more, atomically,
 * inside `ProductRepository.createProductDiscount`/`updateProductDiscount`
 * themselves (a Serializable-isolation transaction). The check here
 * cannot, by itself, protect against two concurrent requests for the
 * same product — see those methods' own doc comments for why only the
 * database-level check actually closes that race. This function's own
 * pre-check exists purely so the common, non-concurrent case gets a
 * precise `DISCOUNT_OVERLAP` without ever reaching the database.
 */

export interface RawAdminDiscountInput {
  productId?: unknown;
  type?: unknown;
  value?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  isActive?: unknown;
}

export type AdminDiscountValidationError =
  | "INVALID_PRODUCT"
  | "PRODUCT_NOT_FOUND"
  | "INVALID_TYPE"
  | "INVALID_PERCENTAGE_VALUE"
  | "INVALID_FIXED_VALUE"
  | "INVALID_DATE_RANGE"
  | "INVALID_ACTIVE_FLAG"
  | "DISCOUNT_OVERLAP";

export type CreateAdminDiscountResult =
  { ok: true; discount: ProductDiscount } | { ok: false; error: AdminDiscountValidationError };

export type UpdateAdminDiscountResult =
  | { ok: true; discount: ProductDiscount }
  | { ok: false; error: AdminDiscountValidationError | "NOT_FOUND" };

export type SetAdminDiscountActiveResult =
  { ok: true; discount: ProductDiscount } | { ok: false; error: "NOT_FOUND" };

export type RemoveAdminDiscountResult = { ok: true } | { ok: false; error: "NOT_FOUND" };

const VALID_TYPES: readonly DiscountType[] = ["PERCENTAGE", "FIXED_AMOUNT"];

interface ValidatedFields {
  type: DiscountType;
  value: number;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
}

/**
 * Validates every field EXCEPT the FIXED_AMOUNT bound against the
 * product's price, which the caller checks separately once it has
 * resolved the product (see `createAdminDiscount`/`updateAdminDiscount`)
 * — keeping this function free of any repository dependency.
 */
function validateFields(
  raw: RawAdminDiscountInput,
): { ok: true; fields: ValidatedFields } | { ok: false; error: AdminDiscountValidationError } {
  if (typeof raw.type !== "string" || !VALID_TYPES.includes(raw.type as DiscountType)) {
    return { ok: false, error: "INVALID_TYPE" };
  }
  const type = raw.type as DiscountType;

  if (typeof raw.value !== "number" || !Number.isInteger(raw.value)) {
    return {
      ok: false,
      error: type === "PERCENTAGE" ? "INVALID_PERCENTAGE_VALUE" : "INVALID_FIXED_VALUE",
    };
  }
  if (type === "PERCENTAGE" && (raw.value <= 0 || raw.value >= 100)) {
    return { ok: false, error: "INVALID_PERCENTAGE_VALUE" };
  }
  if (type === "FIXED_AMOUNT" && raw.value <= 0) {
    return { ok: false, error: "INVALID_FIXED_VALUE" };
  }

  const startsAt = typeof raw.startsAt === "string" ? new Date(raw.startsAt) : null;
  const endsAt = typeof raw.endsAt === "string" ? new Date(raw.endsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime()) || !endsAt || Number.isNaN(endsAt.getTime())) {
    return { ok: false, error: "INVALID_DATE_RANGE" };
  }
  if (endsAt <= startsAt) {
    return { ok: false, error: "INVALID_DATE_RANGE" };
  }

  if (raw.isActive !== undefined && typeof raw.isActive !== "boolean") {
    return { ok: false, error: "INVALID_ACTIVE_FLAG" };
  }
  const isActive = typeof raw.isActive === "boolean" ? raw.isActive : true;

  return { ok: true, fields: { type, value: raw.value, startsAt, endsAt, isActive } };
}

export async function createAdminDiscount(
  repository: ProductRepository,
  raw: RawAdminDiscountInput,
): Promise<CreateAdminDiscountResult> {
  if (typeof raw.productId !== "string" || raw.productId.length === 0) {
    return { ok: false, error: "INVALID_PRODUCT" };
  }

  const validated = validateFields(raw);
  if (!validated.ok) {
    return validated;
  }
  const { type, value, startsAt, endsAt, isActive } = validated.fields;

  const product = await repository.findByIdForAdmin(raw.productId);
  if (!product) {
    return { ok: false, error: "PRODUCT_NOT_FOUND" };
  }
  // §5.3: "a fixed discount must be greater than 0 and less than the
  // regular product price" — checked against the product's CURRENT
  // regular price, never a stale or client-supplied one.
  if (type === "FIXED_AMOUNT" && value >= product.priceAmountMinor) {
    return { ok: false, error: "INVALID_FIXED_VALUE" };
  }

  const siblings = await repository.listDiscountsForProduct(raw.productId);
  if (
    siblings.some((sibling) => rangesOverlap(startsAt, endsAt, sibling.startsAt, sibling.endsAt))
  ) {
    return { ok: false, error: "DISCOUNT_OVERLAP" };
  }

  const result = await repository.createProductDiscount({
    productId: raw.productId,
    type,
    value,
    startsAt,
    endsAt,
    isActive,
  });

  if (result.outcome === "productNotFound") {
    return { ok: false, error: "PRODUCT_NOT_FOUND" };
  }
  if (result.outcome === "overlap") {
    return { ok: false, error: "DISCOUNT_OVERLAP" };
  }
  return { ok: true, discount: result.discount };
}

export async function updateAdminDiscount(
  repository: ProductRepository,
  id: string,
  raw: RawAdminDiscountInput,
): Promise<UpdateAdminDiscountResult> {
  const validated = validateFields(raw);
  if (!validated.ok) {
    return validated;
  }
  const { type, value, startsAt, endsAt, isActive } = validated.fields;

  const existing = await repository.findAdminDiscountById(id);
  if (!existing) {
    return { ok: false, error: "NOT_FOUND" };
  }

  const product = await repository.findByIdForAdmin(existing.productId);
  if (!product) {
    return { ok: false, error: "PRODUCT_NOT_FOUND" };
  }
  if (type === "FIXED_AMOUNT" && value >= product.priceAmountMinor) {
    return { ok: false, error: "INVALID_FIXED_VALUE" };
  }

  const siblings = (await repository.listDiscountsForProduct(existing.productId)).filter(
    (sibling) => sibling.id !== id,
  );
  if (
    siblings.some((sibling) => rangesOverlap(startsAt, endsAt, sibling.startsAt, sibling.endsAt))
  ) {
    return { ok: false, error: "DISCOUNT_OVERLAP" };
  }

  const result = await repository.updateProductDiscount(id, {
    type,
    value,
    startsAt,
    endsAt,
    isActive,
  });

  if (result.outcome === "notFound") {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (result.outcome === "overlap") {
    return { ok: false, error: "DISCOUNT_OVERLAP" };
  }
  return { ok: true, discount: result.discount };
}

export async function setAdminDiscountActive(
  repository: ProductRepository,
  id: string,
  isActive: boolean,
): Promise<SetAdminDiscountActiveResult> {
  const discount = await repository.setProductDiscountActive(id, isActive);
  if (!discount) {
    return { ok: false, error: "NOT_FOUND" };
  }
  return { ok: true, discount };
}

export async function removeAdminDiscount(
  repository: ProductRepository,
  id: string,
): Promise<RemoveAdminDiscountResult> {
  const deleted = await repository.deleteProductDiscount(id);
  if (!deleted) {
    return { ok: false, error: "NOT_FOUND" };
  }
  return { ok: true };
}

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
