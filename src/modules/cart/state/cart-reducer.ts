import type { CartState } from "@/modules/cart/types/cart";

export type CartAction =
  | { type: "ADD_ITEM"; productId: string }
  | { type: "INCREASE_QUANTITY"; productId: string }
  | { type: "DECREASE_QUANTITY"; productId: string }
  | { type: "REMOVE_ITEM"; productId: string }
  | { type: "CLEAR_CART" };

export const initialCartState: CartState = [];

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "ADD_ITEM":
    case "INCREASE_QUANTITY": {
      const existingItem = state.find((item) => item.productId === action.productId);
      if (existingItem) {
        return state.map((item) =>
          item.productId === action.productId ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      return [...state, { productId: action.productId, quantity: 1 }];
    }

    case "DECREASE_QUANTITY": {
      return state.flatMap((item) => {
        if (item.productId !== action.productId) {
          return [item];
        }
        if (item.quantity <= 1) {
          return [];
        }
        return [{ ...item, quantity: item.quantity - 1 }];
      });
    }

    case "REMOVE_ITEM":
      return state.filter((item) => item.productId !== action.productId);

    case "CLEAR_CART":
      return [];

    default:
      return state;
  }
}
