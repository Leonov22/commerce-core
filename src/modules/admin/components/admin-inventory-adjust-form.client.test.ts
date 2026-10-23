/**
 * Chat 3 Finding 3 (MEDIUM), Finding 1 (HIGH, round 4), and the
 * round-5 remount-persistence Finding (HIGH) — regression tests for
 * `AdminInventoryAdjustForm`'s unresolved-outcome warning. Needs a
 * real DOM and `react-dom/client` (jsdom, no `react-server` resolve
 * condition) — matched by `vitest.config.ts`'s "client" project, the
 * same one `cart-context.strict-mode.test.ts` uses, via the
 * `*.client.test.ts` naming added alongside it. Written with
 * `React.createElement` rather than JSX for the same reason that file
 * gives: staying out of the one `.test.tsx` file in the suite.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminInventoryAdjustForm } from "@/modules/admin/components/admin-inventory-adjust-form";

const refresh = vi.fn();
vi.mock("@/core/i18n/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

beforeAll(() => {
  // React's documented flag for test environments using `act()` outside
  // of a dedicated testing library — see `cart-context.strict-mode.test.ts`'s
  // own identical `beforeAll` for why.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function setNativeValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AdminInventoryAdjustForm — Chat 3 Finding 3 (MEDIUM): the unresolved-outcome warning", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    refresh.mockClear();
    // Round 5's whole point is `sessionStorage` persistence — tests
    // must start from a clean slate, never bleeding a flag set by one
    // test into the next one running in this same jsdom `window`.
    window.sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);

    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    await mount("product-1");
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  async function mount(productId: string) {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(AdminInventoryAdjustForm, { productId }));
      // Flushes the mount effect that reads `sessionStorage` — a
      // synchronous `act` callback does not reliably guarantee passive
      // effects have run yet, an `async` one awaiting a microtask does.
      await Promise.resolve();
    });
  }

  /**
   * Round 5: simulates exactly what the Finding describes — this
   * component instance is destroyed and a genuinely NEW one is
   * created, e.g. by leaving this product's inventory page and coming
   * back — never merely re-rendering the same mounted instance (which
   * would never lose in-memory state in the first place and would
   * prove nothing about this round's own fix).
   */
  async function remount(productId: string) {
    act(() => {
      root.unmount();
    });
    await mount(productId);
  }

  async function fillAndSubmit(quantity: string, reason: string) {
    const quantityInput = container.querySelector<HTMLInputElement>("#quantity")!;
    const reasonInput = container.querySelector<HTMLInputElement>("#adjustReason")!;
    setNativeValue(quantityInput, quantity);
    setNativeValue(reasonInput, reason);
    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      // Lets `handleSubmit`'s own promise chain (the `fetch` call and
      // everything after it) fully settle before this `act` resolves.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function unresolvedOutcomeWarningVisible(): boolean {
    return (container.textContent ?? "").includes("outcome is unknown");
  }

  it("shows the unresolved-outcome warning after a fetch rejection, and still refreshes so the admin has the latest history to check", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    await fillAndSubmit("5", "restock from supplier");

    expect(unresolvedOutcomeWarningVisible()).toBe(true);
    expect(container.textContent).toContain("NETWORK_ERROR");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the unresolved-outcome warning visible when a retry receives a non-2xx response, instead of letting an unrelated error silently clear it", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await fillAndSubmit("5", "restock from supplier");
    expect(unresolvedOutcomeWarningVisible()).toBe(true);

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "SOME_UNRELATED_VALIDATION_ERROR" }),
    });
    await fillAndSubmit("5", "restock from supplier");

    // The decisive assertion: a completely unrelated, non-2xx response
    // to THIS attempt must never be treated as evidence resolving the
    // EARLIER, still-ambiguous attempt.
    expect(unresolvedOutcomeWarningVisible()).toBe(true);
    expect(container.textContent).toContain("SOME_UNRELATED_VALIDATION_ERROR");
    // Still refreshed on the error response, per Finding 3's own
    // requirement — but that refresh is not what the assertion above
    // relies on; the warning's own visibility is checked independently.
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("the warning survives any number of non-2xx responses", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await fillAndSubmit("5", "restock from supplier");
    expect(unresolvedOutcomeWarningVisible()).toBe(true);

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "FIRST_UNRELATED_ERROR" }),
    });
    await fillAndSubmit("5", "restock from supplier");
    expect(unresolvedOutcomeWarningVisible()).toBe(true);

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: "SECOND_UNRELATED_ERROR" }),
    });
    await fillAndSubmit("5", "restock from supplier");
    expect(unresolvedOutcomeWarningVisible()).toBe(true);
  });

  // Chat 3 Finding 1 (HIGH), round 4 — the decisive regression test.
  // The previous version of this suite asserted the OPPOSITE of this:
  // that a later successful retry cleared the warning. That assumption
  // was unsound — a retry succeeding proves only that the RETRY
  // committed, never that the EARLIER, still-ambiguous request did or
  // did not ALSO commit (both may have, producing a duplicate stock
  // change the admin would otherwise believe was ruled out).
  it("Chat 3 Finding 1 (HIGH): a later independent retry returning 2xx must NOT clear a still-unresolved outcome from an earlier attempt", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await fillAndSubmit("5", "restock from supplier");
    expect(unresolvedOutcomeWarningVisible()).toBe(true);

    // The retry itself succeeds outright...
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await fillAndSubmit("3", "second attempt, unrelated to the ambiguous one");

    // ...but the warning from the EARLIER, still-unidentified attempt
    // must still be visible: this success is not reconciliation.
    expect(unresolvedOutcomeWarningVisible()).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(2);

    // And it survives yet another successful attempt after that, too —
    // this is a one-way latch for the rest of the session, not a
    // one-time grace period.
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await fillAndSubmit("1", "third attempt");
    expect(unresolvedOutcomeWarningVisible()).toBe(true);
  });

  // Requirement 7: normal behavior is preserved when no earlier request
  // ever had an unknown outcome — the warning must never appear out of
  // nowhere on an ordinary, uneventful successful submission.
  it("never shows the warning for an ordinary successful submission when no earlier attempt was ever ambiguous", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await fillAndSubmit("5", "ordinary restock");

    expect(unresolvedOutcomeWarningVisible()).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  // Round 5, the decisive regression test for the Finding itself: a
  // network failure followed by an ORDINARY UNMOUNT/REMOUNT (not a
  // re-render of the same instance) for the SAME product must not lose
  // the ambiguity. Round 4 alone could not catch this, since it never
  // destroyed and recreated the component instance.
  it("Chat 3 Finding (HIGH), round 5: a fetch rejection's warning survives unmounting and remounting the form for the SAME product", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await fillAndSubmit("5", "restock from supplier");
    expect(unresolvedOutcomeWarningVisible()).toBe(true);

    await remount("product-1");

    expect(unresolvedOutcomeWarningVisible()).toBe(true);
  });

  it("Chat 3 Finding (HIGH), round 5: an unresolved outcome for one product never contaminates a different product's form", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await fillAndSubmit("5", "restock from supplier");
    expect(unresolvedOutcomeWarningVisible()).toBe(true);

    // A DIFFERENT product, mounted fresh (as Next.js's own routing
    // would do for a different `[productId]` route segment) — this is
    // not the same product remounting, it's an entirely different one.
    await remount("product-2");

    expect(unresolvedOutcomeWarningVisible()).toBe(false);

    // And switching back to the original product's own form still
    // shows ITS warning — proving the isolation is per-product, not a
    // side effect of simply clearing on any remount.
    await remount("product-1");
    expect(unresolvedOutcomeWarningVisible()).toBe(true);
  });
});
