import { describe, expect, it } from "vitest";
import { cartReducer, initialCartState } from "@/modules/cart/state/cart-reducer";

describe("cartReducer — HYDRATE", () => {
  it("replaces the current state wholesale with the given items", () => {
    const state = cartReducer([{ productId: "1", quantity: 5 }], {
      type: "HYDRATE",
      items: [{ productId: "2", quantity: 1 }],
    });
    expect(state).toEqual([{ productId: "2", quantity: 1 }]);
  });

  it("can hydrate an empty cart into one with items", () => {
    const state = cartReducer(initialCartState, {
      type: "HYDRATE",
      items: [{ productId: "1", quantity: 2 }],
    });
    expect(state).toEqual([{ productId: "1", quantity: 2 }]);
  });

  it("can hydrate into an empty cart", () => {
    const state = cartReducer([{ productId: "1", quantity: 2 }], {
      type: "HYDRATE",
      items: [],
    });
    expect(state).toEqual([]);
  });
});

describe("cartReducer — existing actions still behave the same (regression)", () => {
  it("ADD_ITEM adds a new product with quantity 1", () => {
    expect(cartReducer(initialCartState, { type: "ADD_ITEM", productId: "1" })).toEqual([
      { productId: "1", quantity: 1 },
    ]);
  });

  it("CLEAR_CART empties the cart", () => {
    expect(cartReducer([{ productId: "1", quantity: 2 }], { type: "CLEAR_CART" })).toEqual([]);
  });
});
