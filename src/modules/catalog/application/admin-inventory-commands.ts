import type {
  InventoryRepository,
  AdjustStockResult as RepositoryAdjustStockResult,
} from "@/modules/catalog/repositories/inventory-repository";
import type { StockAdjustment } from "@/modules/catalog/domain/inventory";

/**
 * IMP-048 Increment 4: Admin Panel inventory write use cases. Every field
 * is validated against the raw, untrusted request-body shape — never a
 * typed input directly — mirroring `admin-discount-commands.ts`'s own
 * rule. Neither function here ever writes `stockQuantity` itself; both
 * delegate every actual mutation to `InventoryRepository.adjustStock` /
 * `InventoryRepository.setTrackInventory`, the same two operations
 * `prisma-inventory-repository.ts`'s own concurrency protocol protects.
 */

export interface RawSetTrackInventoryInput {
  trackInventory?: unknown;
  /** Only meaningful when enabling; ignored when disabling. */
  initialQuantity?: unknown;
  /** Required only if `initialQuantity` is given and actually changes the on-hand count. */
  reason?: unknown;
}

export type SetTrackInventoryValidationError =
  | "INVALID_TRACK_INVENTORY_FLAG"
  | "INVALID_INITIAL_QUANTITY"
  | "MISSING_REASON_FOR_INITIAL_QUANTITY";

export type SetTrackInventoryResult =
  | { outcome: "enabled"; stockQuantity: number; adjustment: StockAdjustment | null }
  | { outcome: "disabled" }
  | { outcome: "alreadyEnabled" }
  | { outcome: "alreadyDisabled" }
  /** Refusing to disable — see `InventoryRepository.setTrackInventory`'s own doc comment for why. */
  | { outcome: "activeReservationsExist"; reserved: number }
  | { outcome: "productNotFound" }
  | { outcome: "invalidInput"; error: SetTrackInventoryValidationError }
  | { outcome: "wouldGoNegative" }
  | { outcome: "belowActiveReservations"; activeReserved: number };

export async function setProductTrackInventory(
  inventoryRepository: InventoryRepository,
  productId: string,
  raw: RawSetTrackInventoryInput,
  adminUserId: string | null,
): Promise<SetTrackInventoryResult> {
  if (typeof raw.trackInventory !== "boolean") {
    return { outcome: "invalidInput", error: "INVALID_TRACK_INVENTORY_FLAG" };
  }

  const availability = await inventoryRepository.getProductAvailability(productId);
  if (!availability) {
    return { outcome: "productNotFound" };
  }

  if (!raw.trackInventory) {
    if (!availability.trackInventory) {
      return { outcome: "alreadyDisabled" };
    }
    const disableResult = await inventoryRepository.setTrackInventory({
      productId,
      trackInventory: false,
    });
    if (disableResult.outcome === "productNotFound") {
      return { outcome: "productNotFound" };
    }
    if (disableResult.outcome === "activeReservationsExist") {
      return { outcome: "activeReservationsExist", reserved: disableResult.reserved };
    }
    return { outcome: "disabled" };
  }

  if (availability.trackInventory) {
    return { outcome: "alreadyEnabled" };
  }

  let initialQuantity: number | undefined;
  if (raw.initialQuantity !== undefined) {
    if (
      typeof raw.initialQuantity !== "number" ||
      !Number.isInteger(raw.initialQuantity) ||
      raw.initialQuantity < 0
    ) {
      return { outcome: "invalidInput", error: "INVALID_INITIAL_QUANTITY" };
    }
    initialQuantity = raw.initialQuantity;
  }

  // A reason is required only if the requested quantity would actually
  // change the on-hand count — checked against `availability`'s own
  // snapshot here purely to give a precise validation error without a
  // round trip; the repository re-derives the real delta itself, under
  // its own row lock, and is the only thing that decides the final
  // outcome (see `setTrackInventory`'s own doc comment).
  let reason: string | undefined;
  if (initialQuantity !== undefined && initialQuantity !== availability.stockQuantity) {
    if (typeof raw.reason !== "string" || raw.reason.trim().length === 0) {
      return { outcome: "invalidInput", error: "MISSING_REASON_FOR_INITIAL_QUANTITY" };
    }
    reason = raw.reason.trim();
  }

  // One call: the flag flip, the stock write, and the audit row (if
  // any) all happen inside the repository's own single transaction —
  // never two separate calls, which is exactly the race this function
  // used to have (see `setTrackInventory`'s own doc comment).
  const enableResult = await inventoryRepository.setTrackInventory({
    productId,
    trackInventory: true,
    initialQuantity,
    reason,
    adminUserId,
  });

  if (enableResult.outcome === "productNotFound") {
    return { outcome: "productNotFound" };
  }
  if (enableResult.outcome === "activeReservationsExist") {
    // Never actually returned for `trackInventory: true` by the
    // repository (see its own doc comment) — handled only so this
    // function stays exhaustive over the union.
    return { outcome: "productNotFound" };
  }
  if (enableResult.outcome === "wouldGoNegative") {
    return { outcome: "wouldGoNegative" };
  }
  if (enableResult.outcome === "belowActiveReservations") {
    return { outcome: "belowActiveReservations", activeReserved: enableResult.activeReserved };
  }

  return {
    outcome: "enabled",
    stockQuantity: enableResult.stockQuantity,
    adjustment: enableResult.adjustment,
  };
}

export interface RawAdjustStockInput {
  productId?: unknown;
  quantityChange?: unknown;
  reason?: unknown;
}

export type AdjustProductStockValidationError =
  "INVALID_PRODUCT" | "INVALID_QUANTITY_CHANGE" | "MISSING_REASON";

export type AdjustProductStockResult =
  | { ok: true; result: RepositoryAdjustStockResult }
  | { ok: false; error: AdjustProductStockValidationError };

/**
 * Required reason, non-zero integer quantity change — both re-validated
 * here server-side regardless of what the admin UI already enforces, per
 * `admin-discount-commands.ts`'s own "a client's input decides *what* to
 * apply, never whether it's valid" rule. The resulting outcome
 * (`applied`/`wouldGoNegative`/`belowActiveReservations`/`productNotFound`)
 * is `InventoryRepository.adjustStock`'s own — never reinterpreted here.
 */
export async function adjustProductStock(
  inventoryRepository: InventoryRepository,
  raw: RawAdjustStockInput,
  adminUserId: string | null,
): Promise<AdjustProductStockResult> {
  if (typeof raw.productId !== "string" || raw.productId.length === 0) {
    return { ok: false, error: "INVALID_PRODUCT" };
  }
  if (
    typeof raw.quantityChange !== "number" ||
    !Number.isInteger(raw.quantityChange) ||
    raw.quantityChange === 0
  ) {
    return { ok: false, error: "INVALID_QUANTITY_CHANGE" };
  }
  if (typeof raw.reason !== "string" || raw.reason.trim().length === 0) {
    return { ok: false, error: "MISSING_REASON" };
  }

  const result = await inventoryRepository.adjustStock({
    productId: raw.productId,
    quantityChange: raw.quantityChange,
    reason: raw.reason.trim(),
    adminUserId,
  });
  return { ok: true, result };
}
