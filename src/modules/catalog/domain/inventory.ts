/**
 * Catalog domain entities for reservation-based inventory tracking
 * (IMP-048, Increment 2). Framework independent: no Prisma, React,
 * Next.js, or persistence details.
 *
 * See `prisma-inventory-repository.ts` for the concurrency protocol
 * these are read and written under — this file only shapes the data.
 */

export type StockReservationStatus = "ACTIVE" | "EXPIRED" | "RELEASED" | "CONSUMED";

/**
 * Permanent once created for a given `(orderId, productId)` pair —
 * whatever terminal state (`EXPIRED`/`RELEASED`/`CONSUMED`) it reaches is
 * final; no second row is ever created for the same pair, and a terminal
 * row is never revived back to `ACTIVE`.
 */
export interface StockReservation {
  id: string;
  productId: string;
  /** Correlates to `Order.id` — not a foreign key; see the repository's own doc comment for why. */
  orderId: string;
  quantity: number;
  status: StockReservationStatus;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Append-only audit row for an admin-initiated stock change. Never updated or deleted. */
export interface StockAdjustment {
  id: string;
  productId: string;
  /** Signed; never zero — a no-op adjustment is rejected before it reaches the database. */
  quantityChange: number;
  reason: string;
  adminUserId: string | null;
  createdAt: Date;
}

export type InventoryExceptionStatus = "OPEN" | "RESOLVED";

/**
 * A durable record that a payment succeeded but its reservation could no
 * longer be consumed (expired/released by the time the webhook arrived).
 * Idempotent on `reservationId` — at most one exception can ever exist
 * per reservation, mirroring the reservation's own permanence invariant.
 */
export interface InventoryException {
  id: string;
  reservationId: string;
  orderId: string;
  productId: string;
  quantity: number;
  /** No foreign key — Payment is a different module. */
  paymentId: string | null;
  reason: string;
  status: InventoryExceptionStatus;
  detectedAt: Date;
  resolvedAt: Date | null;
  resolvedByAdminUserId: string | null;
  resolutionNote: string | null;
}

/**
 * `available` is `null` for an untracked product (`trackInventory: false`)
 * — it is never given a numeric value that could be mistaken for a real
 * capacity limit. `reserved` is always the live, read-time-filtered sum of
 * `ACTIVE` reservations — see the repository's own doc comment on why
 * read-time filtering is fine for a display query but not for a capacity
 * *decision*.
 */
export interface ProductAvailability {
  productId: string;
  trackInventory: boolean;
  stockQuantity: number;
  reserved: number;
  available: number | null;
}
