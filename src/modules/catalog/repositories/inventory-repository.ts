import type {
  StockReservation,
  StockAdjustment,
  InventoryException,
  ProductAvailability,
} from "@/modules/catalog/domain/inventory";

export interface ReserveStockInput {
  orderId: string;
  productId: string;
  quantity: number;
  expiresAt: Date;
}

export type ReserveStockResult =
  | { outcome: "reserved"; reservation: StockReservation }
  /** Idempotent retry of the exact same request — the `(orderId, productId)` pair was already reserved and is still `ACTIVE`. */
  | { outcome: "alreadyReserved"; reservation: StockReservation }
  /** The pair already reached a terminal state (`EXPIRED`/`RELEASED`/`CONSUMED`) on a prior call — never revived, never re-created. */
  | { outcome: "alreadyFinal"; reservation: StockReservation }
  /** The product does not opt into inventory tracking — no row is created; there is nothing to reserve. */
  | { outcome: "notTracked" }
  | { outcome: "insufficientStock"; available: number }
  | { outcome: "productNotFound" };

export type ConsumeReservationResult =
  | { outcome: "consumed"; reservation: StockReservation }
  /** Idempotent retry of the exact same webhook delivery. */
  | { outcome: "alreadyConsumed"; reservation: StockReservation }
  /** Terminal (`EXPIRED`/`RELEASED`) or still `ACTIVE` but past `expiresAt` — the caller should record an `InventoryException`. */
  | { outcome: "notConsumable"; reservation: StockReservation }
  | { outcome: "notFound" };

export type ReleaseReservationResult =
  | { outcome: "released"; reservation: StockReservation }
  | { outcome: "alreadyReleased"; reservation: StockReservation }
  /** Already `CONSUMED` or `EXPIRED` — a terminal state release can never move away from. */
  | { outcome: "notReleasable"; reservation: StockReservation }
  | { outcome: "notFound" };

export interface RequiredPaymentItem {
  productId: string;
  quantity: number;
}

export type SecurePaymentWindowFailureReason =
  "productNotFound" | "reservationMissing" | "reservationNotActive";

export interface SecurePaymentWindowFailure {
  productId: string;
  reason: SecurePaymentWindowFailureReason;
}

export type SecurePaymentWindowResult =
  { ok: true } | { ok: false; failures: SecurePaymentWindowFailure[] };

export interface AdjustStockInput {
  productId: string;
  /** Signed; a restock is positive, a correction can be negative. Zero is rejected before reaching the database. */
  quantityChange: number;
  reason: string;
  adminUserId: string | null;
}

export type AdjustStockResult =
  | { outcome: "applied"; adjustment: StockAdjustment; stockQuantity: number }
  | { outcome: "wouldGoNegative"; currentStockQuantity: number }
  /** The resulting on-hand count would be lower than the sum of currently `ACTIVE` reservations. */
  | { outcome: "belowActiveReservations"; currentStockQuantity: number; activeReserved: number }
  | { outcome: "productNotFound" }
  | { outcome: "noOp" };

export interface SetTrackInventoryInput {
  productId: string;
  trackInventory: boolean;
  /**
   * Only meaningful when enabling (`trackInventory: true`); ignored when
   * disabling. An absolute target for `stockQuantity`, not a signed delta
   * — the signed delta from the row's current, lock-protected
   * `stockQuantity` is computed internally, inside the same transaction
   * and under the same row lock as the flag flip itself (see
   * `SetTrackInventoryResult`'s own doc comment for why this one-call
   * shape, rather than a separate `adjustStock` call afterward, is what
   * actually closes the race between enabling and a concurrent
   * `reserveStock`).
   */
  initialQuantity?: number;
  /** Required only if `initialQuantity` is given and actually differs from the current `stockQuantity` — a zero delta is a no-op, exactly like `adjustStock`'s own rule, and creates no audit row. */
  reason?: string;
  adminUserId?: string | null;
}

/**
 * `updated["adjustment"]` is non-null only when enabling with an
 * `initialQuantity` that actually changed `stockQuantity` — the same
 * `StockAdjustment` row `adjustStock` would have created, created here
 * instead, in the SAME transaction as the flag flip. `wouldGoNegative`/
 * `belowActiveReservations` mirror `AdjustStockResult`'s own outcomes of
 * the same name and are only possible on that same enabling path.
 */
export type SetTrackInventoryResult =
  | {
      outcome: "updated";
      trackInventory: boolean;
      stockQuantity: number;
      adjustment: StockAdjustment | null;
    }
  | { outcome: "productNotFound" }
  /**
   * Only ever returned when turning tracking OFF: refuses to stop tracking
   * a product that still has `ACTIVE`, unexpired reservations against it —
   * those reservations still correspond to a real promise made to a real
   * order, and silently abandoning that promise (or the stock backing it)
   * is never an acceptable side effect of an admin toggling a display flag.
   */
  | { outcome: "activeReservationsExist"; reserved: number }
  | { outcome: "wouldGoNegative"; currentStockQuantity: number }
  | { outcome: "belowActiveReservations"; currentStockQuantity: number; activeReserved: number }
  /**
   * Chat 3 Finding 1 (HIGH): only possible on the enable-with-
   * `initialQuantity` path. The ACTUAL delta, computed from the
   * row-locked `stockQuantity` (never a caller's own, possibly stale,
   * pre-check), is nonzero, but no non-empty `reason` was supplied.
   * Nothing is written when this is returned — `trackInventory` is not
   * flipped, `stockQuantity` is not changed, no audit row is created.
   */
  | { outcome: "reasonRequired" };

export interface RecordInventoryExceptionInput {
  reservationId: string;
  orderId: string;
  productId: string;
  quantity: number;
  paymentId: string | null;
  reason: string;
}

export type RecordInventoryExceptionResult =
  | { outcome: "created"; exception: InventoryException }
  /** Idempotent: an exception for this `reservationId` already existed — the existing row is returned, never duplicated. */
  | { outcome: "alreadyExists"; exception: InventoryException };

export interface StockAdjustmentListFilter {
  productId?: string;
}

export interface StockAdjustmentListOptions {
  filter?: StockAdjustmentListFilter;
  /** 1-based. */
  page: number;
  pageSize: number;
}

/** `StockAdjustment` joined with the product's display name, for the Admin Panel's read-only stock history view. */
export interface StockAdjustmentListItem extends StockAdjustment {
  productName: string;
}

export interface StockAdjustmentListPage {
  items: StockAdjustmentListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Read-only abstraction for IMP-048's reservation-based inventory
 * tracking. Lives in the Catalog module (not a separate module) since it
 * operates on `Product.stockQuantity`, the same aggregate the storefront
 * and admin product editor already own — see `prisma-inventory-repository.ts`'s
 * own doc comment for the full concurrency protocol every method here
 * follows.
 *
 * Nothing in this interface is wired into checkout or payment/webhook
 * flows yet (IMP-048 Increment 2) — that is a separately-approved,
 * later increment.
 */
export interface InventoryRepository {
  /**
   * Creates a permanent reservation for `(input.orderId, input.productId)`,
   * protected against concurrent overselling of the same product. See the
   * Prisma implementation's own doc comment for the exact lock/expire/
   * aggregate/insert sequence and why it is race-free.
   */
  reserveStock(input: ReserveStockInput): Promise<ReserveStockResult>;

  /**
   * Atomically transitions one `ACTIVE` reservation to `CONSUMED` and
   * decrements the product's on-hand `stockQuantity` by the reservation's
   * `quantity` — or reports why it could not (already consumed, or no
   * longer consumable), so the caller can record an `InventoryException`.
   */
  consumeReservation(orderId: string, productId: string): Promise<ConsumeReservationResult>;

  /** Transitions one `ACTIVE` reservation to `RELEASED` — e.g. a failed or abandoned checkout giving its hold back. */
  releaseReservation(orderId: string, productId: string): Promise<ReleaseReservationResult>;

  /**
   * Gates and extends the reservation TTL for every *tracked* item in
   * `requiredItems`, as one all-or-nothing operation — must be called as
   * the first step of every payment initialization/resume entry point,
   * strictly before any payment-provider call. Untracked items are
   * trivially satisfied (no reservation is ever expected for them).
   */
  securePaymentWindow(
    orderId: string,
    requiredItems: RequiredPaymentItem[],
    newExpiresAt: Date,
  ): Promise<SecurePaymentWindowResult>;

  /**
   * Admin-initiated, append-only stock change. Refuses to let the
   * resulting on-hand count drop below the sum of currently `ACTIVE`
   * reservations, or below zero.
   */
  adjustStock(input: AdjustStockInput): Promise<AdjustStockResult>;

  /**
   * Admin Panel opt-in/opt-out of inventory tracking (IMP-048 Increment
   * 4). Disabling never touches `stockQuantity`. Enabling with an
   * `initialQuantity` applies the resulting signed delta and creates its
   * `StockAdjustment` audit row atomically, in the SAME transaction and
   * under the SAME row lock as the flag flip — a caller must never
   * observe `trackInventory: true` paired with a `stockQuantity` that
   * predates the initialization (that was an earlier, two-transaction
   * design's race; see the Prisma implementation's own doc comment). See
   * `SetTrackInventoryResult`'s own doc comment for why disabling can
   * refuse.
   */
  setTrackInventory(input: SetTrackInventoryInput): Promise<SetTrackInventoryResult>;

  /** Idempotent on `reservationId` — see `RecordInventoryExceptionResult`'s own doc comment. */
  recordInventoryException(
    input: RecordInventoryExceptionInput,
  ): Promise<RecordInventoryExceptionResult>;

  /** `null` if no product exists with this id. */
  getProductAvailability(productId: string): Promise<ProductAvailability | null>;

  /**
   * Chat 3 Finding 3 (MEDIUM): the same calculation `getProductAvailability`
   * performs per product, batched into (at most) two queries total for
   * the whole given set — one bounded `IN (...)` read of the products
   * themselves, one bounded `groupBy` aggregate of their reservations —
   * instead of one `getProductAvailability` call (itself up to two
   * queries) per product. Mirrors `listLowStockProducts`'s own existing
   * `groupBy` batching; introduces no new calculation, only batches the
   * existing one. A product id with no matching row is simply absent
   * from the returned map — never a null/placeholder entry.
   */
  getProductsAvailability(productIds: string[]): Promise<Map<string, ProductAvailability>>;

  /** Every *tracked* product whose computed `available` is at or below `threshold`, ascending by `available`. */
  listLowStockProducts(threshold: number): Promise<ProductAvailability[]>;

  /**
   * Admin Panel read-only stock history (IMP-048 Increment 4). Every
   * `StockAdjustment` row, newest first, optionally scoped to one
   * product. Never filters or modifies the underlying rows — this is a
   * pure read over the same append-only, never-rewritten audit log
   * `adjustStock` creates.
   */
  listStockAdjustments(options: StockAdjustmentListOptions): Promise<StockAdjustmentListPage>;
}
