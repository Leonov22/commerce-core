import { describe, expect, it } from "vitest";
import {
  setProductTrackInventory,
  adjustProductStock,
} from "@/modules/catalog/application/admin-inventory-commands";
import type {
  InventoryRepository,
  AdjustStockInput,
  AdjustStockResult,
  SetTrackInventoryInput,
  SetTrackInventoryResult as RepositorySetTrackInventoryResult,
} from "@/modules/catalog/repositories/inventory-repository";
import type { StockAdjustment, ProductAvailability } from "@/modules/catalog/domain/inventory";

/**
 * This fake tracks just enough state (`trackInventory`/`stockQuantity`/
 * `reserved`) to exercise `admin-inventory-commands.ts`'s own
 * orchestration — the real atomicity guarantees (row locking, the sweep
 * before the aggregate, the single-transaction enable-with-initial-
 * quantity write, etc.) are a real-database integration test's job
 * (`prisma-inventory-repository.test.ts`), not this one's. Its
 * `setTrackInventory` still replicates the *shape* of that atomic
 * behavior (computing the delta from current state and applying the
 * same floor checks) purely so this file's tests can assert on
 * `setProductTrackInventory`'s own orchestration of the result, not to
 * re-prove the atomicity itself.
 */
function makeFakeRepository(
  options: {
    product?: { id: string; trackInventory: boolean; stockQuantity: number; reserved: number };
  } = {},
): {
  repository: InventoryRepository;
  adjustStockCalls: AdjustStockInput[];
  setTrackInventoryCalls: SetTrackInventoryInput[];
} {
  const state = options.product ?? {
    id: "product-1",
    trackInventory: false,
    stockQuantity: 0,
    reserved: 0,
  };
  const adjustStockCalls: AdjustStockInput[] = [];
  const setTrackInventoryCalls: SetTrackInventoryInput[] = [];
  let nextAdjustmentId = 1;

  const repository: InventoryRepository = {
    async reserveStock() {
      throw new Error("not used by these tests");
    },
    async consumeReservation() {
      throw new Error("not used by these tests");
    },
    async releaseReservation() {
      throw new Error("not used by these tests");
    },
    async securePaymentWindow() {
      throw new Error("not used by these tests");
    },
    async adjustStock(input: AdjustStockInput): Promise<AdjustStockResult> {
      adjustStockCalls.push(input);
      if (input.productId !== state.id) {
        return { outcome: "productNotFound" };
      }
      if (input.quantityChange === 0) {
        return { outcome: "noOp" };
      }
      const newStockQuantity = state.stockQuantity + input.quantityChange;
      if (newStockQuantity < 0) {
        return { outcome: "wouldGoNegative", currentStockQuantity: state.stockQuantity };
      }
      if (newStockQuantity < state.reserved) {
        return {
          outcome: "belowActiveReservations",
          currentStockQuantity: state.stockQuantity,
          activeReserved: state.reserved,
        };
      }
      state.stockQuantity = newStockQuantity;
      const adjustment: StockAdjustment = {
        id: `adjustment-${nextAdjustmentId++}`,
        productId: input.productId,
        quantityChange: input.quantityChange,
        reason: input.reason,
        adminUserId: input.adminUserId,
        createdAt: new Date(),
      };
      return { outcome: "applied", adjustment, stockQuantity: state.stockQuantity };
    },
    async setTrackInventory(
      input: SetTrackInventoryInput,
    ): Promise<RepositorySetTrackInventoryResult> {
      setTrackInventoryCalls.push(input);
      const { productId, trackInventory, initialQuantity, reason, adminUserId } = input;
      if (productId !== state.id) {
        return { outcome: "productNotFound" };
      }

      if (!trackInventory) {
        if (state.reserved > 0) {
          return { outcome: "activeReservationsExist", reserved: state.reserved };
        }
        state.trackInventory = false;
        return {
          outcome: "updated",
          trackInventory: false,
          stockQuantity: state.stockQuantity,
          adjustment: null,
        };
      }

      if (initialQuantity === undefined) {
        state.trackInventory = true;
        return {
          outcome: "updated",
          trackInventory: true,
          stockQuantity: state.stockQuantity,
          adjustment: null,
        };
      }

      const quantityChange = initialQuantity - state.stockQuantity;
      if (quantityChange === 0) {
        state.trackInventory = true;
        return {
          outcome: "updated",
          trackInventory: true,
          stockQuantity: state.stockQuantity,
          adjustment: null,
        };
      }

      // Finding 1: checked against the REAL `quantityChange` computed
      // just above from this fake's own current state — not whatever
      // the caller assumed — mirroring the real repository's own
      // row-locked re-check.
      if (!reason || reason.trim().length === 0) {
        return { outcome: "reasonRequired" };
      }

      const newStockQuantity = state.stockQuantity + quantityChange;
      if (newStockQuantity < 0) {
        return { outcome: "wouldGoNegative", currentStockQuantity: state.stockQuantity };
      }
      if (newStockQuantity < state.reserved) {
        return {
          outcome: "belowActiveReservations",
          currentStockQuantity: state.stockQuantity,
          activeReserved: state.reserved,
        };
      }

      state.trackInventory = true;
      state.stockQuantity = newStockQuantity;
      const adjustment: StockAdjustment = {
        id: `adjustment-${nextAdjustmentId++}`,
        productId,
        quantityChange,
        reason: reason ?? "",
        adminUserId: adminUserId ?? null,
        createdAt: new Date(),
      };
      return {
        outcome: "updated",
        trackInventory: true,
        stockQuantity: newStockQuantity,
        adjustment,
      };
    },
    async recordInventoryException() {
      throw new Error("not used by these tests");
    },
    async getProductAvailability(productId: string): Promise<ProductAvailability | null> {
      if (productId !== state.id) {
        return null;
      }
      return {
        productId: state.id,
        trackInventory: state.trackInventory,
        stockQuantity: state.stockQuantity,
        reserved: state.reserved,
        available: state.trackInventory ? state.stockQuantity - state.reserved : null,
      };
    },
    async getProductsAvailability() {
      throw new Error("not used by these tests");
    },
    async listLowStockProducts() {
      throw new Error("not used by these tests");
    },
    async listStockAdjustments() {
      throw new Error("not used by these tests");
    },
  };

  return { repository, adjustStockCalls, setTrackInventoryCalls };
}

describe("setProductTrackInventory", () => {
  it("rejects a non-boolean trackInventory flag before touching the repository", async () => {
    const { repository } = makeFakeRepository();
    const result = await setProductTrackInventory(repository, "product-1", {}, "admin-1");
    expect(result).toEqual({ outcome: "invalidInput", error: "INVALID_TRACK_INVENTORY_FLAG" });
  });

  it("returns productNotFound for a nonexistent product", async () => {
    const { repository } = makeFakeRepository();
    const result = await setProductTrackInventory(
      repository,
      "does-not-exist",
      { trackInventory: true },
      "admin-1",
    );
    expect(result).toEqual({ outcome: "productNotFound" });
  });

  it("enables tracking with no initial quantity, leaving stockQuantity untouched and recording no adjustment", async () => {
    const { repository, adjustStockCalls } = makeFakeRepository({
      product: { id: "product-1", trackInventory: false, stockQuantity: 5, reserved: 0 },
    });
    const result = await setProductTrackInventory(
      repository,
      "product-1",
      { trackInventory: true },
      "admin-1",
    );
    expect(result).toEqual({ outcome: "enabled", stockQuantity: 5, adjustment: null });
    expect(adjustStockCalls).toHaveLength(0);
  });

  it("enables tracking with an initial quantity, applying the difference atomically via one setTrackInventory call with the given reason", async () => {
    const { repository, adjustStockCalls, setTrackInventoryCalls } = makeFakeRepository({
      product: { id: "product-1", trackInventory: false, stockQuantity: 0, reserved: 0 },
    });
    const result = await setProductTrackInventory(
      repository,
      "product-1",
      { trackInventory: true, initialQuantity: 20, reason: "Initial stock count" },
      "admin-1",
    );
    expect(result.outcome).toBe("enabled");
    if (result.outcome === "enabled") {
      expect(result.stockQuantity).toBe(20);
      expect(result.adjustment?.quantityChange).toBe(20);
    }
    // The fix: no separate adjustStock call at all — everything goes
    // through exactly one setTrackInventory call.
    expect(adjustStockCalls).toHaveLength(0);
    expect(setTrackInventoryCalls).toEqual([
      {
        productId: "product-1",
        trackInventory: true,
        initialQuantity: 20,
        reason: "Initial stock count",
        adminUserId: "admin-1",
      },
    ]);
  });

  it("requires a reason when the initial quantity actually changes the on-hand count", async () => {
    const { repository, adjustStockCalls, setTrackInventoryCalls } = makeFakeRepository({
      product: { id: "product-1", trackInventory: false, stockQuantity: 0, reserved: 0 },
    });
    const result = await setProductTrackInventory(
      repository,
      "product-1",
      { trackInventory: true, initialQuantity: 20 },
      "admin-1",
    );
    expect(result).toEqual({
      outcome: "invalidInput",
      error: "MISSING_REASON_FOR_INITIAL_QUANTITY",
    });
    expect(adjustStockCalls).toHaveLength(0);
    // Rejected before the repository is ever called.
    expect(setTrackInventoryCalls).toHaveLength(0);
  });

  it("does not require a reason when the initial quantity equals the current on-hand count", async () => {
    const { repository, adjustStockCalls, setTrackInventoryCalls } = makeFakeRepository({
      product: { id: "product-1", trackInventory: false, stockQuantity: 5, reserved: 0 },
    });
    const result = await setProductTrackInventory(
      repository,
      "product-1",
      { trackInventory: true, initialQuantity: 5 },
      "admin-1",
    );
    expect(result).toEqual({ outcome: "enabled", stockQuantity: 5, adjustment: null });
    expect(adjustStockCalls).toHaveLength(0);
    expect(setTrackInventoryCalls).toEqual([
      {
        productId: "product-1",
        trackInventory: true,
        initialQuantity: 5,
        reason: undefined,
        adminUserId: "admin-1",
      },
    ]);
  });

  it("rejects a negative or non-integer initial quantity", async () => {
    const { repository } = makeFakeRepository({
      product: { id: "product-1", trackInventory: false, stockQuantity: 0, reserved: 0 },
    });
    const result = await setProductTrackInventory(
      repository,
      "product-1",
      { trackInventory: true, initialQuantity: -1 },
      "admin-1",
    );
    expect(result).toEqual({ outcome: "invalidInput", error: "INVALID_INITIAL_QUANTITY" });
  });

  it("Chat 3 Finding 6 (LOW): rejects an initial quantity outside the Postgres integer range", async () => {
    const { repository } = makeFakeRepository({
      product: { id: "product-1", trackInventory: false, stockQuantity: 0, reserved: 0 },
    });
    const result = await setProductTrackInventory(
      repository,
      "product-1",
      { trackInventory: true, initialQuantity: 2147483648 }, // one past int4 max
      "admin-1",
    );
    expect(result).toEqual({ outcome: "invalidInput", error: "INITIAL_QUANTITY_OUT_OF_RANGE" });
  });

  it("Chat 3 Finding 6 (LOW): rejects an initial quantity that is not a safe integer", async () => {
    const { repository } = makeFakeRepository({
      product: { id: "product-1", trackInventory: false, stockQuantity: 0, reserved: 0 },
    });
    const result = await setProductTrackInventory(
      repository,
      "product-1",
      { trackInventory: true, initialQuantity: Number.MAX_SAFE_INTEGER + 10 },
      "admin-1",
    );
    expect(result).toEqual({ outcome: "invalidInput", error: "INITIAL_QUANTITY_OUT_OF_RANGE" });
  });

  it("refuses to enable a product that is already tracked", async () => {
    const { repository } = makeFakeRepository({
      product: { id: "product-1", trackInventory: true, stockQuantity: 5, reserved: 0 },
    });
    const result = await setProductTrackInventory(
      repository,
      "product-1",
      { trackInventory: true },
      "admin-1",
    );
    expect(result).toEqual({ outcome: "alreadyEnabled" });
  });

  it("Chat 3 Finding 1 (HIGH): maps the repository's own reasonRequired outcome to the same invalidInput error, when a concurrent write makes this function's own pre-check stale", async () => {
    const { repository } = makeFakeRepository({
      product: { id: "product-1", trackInventory: false, stockQuantity: 15, reserved: 0 },
    });
    // This function's own pre-check calls `getProductAvailability`
    // first and decides, from THAT read, whether a reason is required.
    // Here it is handed a deliberately stale snapshot (`stockQuantity:
    // 10`) while the repository's real, authoritative state is 15 —
    // simulating a concurrent write landing between the pre-check and
    // the actual `setTrackInventory` call. `initialQuantity: 10`
    // therefore looks like a zero delta to the stale pre-check (no
    // reason required) but is a real delta of -5 once the repository
    // re-derives it from its own state.
    const staleRepository: InventoryRepository = {
      ...repository,
      async getProductAvailability(productId) {
        const real = await repository.getProductAvailability(productId);
        return real ? { ...real, stockQuantity: 10 } : real;
      },
    };

    const result = await setProductTrackInventory(
      staleRepository,
      "product-1",
      { trackInventory: true, initialQuantity: 10 },
      "admin-1",
    );

    expect(result).toEqual({
      outcome: "invalidInput",
      error: "MISSING_REASON_FOR_INITIAL_QUANTITY",
    });
  });

  it("disables tracking for a tracked product with no active reservations", async () => {
    const { repository } = makeFakeRepository({
      product: { id: "product-1", trackInventory: true, stockQuantity: 5, reserved: 0 },
    });
    const result = await setProductTrackInventory(
      repository,
      "product-1",
      { trackInventory: false },
      "admin-1",
    );
    expect(result).toEqual({ outcome: "disabled" });
  });

  it("refuses to disable tracking while active reservations exist", async () => {
    const { repository } = makeFakeRepository({
      product: { id: "product-1", trackInventory: true, stockQuantity: 5, reserved: 2 },
    });
    const result = await setProductTrackInventory(
      repository,
      "product-1",
      { trackInventory: false },
      "admin-1",
    );
    expect(result).toEqual({ outcome: "activeReservationsExist", reserved: 2 });
  });

  it("reports alreadyDisabled for a product that is already untracked", async () => {
    const { repository } = makeFakeRepository({
      product: { id: "product-1", trackInventory: false, stockQuantity: 0, reserved: 0 },
    });
    const result = await setProductTrackInventory(
      repository,
      "product-1",
      { trackInventory: false },
      "admin-1",
    );
    expect(result).toEqual({ outcome: "alreadyDisabled" });
  });
});

describe("adjustProductStock", () => {
  it("rejects a missing/empty productId", async () => {
    const { repository } = makeFakeRepository();
    const result = await adjustProductStock(
      repository,
      { quantityChange: 1, reason: "test" },
      "admin-1",
    );
    expect(result).toEqual({ ok: false, error: "INVALID_PRODUCT" });
  });

  it("rejects a zero quantity change", async () => {
    const { repository } = makeFakeRepository();
    const result = await adjustProductStock(
      repository,
      { productId: "product-1", quantityChange: 0, reason: "test" },
      "admin-1",
    );
    expect(result).toEqual({ ok: false, error: "INVALID_QUANTITY_CHANGE" });
  });

  it("rejects a non-integer quantity change", async () => {
    const { repository } = makeFakeRepository();
    const result = await adjustProductStock(
      repository,
      { productId: "product-1", quantityChange: 1.5, reason: "test" },
      "admin-1",
    );
    expect(result).toEqual({ ok: false, error: "INVALID_QUANTITY_CHANGE" });
  });

  it("Chat 3 Finding 6 (LOW): rejects a quantity change outside the Postgres integer range", async () => {
    const { repository } = makeFakeRepository();
    const result = await adjustProductStock(
      repository,
      { productId: "product-1", quantityChange: -2147483649, reason: "test" }, // one past int4 min
      "admin-1",
    );
    expect(result).toEqual({ ok: false, error: "QUANTITY_CHANGE_OUT_OF_RANGE" });
  });

  it("Chat 3 Finding 6 (LOW): rejects when the resulting stock quantity would exceed the Postgres integer range", async () => {
    const { repository } = makeFakeRepository({
      product: { id: "product-1", trackInventory: true, stockQuantity: 2147483640, reserved: 0 },
    });
    const result = await adjustProductStock(
      repository,
      { productId: "product-1", quantityChange: 100, reason: "test" }, // 2147483640 + 100 > int4 max
      "admin-1",
    );
    expect(result).toEqual({ ok: false, error: "RESULTING_STOCK_QUANTITY_OUT_OF_RANGE" });
  });

  it("Chat 3 Finding 6 (LOW): skips the resulting-quantity check for a nonexistent product, letting the repository's own productNotFound surface unchanged", async () => {
    const { repository } = makeFakeRepository();
    const result = await adjustProductStock(
      repository,
      { productId: "does-not-exist", quantityChange: 5, reason: "test" },
      "admin-1",
    );
    expect(result).toEqual({ ok: true, result: { outcome: "productNotFound" } });
  });

  it("requires a non-empty reason", async () => {
    const { repository } = makeFakeRepository();
    const result = await adjustProductStock(
      repository,
      { productId: "product-1", quantityChange: 1, reason: "   " },
      "admin-1",
    );
    expect(result).toEqual({ ok: false, error: "MISSING_REASON" });
  });

  it("delegates a valid increase to InventoryRepository.adjustStock verbatim", async () => {
    const { repository, adjustStockCalls } = makeFakeRepository({
      product: { id: "product-1", trackInventory: true, stockQuantity: 10, reserved: 0 },
    });
    const result = await adjustProductStock(
      repository,
      { productId: "product-1", quantityChange: 5, reason: "Restock" },
      "admin-1",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toEqual({
        outcome: "applied",
        adjustment: expect.objectContaining({ quantityChange: 5, reason: "Restock" }),
        stockQuantity: 15,
      });
    }
    expect(adjustStockCalls).toEqual([
      { productId: "product-1", quantityChange: 5, reason: "Restock", adminUserId: "admin-1" },
    ]);
  });

  it("surfaces belowActiveReservations from the repository without reinterpreting it", async () => {
    const { repository } = makeFakeRepository({
      product: { id: "product-1", trackInventory: true, stockQuantity: 10, reserved: 8 },
    });
    const result = await adjustProductStock(
      repository,
      { productId: "product-1", quantityChange: -5, reason: "Correction" },
      "admin-1",
    );
    expect(result).toEqual({
      ok: true,
      result: { outcome: "belowActiveReservations", currentStockQuantity: 10, activeReserved: 8 },
    });
  });

  it("surfaces productNotFound for a nonexistent product", async () => {
    const { repository } = makeFakeRepository();
    const result = await adjustProductStock(
      repository,
      { productId: "does-not-exist", quantityChange: 5, reason: "test" },
      "admin-1",
    );
    expect(result).toEqual({ ok: true, result: { outcome: "productNotFound" } });
  });

  it("trims the reason and passes a null adminUserId through as-is", async () => {
    const { repository, adjustStockCalls } = makeFakeRepository({
      product: { id: "product-1", trackInventory: true, stockQuantity: 10, reserved: 0 },
    });
    await adjustProductStock(
      repository,
      { productId: "product-1", quantityChange: 1, reason: "  padded  " },
      null,
    );
    expect(adjustStockCalls).toEqual([
      { productId: "product-1", quantityChange: 1, reason: "padded", adminUserId: null },
    ]);
  });
});
