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

export interface OrderItem {
  id: string;
  orderId: string;
  /** Kept for traceability only — never dereferenced to reconstruct this line. */
  productId: string;
  productName: string;
  /** Integer minor units (e.g. $240.00 -> 24000). Never a float. */
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
}
