import { describe, expect, it } from "vitest";
import { canCheckout } from "@/modules/cart/types/cart";
import type { CartItem } from "@/modules/cart/types/cart";

function makeItem(productId: string, quantity = 1): CartItem {
  return { productId, quantity };
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
