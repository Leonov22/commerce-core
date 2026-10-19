import type { ProductDiscount } from "@/modules/catalog/domain/discount";

/**
 * IMP-047: the ONE server-side price calculation shared by product
 * details, product listings, cart, checkout, and order creation (§5.4 of
 * the ticket) — every one of those call sites imports and calls
 * `resolveEffectivePrice` rather than computing a discount independently.
 * Pure: no Prisma, no clock access beyond the `now` parameter the caller
 * supplies, so it's trivially unit-testable and never silently drifts
 * from "the actual current time" between call sites.
 */

export interface EffectivePrice {
  /** The product's price before any discount — unchanged meaning from `Product.priceAmountMinor`. */
  regularPriceAmountMinor: number;
  /** The price after applying the currently-effective discount, if any — equal to `regularPriceAmountMinor` when none applies. Never negative. */
  effectivePriceAmountMinor: number;
  /** The discount actually applied to produce `effectivePriceAmountMinor`, or `null`. */
  activeDiscount: ProductDiscount | null;
}

/**
 * A discount is effective at `now` only when active AND within its own
 * [startsAt, endsAt] window, both bounds inclusive — "must not apply
 * before its start time" and "must stop applying after its end time"
 * (IMP-047 §5.3) are symmetric: the discount is effective for every
 * instant from (and including) `startsAt` through (and including) `endsAt`.
 */
export function isDiscountEffective(discount: ProductDiscount, now: Date): boolean {
  return discount.isActive && discount.startsAt <= now && now <= discount.endsAt;
}

/**
 * Resolves the price a customer actually pays right now. `discounts`
 * should be every discount configured for the product (regardless of
 * active state or date) — this function alone decides which, if any, is
 * currently effective; callers never pre-filter.
 *
 * If more than one discount is simultaneously effective, this is a data
 * integrity problem that creation-time validation (see
 * `admin-discount-commands.ts`'s overlap check, and the Serializable
 * transaction behind it) is specifically designed to make unreachable in
 * practice. IMP-047 §5.3 is explicit that an overlap must never be
 * silently stacked or arbitrarily resolved to one of them — the only safe
 * behavior left is the regular, undiscounted price, logged loudly so the
 * underlying data problem is visible rather than hidden behind a price
 * that happens to still look plausible.
 */
export function resolveEffectivePrice(
  regularPriceAmountMinor: number,
  discounts: readonly ProductDiscount[],
  now: Date,
): EffectivePrice {
  const effective = discounts.filter((discount) => isDiscountEffective(discount, now));

  if (effective.length === 0) {
    return {
      regularPriceAmountMinor,
      effectivePriceAmountMinor: regularPriceAmountMinor,
      activeDiscount: null,
    };
  }

  if (effective.length > 1) {
    console.error(
      "[pricing] multiple simultaneously-effective discounts found for one product — this should be unreachable given creation-time overlap validation; falling back to the regular price rather than stacking or guessing",
      { productId: effective[0]?.productId, discountIds: effective.map((discount) => discount.id) },
    );
    return {
      regularPriceAmountMinor,
      effectivePriceAmountMinor: regularPriceAmountMinor,
      activeDiscount: null,
    };
  }

  const discount = effective[0]!;
  const rawEffectivePrice =
    discount.type === "PERCENTAGE"
      ? regularPriceAmountMinor - Math.round((regularPriceAmountMinor * discount.value) / 100)
      : regularPriceAmountMinor - discount.value;

  // Never negative (§5.3) — a defensive clamp, not the normal case: a
  // FIXED_AMOUNT discount is already validated at creation time to be
  // less than the product's regular price AT THAT TIME, but the price
  // itself can be edited downward afterward, which this clamp protects
  // against without needing to re-validate every existing discount
  // whenever a product's price changes.
  return {
    regularPriceAmountMinor,
    effectivePriceAmountMinor: Math.max(0, rawEffectivePrice),
    activeDiscount: discount,
  };
}
