import { describe, expect, it } from "vitest";
import { resolveEffectivePrice, isDiscountEffective } from "@/modules/catalog/domain/pricing";
import type { ProductDiscount } from "@/modules/catalog/domain/discount";

const NOW = new Date("2026-06-15T12:00:00.000Z");

function makeDiscount(overrides: Partial<ProductDiscount> = {}): ProductDiscount {
  return {
    id: "discount-1",
    productId: "product-1",
    type: "PERCENTAGE",
    value: 20,
    startsAt: new Date("2026-06-01T00:00:00.000Z"),
    endsAt: new Date("2026-06-30T23:59:59.000Z"),
    isActive: true,
    ...overrides,
  };
}

describe("resolveEffectivePrice", () => {
  it("returns the regular price unchanged when there are no discounts", () => {
    const result = resolveEffectivePrice(10000, [], NOW);
    expect(result).toEqual({
      regularPriceAmountMinor: 10000,
      effectivePriceAmountMinor: 10000,
      activeDiscount: null,
    });
  });

  it("applies a percentage discount: €100 regular, 20% off -> €80", () => {
    const discount = makeDiscount({ type: "PERCENTAGE", value: 20 });
    const result = resolveEffectivePrice(10000, [discount], NOW);
    expect(result.effectivePriceAmountMinor).toBe(8000);
    expect(result.activeDiscount).toEqual(discount);
  });

  it("applies a fixed-amount discount: €100 regular, €15 off -> €85", () => {
    const discount = makeDiscount({ type: "FIXED_AMOUNT", value: 1500 });
    const result = resolveEffectivePrice(10000, [discount], NOW);
    expect(result.effectivePriceAmountMinor).toBe(8500);
  });

  it("rounds a percentage discount to the nearest minor unit", () => {
    const discount = makeDiscount({ type: "PERCENTAGE", value: 33 });
    const result = resolveEffectivePrice(999, [discount], NOW);
    // 999 * 0.33 = 329.67 -> rounds to 330 -> 999 - 330 = 669
    expect(result.effectivePriceAmountMinor).toBe(669);
  });

  it("ignores a discount scheduled to start in the future", () => {
    const discount = makeDiscount({
      startsAt: new Date("2026-07-01T00:00:00.000Z"),
      endsAt: new Date("2026-07-31T00:00:00.000Z"),
    });
    const result = resolveEffectivePrice(10000, [discount], NOW);
    expect(result.effectivePriceAmountMinor).toBe(10000);
    expect(result.activeDiscount).toBeNull();
  });

  it("ignores an already-expired discount", () => {
    const discount = makeDiscount({
      startsAt: new Date("2026-05-01T00:00:00.000Z"),
      endsAt: new Date("2026-05-31T00:00:00.000Z"),
    });
    const result = resolveEffectivePrice(10000, [discount], NOW);
    expect(result.effectivePriceAmountMinor).toBe(10000);
  });

  it("ignores an inactive discount even if it is within its date range", () => {
    const discount = makeDiscount({ isActive: false });
    const result = resolveEffectivePrice(10000, [discount], NOW);
    expect(result.effectivePriceAmountMinor).toBe(10000);
    expect(result.activeDiscount).toBeNull();
  });

  it("applies exactly at the start instant (inclusive)", () => {
    const discount = makeDiscount({ startsAt: NOW, endsAt: new Date(NOW.getTime() + 1000) });
    expect(isDiscountEffective(discount, NOW)).toBe(true);
  });

  it("applies exactly at the end instant (inclusive), and stops the instant after", () => {
    const discount = makeDiscount({ startsAt: new Date(NOW.getTime() - 1000), endsAt: NOW });
    expect(isDiscountEffective(discount, NOW)).toBe(true);
    expect(isDiscountEffective(discount, new Date(NOW.getTime() + 1))).toBe(false);
  });

  it("never returns a negative effective price even if a fixed discount exceeds the current regular price", () => {
    // Defensive clamp — e.g. the product's price was lowered after the
    // discount was created; never trust the discount's own validity at
    // creation time as still true at calculation time.
    const discount = makeDiscount({ type: "FIXED_AMOUNT", value: 9000 });
    const result = resolveEffectivePrice(5000, [discount], NOW);
    expect(result.effectivePriceAmountMinor).toBe(0);
  });

  it("IMP-047 §5.3: falls back to the regular price, never stacking or picking one, when more than one discount is simultaneously effective", () => {
    const first = makeDiscount({ id: "discount-1", type: "PERCENTAGE", value: 10 });
    const second = makeDiscount({ id: "discount-2", type: "FIXED_AMOUNT", value: 500 });
    const result = resolveEffectivePrice(10000, [first, second], NOW);
    expect(result.effectivePriceAmountMinor).toBe(10000);
    expect(result.activeDiscount).toBeNull();
  });
});
