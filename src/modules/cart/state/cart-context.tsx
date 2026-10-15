"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { cartReducer, initialCartState } from "@/modules/cart/state/cart-reducer";
import { loadCartFromStorage, saveCartToStorage } from "@/modules/cart/state/cart-storage";
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

  // Account-first checkout: the sign-in/registration redirect round-trip
  // (and a plain page refresh) can be a hard navigation, which this pure
  // in-memory reducer state does not survive on its own. Hydration must
  // run in an effect, AFTER the initial render — never during render or in
  // a lazy `useReducer` initializer — because `localStorage` isn't
  // available during SSR and reading it synchronously on the client's
  // first render would make that render's output differ from what the
  // server already sent, a hydration mismatch. The one-render "empty,
  // then populated" flash this causes for a returning visitor is the
  // standard, accepted tradeoff for client-only persisted state.
  const isFirstPersistRef = useRef(true);

  useEffect(() => {
    const stored = loadCartFromStorage();
    if (stored.length > 0) {
      dispatch({ type: "HYDRATE", items: stored });
    }
  }, []);

  useEffect(() => {
    // Skips exactly the one render this effect sees before the hydration
    // effect above has had a chance to dispatch — both effects run, in
    // declaration order, in the same post-mount flush; without this guard
    // this effect would still see the pre-hydration (empty) `items` value
    // and write that over whatever was already correctly stored, a moment
    // before the hydration dispatch's own re-render corrects it anyway.
    // Skipping this one run entirely removes that window rather than
    // merely shrinking it.
    if (isFirstPersistRef.current) {
      isFirstPersistRef.current = false;
      return;
    }
    saveCartToStorage(items);
  }, [items]);

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
