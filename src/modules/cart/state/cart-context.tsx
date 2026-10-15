"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
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
  //
  // `isHydrated` is real component STATE, not a ref, specifically because
  // of React Strict Mode's development-only double-invoke behavior: on
  // mount, Strict Mode runs every effect's setup twice (setup → cleanup →
  // setup again) before any state update dispatched from within those
  // effects has actually been applied to a new render. A ref-based "skip
  // exactly the first run" guard does not survive this — Strict Mode's
  // SECOND invocation of the persist-effect below would already see the
  // ref flipped to its "past the first run" value (set by the first
  // invocation moments earlier, in the same commit), so it would proceed
  // to persist, but `items` would still be the ORIGINAL pre-hydration
  // empty array (the hydration dispatch's own re-render hasn't happened
  // yet) — overwriting a real stored cart with `[]` before hydration ever
  // gets a chance to apply. Gating on `isHydrated` STATE instead works
  // correctly here precisely because an effect's closure only ever
  // observes state as of the render that scheduled it — both of Strict
  // Mode's double-invoked passes still see `isHydrated === false` (the
  // `setIsHydrated(true)` calls from either pass are merely SCHEDULED, not
  // yet applied), so the persist-effect correctly skips both times; only
  // once a genuine new render actually commits with `isHydrated === true`
  // does persisting resume, by which point `items` already reflects
  // whatever hydration (if any) applied.
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const stored = loadCartFromStorage();
    if (stored.length > 0) {
      dispatch({ type: "HYDRATE", items: stored });
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    saveCartToStorage(items);
  }, [items, isHydrated]);

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
