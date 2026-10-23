/**
 * Chat 3 Finding 3 (MEDIUM), Finding 1 (HIGH, round 4), the round-5
 * remount-persistence Finding (HIGH), and the round-6
 * restoration/storage-failure-safety Finding (HIGH) — regression
 * tests for `AdminInventoryAdjustForm`'s unresolved-outcome warning.
 * Needs a real DOM and `react-dom/client` (jsdom, no `react-server`
 * resolve condition) — matched by `vitest.config.ts`'s "client"
 * project, the same one `cart-context.strict-mode.test.ts` uses, via
 * the `*.client.test.ts` naming added alongside it. Written with
 * `React.createElement` rather than JSX for the same reason that file
 * gives: staying out of the one `.test.tsx` file in the suite.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminInventoryAdjustForm } from "@/modules/admin/components/admin-inventory-adjust-form";
import * as adjustStorage from "@/modules/admin/components/admin-inventory-adjust-storage";

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

  /**
   * Round 6, requirement 5: re-renders the SAME mounted root with a
   * new `productId` prop — a genuinely different scenario from
   * `remount`, which destroys and recreates the instance. This is
   * "Next.js changed the dynamic route segment without a full
   * unmount," which is its own, separate failure mode this round
   * fixes (the synchronous `if (productId !== currentProductId)`
   * reset inside the component, not an effect).
   */
  async function rerenderWithProductId(productId: string) {
    await act(async () => {
      root.render(createElement(AdminInventoryAdjustForm, { productId }));
      await Promise.resolve();
    });
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

  /**
   * Round 6: fills the form and dispatches `submit` synchronously,
   * with no `act` wrapper and no awaited microtask — used ONLY as the
   * synchronous side effect fired FROM WITHIN a mocked
   * `readUnresolvedAdjustmentOutcome` call (see the "before the
   * restoration effect completes" test below) — the earliest possible
   * point `handleSubmit` could ever run relative to the restoration
   * effect, deterministically, regardless of how this test
   * environment happens to schedule passive effects relative to
   * ordinary synchronous test code (empirically, trying to "race" a
   * real mount effect via `act`/`flushSync` timing alone did not work
   * here — this React/jsdom combination flushes the mount effect
   * before either returns, which is WHY this test instead fires the
   * submission from inside the mocked read itself).
   */
  function dispatchSubmitSynchronously(quantity: string, reason: string) {
    const quantityInput = container.querySelector<HTMLInputElement>("#quantity")!;
    const reasonInput = container.querySelector<HTMLInputElement>("#adjustReason")!;
    setNativeValue(quantityInput, quantity);
    setNativeValue(reasonInput, reason);
    const form = container.querySelector("form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
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

  // Round 6, requirement 3 — the decisive regression test for the
  // restoration-window gap. Before this round's fix, `hasUnknownOutcome`
  // started `false` and a submission dispatched in the brief window
  // before the mount effect ran would see that stale `false` and
  // proceed completely unprotected. `restorationState` makes that
  // window explicit, and `handleSubmit` itself (not just the disabled
  // button) now refuses to run while it is `"pending"`.
  it("Chat 3 Finding (HIGH), round 6: a submission attempted before the restoration effect completes sends no request", async () => {
    // Fires a real submission from WITHIN the mocked
    // `readUnresolvedAdjustmentOutcome` call itself — the earliest
    // possible point in the component's whole lifecycle at which
    // `handleSubmit` could ever run relative to the restoration
    // effect: `restorationState` is still its initial `"pending"`
    // here, since the line that would flip it to `"ready"` has not
    // executed yet. This deterministically proves `handleSubmit`'s
    // own guard blocks it, independent of real timing/scheduling (an
    // actual wall-clock race between a real mount effect and a real
    // submission could not be made to reproduce reliably in this
    // React/jsdom test environment — passive effects from an initial
    // mount are flushed eagerly here regardless of `act`/`flushSync`
    // usage, which this test's own history empirically confirmed).
    const readSpy = vi
      .spyOn(adjustStorage, "readUnresolvedAdjustmentOutcome")
      .mockImplementationOnce(() => {
        dispatchSubmitSynchronously("5", "restock from supplier");
        return { status: "absent" };
      });

    await remount("product-1");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("RESTORATION_PENDING");

    readSpy.mockRestore();
  });

  // Round 6, requirement 4 — a storage READ failure must never be
  // represented as "no unresolved outcome." Spies on the real
  // `sessionStorage.getItem` (not a mock of the whole storage module)
  // so this exercises the actual module's own try/catch path end to
  // end, exactly as it would really fail (e.g. a private-browsing
  // restriction throwing on access).
  it("Chat 3 Finding (HIGH), round 6: a storage read failure is treated as unresolved, never as a confirmed clean state", async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => {
      throw new Error("storage access blocked");
    });

    await remount("product-1");

    // Conservative: surfaced exactly like a real, present flag would
    // be — the admin still gets the SAME extra confirmation gate
    // before submitting, never a silent "all clear."
    expect(unresolvedOutcomeWarningVisible()).toBe(true);
    // And the copy is honest that this one was never actually
    // confirmed as persisted (see the component's own `persistenceConfirmed`
    // branch) — distinct wording from a genuinely restored flag.
    expect(container.textContent).toContain("could NOT be");

    getItemSpy.mockRestore();
  });

  // Round 6, requirement 4 — a storage WRITE failure (persisting a
  // brand-new ambiguity) must not crash the form, and the CURRENT
  // mount's warning must still show even though it could not be saved.
  it("Chat 3 Finding (HIGH), round 6: a storage write failure after a fetch rejection keeps the current warning visible and does not crash", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error("quota exceeded");
    });

    fetchMock.mockRejectedValueOnce(new Error("network down"));

    await expect(fillAndSubmit("5", "restock from supplier")).resolves.toBeUndefined();

    expect(unresolvedOutcomeWarningVisible()).toBe(true);
    expect(container.textContent).toContain("could NOT be");

    setItemSpy.mockRestore();
  });

  // Round 6, requirement 5 — `productId` changing on an ALREADY
  // mounted instance (no unmount at all) must not leak product A's
  // warning into product B's rendering of the SAME component.
  it("Chat 3 Finding (HIGH), round 6: changing productId on the same mounted component does not leak product A's warning into product B", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await fillAndSubmit("5", "restock from supplier");
    expect(unresolvedOutcomeWarningVisible()).toBe(true);

    await rerenderWithProductId("product-2");

    expect(unresolvedOutcomeWarningVisible()).toBe(false);
  });

  // Round 6, requirement 5 — the other direction: switching (without
  // unmounting) TO a product that already has its own stored flag
  // must restore that product's own warning correctly.
  it("Chat 3 Finding (HIGH), round 6: changing productId on the same mounted component restores the NEW product's own stored flag", async () => {
    // product-3 already has a real, persisted unresolved outcome from
    // "earlier in this tab" — using the actual production function,
    // not a hand-rolled key, so this doesn't assume the storage
    // module's internal key format.
    adjustStorage.markAdjustmentOutcomeUnresolved("product-3");

    expect(unresolvedOutcomeWarningVisible()).toBe(false); // still showing product-1, clean

    await rerenderWithProductId("product-3");

    expect(unresolvedOutcomeWarningVisible()).toBe(true);
  });
});
