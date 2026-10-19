/**
 * Catalog domain entity for a product discount (IMP-047). Framework
 * independent: no Prisma, React, Next.js, or persistence details.
 */

export type DiscountType = "PERCENTAGE" | "FIXED_AMOUNT";

export interface ProductDiscount {
  id: string;
  productId: string;
  type: DiscountType;
  /** PERCENTAGE: a whole percent, 1-99. FIXED_AMOUNT: integer minor units. */
  value: number;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
}
