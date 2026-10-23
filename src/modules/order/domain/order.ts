/**
 * Order domain entities. Framework independent: no Prisma, React, Next.js,
 * or persistence details. Infrastructure maps its own (Prisma-generated)
 * representation onto this shape, never the other way around.
 *
 * An Order is a persisted purchase snapshot, not a live view of Cart or
 * Catalog — everything a future receipt/invoice needs (customer details,
 * each line's product name and price) is captured here at creation time and
 * must remain correct even if the originating Product or customer details
 * change afterward.
 */

export type OrderStatus = "PENDING" | "PAID" | "CANCELLED";

/**
 * The Order lifecycle (IMP-030). Explicit per-status allow-list rather than
 * a generic state-machine abstraction — there are exactly three statuses
 * and two legal transitions, and a framework here would be solving a
 * problem this domain doesn't have. `PAID` and `CANCELLED` are terminal:
 * neither has any outgoing transition, by omission from this map rather
 * than a separate "is terminal" check.
 */
const ALLOWED_ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["PAID", "CANCELLED"],
  PAID: [],
  CANCELLED: [],
};

export function isValidOrderStatusTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_ORDER_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * The Order record has no order-level discount column — each `OrderItem`
 * already captures both its regular and actually-charged unit price
 * (IMP-047), so the total discount is the sum of that difference across
 * every line, scaled by quantity. Pulled out as a pure function (mirrors
 * `calculateCartSubtotal` in Cart's own `types/cart.ts`) so the customer
 * order detail view can render it without duplicating the arithmetic
 * inline, and so it's directly unit-testable without rendering a React
 * Server Component. Returns 0 for an order with no discounted lines.
 */
export function calculateOrderDiscountAmountMinor(items: OrderItem[]): number {
  return items.reduce(
    (sum, item) =>
      sum + (item.regularUnitPriceAmountMinor - item.unitPriceAmountMinor) * item.quantity,
    0,
  );
}

/**
 * Mirrors Prisma's `PaymentStatus` enum values exactly, as a local string
 * literal union — same convention `OrderStatus` already uses for its own
 * enum, and for the same reason: this domain layer stays framework/Prisma
 * independent, and Order's own module boundary does not import from
 * `@/modules/payment` (its presentation layer explicitly composes Payment
 * UI via a slot the page provides, never by importing Payment directly —
 * see `CustomerOrderDetailView`'s own doc comment). Reading `Payment` row
 * data via Order's own `Order.payment` Prisma relation is not the same as
 * importing Payment's module surface: it's the reverse side of a 1:1
 * relation Order's own schema already declares.
 */
export type OrderPaymentStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export interface OrderPaymentSummary {
  status: OrderPaymentStatus;
  /** Provider-neutral reference (e.g. a Stripe PaymentIntent id) — never a card number or other payment secret. */
  providerReference: string | null;
}

export interface OrderItem {
  id: string;
  orderId: string;
  /** Kept for traceability only — never dereferenced to reconstruct this line. */
  productId: string;
  productName: string;
  /** IMP-047: the product's regular price at order-creation time, before any discount. Immutable, like every other field on this snapshot. */
  regularUnitPriceAmountMinor: number;
  /** Integer minor units (e.g. $240.00 -> 24000). Never a float. The actual price charged — equal to `regularUnitPriceAmountMinor` when no discount applied. */
  unitPriceAmountMinor: number;
  quantity: number;
  /** Integer minor units: `unitPriceAmountMinor * quantity` at creation time. */
  lineTotalAmountMinor: number;
  currency: string;
}

export interface Order {
  id: string;
  status: OrderStatus;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** The authenticated customer who placed this order — `null` for a guest order (IMP-029). */
  userId: string | null;
  subtotalAmountMinor: number;
  deliveryAmountMinor: number;
  totalAmountMinor: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  items: OrderItem[];
  /** `null` until a `Payment` row exists for this order (e.g. right after creation, before checkout's payment step begins) — never fabricated. */
  payment: OrderPaymentSummary | null;
}
