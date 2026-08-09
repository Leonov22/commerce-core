"use client";

import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import { cartReducer, initialCartState } from "@/modules/cart/state/cart-reducer";
import type { CartItem } from "@/modules/cart/types/cart";

interface CartContextValue {
  items: CartItem[];
  totalQuantity: number;
  addItem: (productId: string) => void;
  increaseQuantity: (productId: string) => void;
  decreaseQuantity: (productId: string) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, dispatch] = useReducer(cartReducer, initialCartState);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      addItem: (productId) => dispatch({ type: "ADD_ITEM", productId }),
      increaseQuantity: (productId) => dispatch({ type: "INCREASE_QUANTITY", productId }),
      decreaseQuantity: (productId) => dispatch({ type: "DECREASE_QUANTITY", productId }),
      removeItem: (productId) => dispatch({ type: "REMOVE_ITEM", productId }),
      clearCart: () => dispatch({ type: "CLEAR_CART" }),
    }),
    [items],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
