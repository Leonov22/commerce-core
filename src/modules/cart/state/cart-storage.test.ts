import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCartFromStorage, saveCartToStorage } from "@/modules/cart/state/cart-storage";

const STORAGE_KEY = "commerce-core.cart";

/**
 * This project's Vitest config runs under `environment: "node"` (no
 * `jsdom`, no `window`) — adding one just to test a two-function
 * localStorage wrapper would be a new dependency for a problem a small,
 * self-contained fake already solves. Only `getItem`/`setItem` are real
 * methods (so `vi.spyOn` can still replace them per-test, exactly as it
 * would on a real `Storage` object) backed by a plain in-memory map.
 */
function createFakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
  };
}

type FakeWindow = { localStorage: ReturnType<typeof createFakeLocalStorage> };

describe("loadCartFromStorage / saveCartToStorage", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  let fakeWindow: FakeWindow;

  beforeEach(() => {
    fakeWindow = { localStorage: createFakeLocalStorage() };
    (globalThis as unknown as { window: FakeWindow }).window = fakeWindow;
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  describe("loadCartFromStorage", () => {
    it("returns an empty array when nothing is stored", () => {
      expect(loadCartFromStorage()).toEqual([]);
    });

    it("returns the stored items when they are valid", () => {
      fakeWindow.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([{ productId: "1", quantity: 2 }]),
      );
      expect(loadCartFromStorage()).toEqual([{ productId: "1", quantity: 2 }]);
    });

    it("returns an empty array for malformed JSON", () => {
      fakeWindow.localStorage.setItem(STORAGE_KEY, "{not valid json");
      expect(loadCartFromStorage()).toEqual([]);
    });

    it("returns an empty array when the stored value is not an array", () => {
      fakeWindow.localStorage.setItem(STORAGE_KEY, JSON.stringify({ productId: "1", quantity: 2 }));
      expect(loadCartFromStorage()).toEqual([]);
    });

    it("filters out invalid entries while keeping valid ones", () => {
      fakeWindow.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([
          { productId: "1", quantity: 2 },
          { productId: "", quantity: 1 }, // empty productId
          { productId: "2", quantity: 0 }, // non-positive quantity
          { productId: "3", quantity: 1.5 }, // non-integer quantity
          { productId: "4" }, // missing quantity
          { quantity: 1 }, // missing productId
          "not an object",
          42,
          null,
        ]),
      );
      expect(loadCartFromStorage()).toEqual([{ productId: "1", quantity: 2 }]);
    });

    it("never throws when localStorage.getItem itself throws", () => {
      const spy = vi.spyOn(fakeWindow.localStorage, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      expect(() => loadCartFromStorage()).not.toThrow();
      expect(loadCartFromStorage()).toEqual([]);
      spy.mockRestore();
    });
  });

  describe("saveCartToStorage", () => {
    it("persists items so a later load returns them", () => {
      saveCartToStorage([{ productId: "1", quantity: 3 }]);
      expect(loadCartFromStorage()).toEqual([{ productId: "1", quantity: 3 }]);
    });

    it("persists an empty cart", () => {
      fakeWindow.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([{ productId: "1", quantity: 1 }]),
      );
      saveCartToStorage([]);
      expect(loadCartFromStorage()).toEqual([]);
    });

    it("never throws when localStorage.setItem itself throws (quota exceeded, disabled, etc.)", () => {
      const spy = vi.spyOn(fakeWindow.localStorage, "setItem").mockImplementation(() => {
        throw new Error("quota exceeded");
      });
      expect(() => saveCartToStorage([{ productId: "1", quantity: 1 }])).not.toThrow();
      spy.mockRestore();
    });
  });
});

describe("loadCartFromStorage / saveCartToStorage — SSR safety", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it("loadCartFromStorage returns [] when window is undefined (SSR)", () => {
    expect(loadCartFromStorage()).toEqual([]);
  });

  it("saveCartToStorage is a safe no-op when window is undefined (SSR)", () => {
    expect(() => saveCartToStorage([{ productId: "1", quantity: 1 }])).not.toThrow();
  });
});
