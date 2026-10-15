/**
 * Regression test for a React Strict Mode lifecycle bug in `CartProvider`:
 * Strict Mode double-invokes every mount effect's setup (setup → cleanup →
 * setup again) before any state update dispatched from within those
 * effects has actually been applied to a new render. The hydration and
 * persistence effects in `cart-context.tsx` must coordinate correctly
 * across that double invocation — this is a genuine React lifecycle
 * interaction, not something a hand-simulated call sequence can
 * trustworthily stand in for, so this test actually mounts the real
 * component tree under a real `React.StrictMode`.
 *
 * Matched by `vitest.config.ts`'s separate "client" project (the only
 * project with a `jsdom` environment and `@vitejs/plugin-react` — see that
 * file's own comment for why the default "server" project cannot run this
 * file at all: its required `react-server` resolve condition makes
 * `react-dom/client` refuse to resolve).
 *
 * Written with `React.createElement` rather than JSX purely so this file
 * can stay a plain `.test.ts` like every other test in this project,
 * rather than introducing the one `.test.tsx` file in the suite.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CartProvider, useCart } from "@/modules/cart/state/cart-context";
import type { CartItem } from "@/modules/cart/types/cart";

const STORAGE_KEY = "commerce-core.cart";

beforeAll(() => {
  // React's documented flag for test environments using `act()` outside
  // of a dedicated testing library (e.g. React Testing Library, which sets
  // this itself) — without it, `act()` still works correctly here, but
  // logs a spurious "environment not configured" warning on every call.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function CartProbe({ onItems }: { onItems: (items: CartItem[]) => void }) {
  const { items } = useCart();
  onItems(items);
  return null;
}

describe("CartProvider — hydration survives React Strict Mode's double-invoked mount effects", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root!.unmount();
      });
    }
    container.remove();
  });

  it("hydrates the persisted cart, and the pre-hydration empty state is never written to storage at any point — not even transiently", async () => {
    const persisted: CartItem[] = [
      { productId: "1", quantity: 2 },
      { productId: "3", quantity: 1 },
    ];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));

    // Checking only the FINAL stored value after everything settles is
    // not enough to catch this bug: React's own batching means a later,
    // correct write would silently overwrite an earlier, incorrect one
    // before `act()` ever resolves, so the end state alone can look fine
    // even if the empty state was written in between. Recording every
    // `setItem` call — not just the last one — is what actually proves
    // the bug can't happen, not merely that it self-corrects.
    //
    // `vi.spyOn` on jsdom's native `Storage` instance does not reliably
    // intercept calls made from other modules (its methods are backed by
    // jsdom's internal implementation, not plain writable own properties),
    // so `window.localStorage` is replaced outright with a small recording
    // fake backed by the same underlying real store, restored afterward.
    const originalLocalStorage = window.localStorage;
    const backingStore = new Map<string, string>();
    for (let i = 0; i < originalLocalStorage.length; i++) {
      const key = originalLocalStorage.key(i);
      if (key !== null) backingStore.set(key, originalLocalStorage.getItem(key)!);
    }
    const writtenValues: unknown[] = [];
    const recordingStorage: Storage = {
      getItem: (key: string) => (backingStore.has(key) ? backingStore.get(key)! : null),
      setItem: (key: string, value: string) => {
        if (key === STORAGE_KEY) {
          writtenValues.push(JSON.parse(value));
        }
        backingStore.set(key, value);
      },
      removeItem: (key: string) => backingStore.delete(key),
      clear: () => backingStore.clear(),
      key: (index: number) => Array.from(backingStore.keys())[index] ?? null,
      get length() {
        return backingStore.size;
      },
    };
    Object.defineProperty(window, "localStorage", {
      value: recordingStorage,
      configurable: true,
    });

    let latestItems: CartItem[] = [];

    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(
            CartProvider,
            null,
            createElement(CartProbe, {
              onItems: (items: CartItem[]) => {
                latestItems = items;
              },
            }),
          ),
        ),
      );
    });

    // Hydration must have actually applied — product IDs and quantities
    // intact, not left at the pre-hydration empty array.
    expect(latestItems).toEqual(persisted);

    // The exact bug this test targets: under Strict Mode, the persist
    // effect's SECOND invoked pass (within the same initial commit) must
    // never write the pre-hydration empty array over the real stored cart
    // — not even as a value later corrected by a subsequent write.
    expect(writtenValues).not.toContainEqual([]);
    for (const written of writtenValues) {
      expect(written).toEqual(persisted);
    }

    const stillStored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    expect(stillStored).toEqual(persisted);

    Object.defineProperty(window, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
  });

  it("still hydrates correctly (no crash, no stale write) when nothing was previously stored", async () => {
    let latestItems: CartItem[] = [];

    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(
            CartProvider,
            null,
            createElement(CartProbe, {
              onItems: (items: CartItem[]) => {
                latestItems = items;
              },
            }),
          ),
        ),
      );
    });

    expect(latestItems).toEqual([]);
    // Once hydration genuinely completes (even with nothing to hydrate),
    // persistence resumes and writes the current — still empty — cart.
    // That's a harmless, correct write, not a bug: it reflects the actual
    // (empty) state after mount, not a pre-hydration placeholder value.
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual([]);
  });
});
