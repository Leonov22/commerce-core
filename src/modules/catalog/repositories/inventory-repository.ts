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

  /** Idempotent on `reservationId` — see `RecordInventoryExceptionResult`'s own doc comment. */
  recordInventoryException(
    input: RecordInventoryExceptionInput,
  ): Promise<RecordInventoryExceptionResult>;

  /** `null` if no product exists with this id. */
  getProductAvailability(productId: string): Promise<ProductAvailability | null>;

  /** Every *tracked* product whose computed `available` is at or below `threshold`, ascending by `available`. */
  listLowStockProducts(threshold: number): Promise<ProductAvailability[]>;
}
