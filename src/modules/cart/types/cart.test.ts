import { describe, expect, it } from "vitest";
import { canCheckout, calculateCartSubtotal } from "@/modules/cart/types/cart";
import type { CartItem } from "@/modules/cart/types/cart";

function makeItem(productId: string, quantity = 1): CartItem {
  return { productId, quantity };
}

function makeResolvedProduct(
  effectivePriceAmountMinor: number,
  overrides: { currency?: string } = {},
) {
  return { effectivePriceAmountMinor, currency: overrides.currency ?? "EUR" };
}

describe("canCheckout", () => {
  it("is false for an empty cart", () => {
    expect(canCheckout([], new Map(), false)).toBe(false);
  });

  it("is false while Catalog resolution is still loading, even if every item already resolved", () => {
    const items = [makeItem("1")];
    const resolved = new Map([["1", {}]]);
    expect(canCheckout(items, resolved, true)).toBe(false);
  });

  it("is false when any cart item has no matching resolved product", () => {
    const items = [makeItem("1"), makeItem("2")];
    const resolved = new Map([["1", {}]]);
    expect(canCheckout(items, resolved, false)).toBe(false);
  });

  it("is false when no cart item has a matching resolved product", () => {
    const items = [makeItem("999")];
    const resolved = new Map();
    expect(canCheckout(items, resolved, false)).toBe(false);
  });

  it("is true when every cart item resolves and loading has finished", () => {
    const items = [makeItem("1"), makeItem("2", 3)];
    const resolved = new Map([
      ["1", {}],
      ["2", {}],
    ]);
    expect(canCheckout(items, resolved, false)).toBe(true);
  });

  it("does not depend on unrelated extra resolved products", () => {
    const items = [makeItem("1")];
    const resolved = new Map([
      ["1", {}],
      ["2", {}],
      ["3", {}],
    ]);
    expect(canCheckout(items, resolved, false)).toBe(true);
  });
});

describe("calculateCartSubtotal", () => {
  // The exact reported bug: a product discounted from €220 to €187 must
  // contribute €187 to the subtotal, not €220 — this is the scenario that
  // shipped broken (CartSummary summed `priceAmountMinor`, the €220
  // regular price, instead of `effectivePriceAmountMinor`, the €187 price
  // Checkout actually charges).
  it("uses the discounted (effective) price, never the regular price, for a discounted product — the Studio Chair €187 vs €220 regression", () => {
    const items = [makeItem("studio-chair", 1)];
    const productsById = new Map([["studio-chair", makeResolvedProduct(18700)]]);

    const result = calculateCartSubtotal(items, productsById);

    expect(result).toEqual({ amountMinor: 18700, currency: "EUR" });
    expect(result.amountMinor).not.toBe(22000); // the old, buggy regular-price total
  });

  it("scales the discounted price by quantity", () => {
    const items = [makeItem("studio-chair", 3)];
    const productsById = new Map([["studio-chair", makeResolvedProduct(18700)]]);

    expect(calculateCartSubtotal(items, productsById)).toEqual({
      amountMinor: 56100,
      currency: "EUR",
    });
  });

  it("recalculates correctly as quantity increases and decreases", () => {
    const productsById = new Map([["studio-chair", makeResolvedProduct(18700)]]);

    expect(calculateCartSubtotal([makeItem("studio-chair", 1)], productsById).amountMinor).toBe(
      18700,
    );
    expect(calculateCartSubtotal([makeItem("studio-chair", 5)], productsById).amountMinor).toBe(
      93500,
    );
    expect(calculateCartSubtotal([makeItem("studio-chair", 2)], productsById).amountMinor).toBe(
      37400,
    );
  });

  it("sums multiple products, each at its own effective price, undiscounted products included at their full price", () => {
    const items = [makeItem("studio-chair", 1), makeItem("desk-lamp", 2)];
    const productsById = new Map([
      ["studio-chair", makeResolvedProduct(18700)], // discounted: 220 -> 187
      ["desk-lamp", makeResolvedProduct(4500)], // no discount: effective === regular
    ]);

    // 18700 + (4500 * 2) = 27700
    expect(calculateCartSubtotal(items, productsById)).toEqual({
      amountMinor: 27700,
      currency: "EUR",
    });
  });

  it("ignores a cart line whose product has not resolved", () => {
    const items = [makeItem("studio-chair", 1), makeItem("not-yet-resolved", 2)];
    const productsById = new Map([["studio-chair", makeResolvedProduct(18700)]]);

    expect(calculateCartSubtotal(items, productsById)).toEqual({
      amountMinor: 18700,
      currency: "EUR",
    });
  });

  it("returns EUR with a zero amount for an empty cart", () => {
    expect(calculateCartSubtotal([], new Map())).toEqual({ amountMinor: 0, currency: "EUR" });
  });

  it("reports the resolved product's own currency, not just the EUR default", () => {
    const items = [makeItem("imported-item", 1)];
    const productsById = new Map([
      ["imported-item", makeResolvedProduct(10000, { currency: "USD" })],
    ]);

    expect(calculateCartSubtotal(items, productsById)).toEqual({
      amountMinor: 10000,
      currency: "USD",
    });
  });
});
