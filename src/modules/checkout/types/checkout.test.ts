import { describe, expect, it } from "vitest";
import { resolveCheckoutSummary } from "@/modules/checkout/types/checkout";
import type { CheckoutCartItem, CheckoutCatalogProduct } from "@/modules/checkout/types/checkout";

function makeItem(productId: string, quantity: number): CheckoutCartItem {
  return { productId, quantity };
}

function makeProduct(overrides: Partial<CheckoutCatalogProduct> = {}): CheckoutCatalogProduct {
  return {
    id: "1",
    name: "Studio Chair",
    meta: "Oak & linen",
    priceAmountMinor: 24000,
    currency: "USD",
    badge: null,
    ...overrides,
  };
}

describe("resolveCheckoutSummary", () => {
  it("returns a loading state without computing anything when Catalog is still loading", () => {
    const result = resolveCheckoutSummary(
      [makeItem("1", 1)],
      new Map([["1", makeProduct()]]),
      true,
    );
    expect(result).toEqual({ status: "loading" });
  });

  it("returns an empty, ready summary for an empty cart", () => {
    const result = resolveCheckoutSummary([], new Map(), false);
    expect(result).toEqual({
      status: "ready",
      lines: [],
      unresolvedCount: 0,
      subtotalAmountMinor: 0,
      currency: "USD",
    });
  });

  it("resolves a single product with the correct line total", () => {
    const productsById = new Map([["1", makeProduct({ id: "1", priceAmountMinor: 24000 })]]);
    const result = resolveCheckoutSummary([makeItem("1", 1)], productsById, false);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.lineTotalAmountMinor).toBe(24000);
    expect(result.subtotalAmountMinor).toBe(24000);
    expect(result.unresolvedCount).toBe(0);
  });

  it("multiplies unit price by quantity for quantity greater than 1 using integer minor units", () => {
    const productsById = new Map([["1", makeProduct({ id: "1", priceAmountMinor: 24000 })]]);
    const result = resolveCheckoutSummary([makeItem("1", 3)], productsById, false);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.lines[0]?.lineTotalAmountMinor).toBe(72000);
    expect(Number.isInteger(result.lines[0]?.lineTotalAmountMinor)).toBe(true);
    expect(result.subtotalAmountMinor).toBe(72000);
  });

  it("supports multiple products and sums their line totals into the subtotal", () => {
    const productsById = new Map([
      ["1", makeProduct({ id: "1", priceAmountMinor: 24000 })],
      ["2", makeProduct({ id: "2", priceAmountMinor: 31000 })],
      ["3", makeProduct({ id: "3", priceAmountMinor: 9600 })],
    ]);
    const items = [makeItem("1", 1), makeItem("2", 2), makeItem("3", 1)];
    const result = resolveCheckoutSummary(items, productsById, false);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.lines).toHaveLength(3);
    // 24000 + (31000 * 2) + 9600 = 95600
    expect(result.subtotalAmountMinor).toBe(95600);
    expect(result.unresolvedCount).toBe(0);
  });

  it("excludes an unresolved product from lines and subtotal, but counts it", () => {
    const result = resolveCheckoutSummary([makeItem("999", 1)], new Map(), false);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.lines).toHaveLength(0);
    expect(result.subtotalAmountMinor).toBe(0);
    expect(result.unresolvedCount).toBe(1);
  });

  it("handles a mix of resolved and unresolved products correctly", () => {
    const productsById = new Map([["1", makeProduct({ id: "1", priceAmountMinor: 24000 })]]);
    const items = [makeItem("1", 2), makeItem("999", 1)];
    const result = resolveCheckoutSummary(items, productsById, false);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.item.productId).toBe("1");
    expect(result.subtotalAmountMinor).toBe(48000);
    expect(result.unresolvedCount).toBe(1);
  });

  it("takes currency from the resolved products, not a hardcoded default", () => {
    const productsById = new Map([["1", makeProduct({ id: "1", currency: "EUR" })]]);
    const result = resolveCheckoutSummary([makeItem("1", 1)], productsById, false);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.currency).toBe("EUR");
  });
});
