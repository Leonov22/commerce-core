import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prismaInventoryRepository } from "@/modules/catalog/infrastructure/prisma-inventory-repository";
import { prisma } from "@/modules/catalog/infrastructure/prisma-client";

/**
 * Integration tests against the real Postgres database — concurrency
 * guarantees (no overselling, no deadlock, no revived terminal
 * reservations) cannot be proven against a fake repository, since a fake
 * never runs two calls on separate connections racing against the same
 * rows. See `prisma-inventory-repository.ts`'s own doc comment for the
 * locking protocol these tests are proving.
 */
describe("prismaInventoryRepository", () => {
  const createdProductIds: string[] = [];

  afterAll(async () => {
    if (createdProductIds.length > 0) {
      // Children first — all three FKs are `ON DELETE RESTRICT`.
      await prisma.inventoryException.deleteMany({
        where: { productId: { in: createdProductIds } },
      });
      await prisma.stockAdjustment.deleteMany({ where: { productId: { in: createdProductIds } } });
      await prisma.stockReservation.deleteMany({ where: { productId: { in: createdProductIds } } });
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    }
    await prisma.$disconnect();
  });

  async function createTestProduct(
    options: { trackInventory?: boolean; stockQuantity?: number } = {},
  ) {
    const category = await prisma.category.findFirstOrThrow();
    const product = await prisma.product.create({
      data: {
        slug: `test-inventory-product-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        status: "DRAFT",
        priceAmountMinor: 1000,
        currency: "USD",
        categoryId: category.id,
        trackInventory: options.trackInventory ?? true,
        stockQuantity: options.stockQuantity ?? 0,
        translations: {
          create: {
            locale: "en",
            name: "Inventory Test Product",
            meta: "test",
            description: "test",
            material: "test",
            dimensions: "test",
          },
        },
      },
    });
    createdProductIds.push(product.id);
    return product;
  }

  function testOrderId() {
    return `test-order-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  describe("reserveStock — concurrent overselling protection", () => {
    it("of two genuinely concurrent reservations for the last available unit, exactly one succeeds", async () => {
      const product = await createTestProduct({ stockQuantity: 1 });
      const orderA = testOrderId();
      const orderB = testOrderId();
      const expiresAt = new Date(Date.now() + 60_000);

      const [first, second] = await Promise.all([
        prismaInventoryRepository.reserveStock({
          orderId: orderA,
          productId: product.id,
          quantity: 1,
          expiresAt,
        }),
        prismaInventoryRepository.reserveStock({
          orderId: orderB,
          productId: product.id,
          quantity: 1,
          expiresAt,
        }),
      ]);

      const outcomes = [first.outcome, second.outcome].sort();
      expect(outcomes).toEqual(["insufficientStock", "reserved"]);

      const activeCount = await prisma.stockReservation.count({
        where: { productId: product.id, status: "ACTIVE" },
      });
      expect(activeCount).toBe(1);
    });

    it("rejects a reservation that would exceed on-hand minus already-active reservations", async () => {
      const product = await createTestProduct({ stockQuantity: 2 });
      await prismaInventoryRepository.reserveStock({
        orderId: testOrderId(),
        productId: product.id,
        quantity: 2,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await prismaInventoryRepository.reserveStock({
        orderId: testOrderId(),
        productId: product.id,
        quantity: 1,
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(result).toEqual({ outcome: "insufficientStock", available: 0 });
    });

    it("returns productNotFound for a nonexistent product", async () => {
      const result = await prismaInventoryRepository.reserveStock({
        orderId: testOrderId(),
        productId: "does-not-exist",
        quantity: 1,
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(result).toEqual({ outcome: "productNotFound" });
    });
  });

  describe("reserveStock — idempotency and terminal-state permanence", () => {
    it("a duplicate call for the same (orderId, productId) while still ACTIVE returns the same reservation, never a second row", async () => {
      const product = await createTestProduct({ stockQuantity: 5 });
      const orderId = testOrderId();
      const first = await prismaInventoryRepository.reserveStock({
        orderId,
        productId: product.id,
        quantity: 2,
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(first.outcome).toBe("reserved");

      const second = await prismaInventoryRepository.reserveStock({
        orderId,
        productId: product.id,
        quantity: 2,
        expiresAt: new Date(Date.now() + 120_000),
      });
      expect(second.outcome).toBe("alreadyReserved");
      if (second.outcome === "alreadyReserved" && first.outcome === "reserved") {
        expect(second.reservation.id).toBe(first.reservation.id);
      }

      const count = await prisma.stockReservation.count({
        where: { orderId, productId: product.id },
      });
      expect(count).toBe(1);
    });

    it("never revives a reservation that already reached a terminal state", async () => {
      const product = await createTestProduct({ stockQuantity: 5 });
      const orderId = testOrderId();
      const original = await prisma.stockReservation.create({
        data: {
          orderId,
          productId: product.id,
          quantity: 1,
          status: "RELEASED",
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      const result = await prismaInventoryRepository.reserveStock({
        orderId,
        productId: product.id,
        quantity: 1,
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(result.outcome).toBe("alreadyFinal");
      if (result.outcome === "alreadyFinal") {
        expect(result.reservation.id).toBe(original.id);
        expect(result.reservation.status).toBe("RELEASED");
      }

      const count = await prisma.stockReservation.count({
        where: { orderId, productId: product.id },
      });
      expect(count).toBe(1);
    });

    it("CR-4: never treats an ACTIVE reservation whose expiresAt is already in the past as a valid successful reservation, whether or not a sweep already ran", async () => {
      const product = await createTestProduct({ stockQuantity: 5 });
      const orderId = testOrderId();
      const stale = await prisma.stockReservation.create({
        data: {
          orderId,
          productId: product.id,
          quantity: 1,
          status: "ACTIVE",
          // Still literally ACTIVE in the database, but its wall-clock
          // expiry has already passed — simulates nothing having swept
          // it yet.
          expiresAt: new Date(Date.now() - 60_000),
        },
      });

      const result = await prismaInventoryRepository.reserveStock({
        orderId,
        productId: product.id,
        quantity: 1,
        expiresAt: new Date(Date.now() + 60_000),
      });
      // Deterministic: never "alreadyReserved" for an expired row, and
      // never a second row — the pair becomes permanently terminal here.
      expect(result.outcome).toBe("alreadyFinal");
      if (result.outcome === "alreadyFinal") {
        expect(result.reservation.id).toBe(stale.id);
        expect(result.reservation.status).toBe("EXPIRED");
      }

      const persisted = await prisma.stockReservation.findUniqueOrThrow({
        where: { id: stale.id },
      });
      expect(persisted.status).toBe("EXPIRED");

      const count = await prisma.stockReservation.count({
        where: { orderId, productId: product.id },
      });
      expect(count).toBe(1);
    });
  });

  describe("reserveStock — untracked product compatibility", () => {
    it("creates no reservation row for a product that does not track inventory", async () => {
      const product = await createTestProduct({ trackInventory: false, stockQuantity: 0 });
      const orderId = testOrderId();

      const result = await prismaInventoryRepository.reserveStock({
        orderId,
        productId: product.id,
        quantity: 100,
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(result).toEqual({ outcome: "notTracked" });

      const count = await prisma.stockReservation.count({
        where: { orderId, productId: product.id },
      });
      expect(count).toBe(0);
    });
  });

  describe("consumeReservation", () => {
    it("atomically transitions ACTIVE to CONSUMED and decrements on-hand stock", async () => {
      const product = await createTestProduct({ stockQuantity: 5 });
      const orderId = testOrderId();
      await prismaInventoryRepository.reserveStock({
        orderId,
        productId: product.id,
        quantity: 2,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await prismaInventoryRepository.consumeReservation(orderId, product.id);
      expect(result.outcome).toBe("consumed");

      const updatedProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(updatedProduct.stockQuantity).toBe(3);

      const reservation = await prisma.stockReservation.findUniqueOrThrow({
        where: { orderId_productId: { orderId, productId: product.id } },
      });
      expect(reservation.status).toBe("CONSUMED");
    });

    it("is idempotent — consuming an already-CONSUMED reservation reports alreadyConsumed without decrementing stock twice", async () => {
      const product = await createTestProduct({ stockQuantity: 5 });
      const orderId = testOrderId();
      await prismaInventoryRepository.reserveStock({
        orderId,
        productId: product.id,
        quantity: 2,
        expiresAt: new Date(Date.now() + 60_000),
      });
      await prismaInventoryRepository.consumeReservation(orderId, product.id);

      const second = await prismaInventoryRepository.consumeReservation(orderId, product.id);
      expect(second.outcome).toBe("alreadyConsumed");

      const updatedProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(updatedProduct.stockQuantity).toBe(3);
    });

    it("returns notFound for a (orderId, productId) pair with no reservation", async () => {
      const product = await createTestProduct({ stockQuantity: 5 });
      const result = await prismaInventoryRepository.consumeReservation(testOrderId(), product.id);
      expect(result).toEqual({ outcome: "notFound" });
    });
  });

  describe("expiration versus consumption race", () => {
    it("a reservation past its expiresAt can never be consumed, and its stock becomes available to a concurrently reserving order — regardless of interleaving", async () => {
      const product = await createTestProduct({ stockQuantity: 1 });
      const staleOrderId = testOrderId();
      await prisma.stockReservation.create({
        data: {
          orderId: staleOrderId,
          productId: product.id,
          quantity: 1,
          status: "ACTIVE",
          // Already in the past — simulates a reservation whose TTL
          // elapsed before anything swept it.
          expiresAt: new Date(Date.now() - 60_000),
        },
      });

      const newOrderId = testOrderId();
      const [consumeResult, reserveResult] = await Promise.all([
        prismaInventoryRepository.consumeReservation(staleOrderId, product.id),
        prismaInventoryRepository.reserveStock({
          orderId: newOrderId,
          productId: product.id,
          quantity: 1,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ]);

      // Deterministic regardless of which ran first: consumption fails
      // closed purely on wall-clock time (its own WHERE clause), and the
      // new order successfully reclaims the freed stock.
      expect(consumeResult.outcome).toBe("notConsumable");
      expect(reserveResult.outcome).toBe("reserved");

      const staleReservation = await prisma.stockReservation.findUniqueOrThrow({
        where: { orderId_productId: { orderId: staleOrderId, productId: product.id } },
      });
      expect(staleReservation.status).not.toBe("CONSUMED");

      const finalProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      // Consumption never happened, so on-hand stock is untouched.
      expect(finalProduct.stockQuantity).toBe(1);
    });
  });

  describe("releaseReservation", () => {
    it("transitions ACTIVE to RELEASED without touching product stock", async () => {
      const product = await createTestProduct({ stockQuantity: 5 });
      const orderId = testOrderId();
      await prismaInventoryRepository.reserveStock({
        orderId,
        productId: product.id,
        quantity: 2,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await prismaInventoryRepository.releaseReservation(orderId, product.id);
      expect(result.outcome).toBe("released");

      const updatedProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(updatedProduct.stockQuantity).toBe(5);
    });

    it("is idempotent — releasing an already-RELEASED reservation reports alreadyReleased", async () => {
      const product = await createTestProduct({ stockQuantity: 5 });
      const orderId = testOrderId();
      await prismaInventoryRepository.reserveStock({
        orderId,
        productId: product.id,
        quantity: 1,
        expiresAt: new Date(Date.now() + 60_000),
      });
      await prismaInventoryRepository.releaseReservation(orderId, product.id);

      const second = await prismaInventoryRepository.releaseReservation(orderId, product.id);
      expect(second.outcome).toBe("alreadyReleased");
    });

    it("refuses to release an already-CONSUMED reservation", async () => {
      const product = await createTestProduct({ stockQuantity: 5 });
      const orderId = testOrderId();
      await prismaInventoryRepository.reserveStock({
        orderId,
        productId: product.id,
        quantity: 1,
        expiresAt: new Date(Date.now() + 60_000),
      });
      await prismaInventoryRepository.consumeReservation(orderId, product.id);

      const result = await prismaInventoryRepository.releaseReservation(orderId, product.id);
      expect(result.outcome).toBe("notReleasable");
    });
  });

  describe("securePaymentWindow", () => {
    it("extends the TTL of every required, currently-ACTIVE tracked item", async () => {
      const product = await createTestProduct({ stockQuantity: 5 });
      const orderId = testOrderId();
      await prismaInventoryRepository.reserveStock({
        orderId,
        productId: product.id,
        quantity: 1,
        expiresAt: new Date(Date.now() + 1_000),
      });

      const newExpiresAt = new Date(Date.now() + 900_000);
      const result = await prismaInventoryRepository.securePaymentWindow(
        orderId,
        [{ productId: product.id, quantity: 1 }],
        newExpiresAt,
      );
      expect(result).toEqual({ ok: true });

      const reservation = await prisma.stockReservation.findUniqueOrThrow({
        where: { orderId_productId: { orderId, productId: product.id } },
      });
      expect(reservation.expiresAt.getTime()).toBe(newExpiresAt.getTime());
    });

    it("rejects when a required tracked item's reservation is missing", async () => {
      const product = await createTestProduct({ stockQuantity: 5 });
      const orderId = testOrderId();

      const result = await prismaInventoryRepository.securePaymentWindow(
        orderId,
        [{ productId: product.id, quantity: 1 }],
        new Date(Date.now() + 900_000),
      );
      expect(result).toEqual({
        ok: false,
        failures: [{ productId: product.id, reason: "reservationMissing" }],
      });
    });

    it("rejects when a required tracked item's reservation already reached a terminal state", async () => {
      const product = await createTestProduct({ stockQuantity: 5 });
      const orderId = testOrderId();
      await prismaInventoryRepository.reserveStock({
        orderId,
        productId: product.id,
        quantity: 1,
        expiresAt: new Date(Date.now() + 60_000),
      });
      await prismaInventoryRepository.releaseReservation(orderId, product.id);

      const result = await prismaInventoryRepository.securePaymentWindow(
        orderId,
        [{ productId: product.id, quantity: 1 }],
        new Date(Date.now() + 900_000),
      );
      expect(result).toEqual({
        ok: false,
        failures: [{ productId: product.id, reason: "reservationNotActive" }],
      });
    });

    it("is all-or-nothing: one missing item rolls back the extension already applied to a valid sibling item", async () => {
      const validProduct = await createTestProduct({ stockQuantity: 5 });
      const missingProduct = await createTestProduct({ stockQuantity: 5 });
      const orderId = testOrderId();
      const originalExpiresAt = new Date(Date.now() + 1_000);
      await prismaInventoryRepository.reserveStock({
        orderId,
        productId: validProduct.id,
        quantity: 1,
        expiresAt: originalExpiresAt,
      });
      // No reservation created for `missingProduct` — deliberately missing.

      const result = await prismaInventoryRepository.securePaymentWindow(
        orderId,
        [
          { productId: validProduct.id, quantity: 1 },
          { productId: missingProduct.id, quantity: 1 },
        ],
        new Date(Date.now() + 900_000),
      );
      expect(result.ok).toBe(false);

      const untouched = await prisma.stockReservation.findUniqueOrThrow({
        where: { orderId_productId: { orderId, productId: validProduct.id } },
      });
      // The valid sibling's extension must have been rolled back along
      // with the failure, not left applied.
      expect(untouched.expiresAt.getTime()).toBe(originalExpiresAt.getTime());
    });

    it("trivially succeeds for an untracked required item with no reservation at all", async () => {
      const product = await createTestProduct({ trackInventory: false, stockQuantity: 0 });
      const result = await prismaInventoryRepository.securePaymentWindow(
        testOrderId(),
        [{ productId: product.id, quantity: 1 }],
        new Date(Date.now() + 900_000),
      );
      expect(result).toEqual({ ok: true });
    });
  });

  describe("adjustStock", () => {
    it("applies a positive adjustment and records an append-only audit row", async () => {
      const product = await createTestProduct({ stockQuantity: 10 });
      const result = await prismaInventoryRepository.adjustStock({
        productId: product.id,
        quantityChange: 5,
        reason: "restock",
        adminUserId: "admin-1",
      });
      expect(result).toEqual(expect.objectContaining({ outcome: "applied", stockQuantity: 15 }));

      const audits = await prisma.stockAdjustment.findMany({ where: { productId: product.id } });
      expect(audits).toHaveLength(1);
      expect(audits[0]?.quantityChange).toBe(5);
    });

    it("refuses an adjustment that would take stock negative", async () => {
      const product = await createTestProduct({ stockQuantity: 2 });
      const result = await prismaInventoryRepository.adjustStock({
        productId: product.id,
        quantityChange: -5,
        reason: "correction",
        adminUserId: "admin-1",
      });
      expect(result).toEqual({ outcome: "wouldGoNegative", currentStockQuantity: 2 });

      const updatedProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(updatedProduct.stockQuantity).toBe(2);
    });

    it("refuses an adjustment that would drop stock below currently active reservations", async () => {
      const product = await createTestProduct({ stockQuantity: 5 });
      await prismaInventoryRepository.reserveStock({
        orderId: testOrderId(),
        productId: product.id,
        quantity: 3,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await prismaInventoryRepository.adjustStock({
        productId: product.id,
        quantityChange: -3,
        reason: "correction",
        adminUserId: "admin-1",
      });
      expect(result).toEqual({
        outcome: "belowActiveReservations",
        currentStockQuantity: 5,
        activeReserved: 3,
      });

      const updatedProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(updatedProduct.stockQuantity).toBe(5);
    });

    it("rejects a zero-quantity change as a no-op before reaching the database", async () => {
      const product = await createTestProduct({ stockQuantity: 5 });
      const result = await prismaInventoryRepository.adjustStock({
        productId: product.id,
        quantityChange: 0,
        reason: "noop",
        adminUserId: null,
      });
      expect(result).toEqual({ outcome: "noOp" });

      const audits = await prisma.stockAdjustment.count({ where: { productId: product.id } });
      expect(audits).toBe(0);
    });

    it("returns productNotFound for a nonexistent product", async () => {
      const result = await prismaInventoryRepository.adjustStock({
        productId: "does-not-exist",
        quantityChange: 5,
        reason: "restock",
        adminUserId: null,
      });
      expect(result).toEqual({ outcome: "productNotFound" });
    });
  });

  describe("adjustStock versus reserveStock — concurrent product-row lock", () => {
    it("never allows the final stock to drop below the final active-reservation total, whichever operation the lock admits first", async () => {
      const product = await createTestProduct({ stockQuantity: 5 });
      const orderId = testOrderId();

      const [reserveResult, adjustResult] = await Promise.all([
        prismaInventoryRepository.reserveStock({
          orderId,
          productId: product.id,
          quantity: 3,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        prismaInventoryRepository.adjustStock({
          productId: product.id,
          quantityChange: -4,
          reason: "concurrent correction",
          adminUserId: "admin-1",
        }),
      ]);

      // Exactly one of the two valid, lock-ordering-dependent outcomes —
      // whichever operation the product-row lock admits first commits,
      // and the other then sees that committed state and is correctly
      // refused. Never both succeeding (which would oversell: 5 on-hand,
      // -4 adjustment, +3 reservation would net -2) and never both
      // failing (the lock guarantees whichever goes first makes
      // progress).
      const reserveWonTheRace =
        reserveResult.outcome === "reserved" && adjustResult.outcome === "belowActiveReservations";
      const adjustWonTheRace =
        adjustResult.outcome === "applied" && reserveResult.outcome === "insufficientStock";
      expect(reserveWonTheRace || adjustWonTheRace).toBe(true);

      const finalProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      const activeReserved = await prisma.stockReservation.aggregate({
        where: { productId: product.id, status: "ACTIVE" },
        _sum: { quantity: true },
      });
      expect(finalProduct.stockQuantity).toBeGreaterThanOrEqual(activeReserved._sum.quantity ?? 0);
    });
  });

  describe("recordInventoryException", () => {
    it("creates an exception and is idempotent on reservationId", async () => {
      const product = await createTestProduct({ stockQuantity: 5 });
      const orderId = testOrderId();
      const reserved = await prismaInventoryRepository.reserveStock({
        orderId,
        productId: product.id,
        quantity: 1,
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(reserved.outcome).toBe("reserved");
      if (reserved.outcome !== "reserved") return;

      const input = {
        reservationId: reserved.reservation.id,
        orderId,
        productId: product.id,
        quantity: 1,
        paymentId: "pay_123",
        reason: "reservation expired before webhook arrived",
      };
      const first = await prismaInventoryRepository.recordInventoryException(input);
      expect(first.outcome).toBe("created");

      const second = await prismaInventoryRepository.recordInventoryException(input);
      expect(second.outcome).toBe("alreadyExists");
      expect(second.exception.id).toBe(first.exception.id);

      const count = await prisma.inventoryException.count({
        where: { reservationId: reserved.reservation.id },
      });
      expect(count).toBe(1);
    });
  });

  describe("getProductAvailability", () => {
    it("computes available as on-hand minus active reservations for a tracked product", async () => {
      const product = await createTestProduct({ stockQuantity: 10 });
      await prismaInventoryRepository.reserveStock({
        orderId: testOrderId(),
        productId: product.id,
        quantity: 4,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const availability = await prismaInventoryRepository.getProductAvailability(product.id);
      expect(availability).toEqual({
        productId: product.id,
        trackInventory: true,
        stockQuantity: 10,
        reserved: 4,
        available: 6,
      });
    });

    it("returns a null available for an untracked product, never a numeric capacity", async () => {
      const product = await createTestProduct({ trackInventory: false, stockQuantity: 0 });
      const availability = await prismaInventoryRepository.getProductAvailability(product.id);
      expect(availability).toEqual({
        productId: product.id,
        trackInventory: false,
        stockQuantity: 0,
        reserved: 0,
        available: null,
      });
    });

    it("returns null for a nonexistent product", async () => {
      const availability = await prismaInventoryRepository.getProductAvailability("does-not-exist");
      expect(availability).toBeNull();
    });
  });

  describe("listLowStockProducts", () => {
    it("returns only tracked products at or below the threshold, ascending by available", async () => {
      const low = await createTestProduct({ stockQuantity: 2 });
      const high = await createTestProduct({ stockQuantity: 50 });
      const untracked = await createTestProduct({ trackInventory: false, stockQuantity: 0 });

      const results = await prismaInventoryRepository.listLowStockProducts(5);
      const ids = results.map((item) => item.productId);
      expect(ids).toContain(low.id);
      expect(ids).not.toContain(high.id);
      expect(ids).not.toContain(untracked.id);
    });
  });
});
