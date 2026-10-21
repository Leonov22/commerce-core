import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import {
  prismaInventoryRepository,
  createPrismaInventoryRepository,
} from "@/modules/catalog/infrastructure/prisma-inventory-repository";
import { prisma } from "@/modules/catalog/infrastructure/prisma-client";
import type { ReserveStockResult } from "@/modules/catalog/repositories/inventory-repository";

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

    it("CR-4 (round 5): the real production reserveStock expiry sweep, paused at a deterministic seam, never overwrites a real competing release that commits in the gap", async () => {
      const product = await createTestProduct({ stockQuantity: 5 });
      const orderId = testOrderId();
      const stale = await prisma.stockReservation.create({
        data: {
          orderId,
          productId: product.id,
          quantity: 1,
          status: "ACTIVE",
          expiresAt: new Date(Date.now() - 60_000),
        },
      });

      // Deterministic orchestration against the REAL, unmodified
      // `reserveStock` logic — not a replica of its SQL. `reserveStock`
      // itself takes no callback at all (see
      // `prisma-inventory-repository.ts`'s own doc comment on
      // `PrismaInventoryRepositoryTestHooks`): a SEPARATE repository
      // instance is built here, via the same factory that builds the
      // shared production singleton, with a hook supplied only to THIS
      // instance's closure — the production singleton (`prismaInventoryRepository`,
      // used below for the competing `releaseReservation` call) is
      // never touched or reconfigured. The hook is invoked by the real
      // production transaction body at the exact moment between its own
      // read of the expired `ACTIVE` reservation and its conditional
      // expiry `UPDATE`. The hook runs the REAL `releaseReservation` (on
      // the ordinary production singleton) to full completion (commit)
      // before returning, so the production `UPDATE` that follows is
      // guaranteed — not merely hoped via `Promise.all` — to execute
      // strictly after that competing commit.
      let releaseResult:
        Awaited<ReturnType<typeof prismaInventoryRepository.releaseReservation>> | undefined;
      const testRepository = createPrismaInventoryRepository({
        beforeExpirySweep: async () => {
          releaseResult = await prismaInventoryRepository.releaseReservation(orderId, product.id);
        },
      });
      const reserveResult = await testRepository.reserveStock({
        orderId,
        productId: product.id,
        quantity: 1,
        expiresAt: new Date(Date.now() + 60_000),
      });

      // The competing release committed first (inside the seam): the
      // real production expiry update, issued strictly afterward inside
      // the same transaction, could not overwrite it.
      expect(releaseResult?.outcome).toBe("released");
      expect(reserveResult.outcome).toBe("alreadyFinal");
      if (reserveResult.outcome === "alreadyFinal") {
        expect(reserveResult.reservation.status).toBe("RELEASED");
      }

      const persisted = await prisma.stockReservation.findUniqueOrThrow({
        where: { id: stale.id },
      });
      expect(persisted.status).toBe("RELEASED");

      const count = await prisma.stockReservation.count({
        where: { orderId, productId: product.id },
      });
      expect(count).toBe(1);
    });

    it("CR-4 (round 2): a genuinely concurrent sweep (via reserveStock) and release racing on the same expired-but-not-yet-swept reservation never corrupts or reverts the other's result (best-effort real-concurrency sanity check, not the deterministic proof above)", async () => {
      const product = await createTestProduct({ stockQuantity: 5 });
      const orderId = testOrderId();
      const stale = await prisma.stockReservation.create({
        data: {
          orderId,
          productId: product.id,
          quantity: 1,
          status: "ACTIVE",
          expiresAt: new Date(Date.now() - 60_000),
        },
      });

      const [reserveResult, releaseResult] = await Promise.all([
        prismaInventoryRepository.reserveStock({
          orderId,
          productId: product.id,
          quantity: 1,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        prismaInventoryRepository.releaseReservation(orderId, product.id),
      ]);

      // reserveStock's own sweep must always report "alreadyFinal" here —
      // never a successful reservation — regardless of which side won.
      expect(reserveResult.outcome).toBe("alreadyFinal");
      if (reserveResult.outcome !== "alreadyFinal") return;

      // Whichever side won, both calls must agree on the SAME final
      // status — neither call's conditional update may silently
      // overwrite the other's already-applied terminal transition.
      if (reserveResult.reservation.status === "EXPIRED") {
        // The sweep won the race: release's own conditional update
        // found the row already EXPIRED, not ACTIVE.
        expect(releaseResult.outcome).toBe("notReleasable");
        if (releaseResult.outcome === "notReleasable") {
          expect(releaseResult.reservation.status).toBe("EXPIRED");
        }
      } else {
        // Release won the race: the sweep's conditional update matched
        // zero rows and correctly reported release's result instead of
        // overwriting it back to EXPIRED.
        expect(reserveResult.reservation.status).toBe("RELEASED");
        expect(releaseResult.outcome).toBe("released");
      }

      // Exactly one row, in exactly one of the two valid terminal
      // states — never reverted, never duplicated.
      const persisted = await prisma.stockReservation.findUniqueOrThrow({
        where: { id: stale.id },
      });
      expect(["EXPIRED", "RELEASED"]).toContain(persisted.status);
      expect(persisted.status).toBe(reserveResult.reservation.status);

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

  // IMP-048 Increment 4 — Admin Panel inventory management.
  describe("setTrackInventory", () => {
    it("enables tracking for a product that was not tracked, leaving stockQuantity untouched, with no audit row", async () => {
      const product = await createTestProduct({ trackInventory: false, stockQuantity: 7 });

      const result = await prismaInventoryRepository.setTrackInventory({
        productId: product.id,
        trackInventory: true,
      });
      expect(result).toEqual({
        outcome: "updated",
        trackInventory: true,
        stockQuantity: 7,
        adjustment: null,
      });

      const availability = await prismaInventoryRepository.getProductAvailability(product.id);
      expect(availability?.trackInventory).toBe(true);
      expect(availability?.stockQuantity).toBe(7);

      const history = await prismaInventoryRepository.listStockAdjustments({
        filter: { productId: product.id },
        page: 1,
        pageSize: 10,
      });
      expect(history.total).toBe(0);
    });

    it("disables tracking for a tracked product with no active reservations", async () => {
      const product = await createTestProduct({ trackInventory: true, stockQuantity: 3 });

      const result = await prismaInventoryRepository.setTrackInventory({
        productId: product.id,
        trackInventory: false,
      });
      expect(result).toEqual({
        outcome: "updated",
        trackInventory: false,
        stockQuantity: 3,
        adjustment: null,
      });
    });

    it("refuses to disable tracking while an active reservation exists, and does not flip the flag", async () => {
      const product = await createTestProduct({ trackInventory: true, stockQuantity: 5 });
      await prismaInventoryRepository.reserveStock({
        orderId: testOrderId(),
        productId: product.id,
        quantity: 2,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await prismaInventoryRepository.setTrackInventory({
        productId: product.id,
        trackInventory: false,
      });
      expect(result).toEqual({ outcome: "activeReservationsExist", reserved: 2 });

      const availability = await prismaInventoryRepository.getProductAvailability(product.id);
      expect(availability?.trackInventory).toBe(true);
    });

    it("disabling succeeds once the only reservation has expired (never blocked by a merely-stale ACTIVE row)", async () => {
      const product = await createTestProduct({ trackInventory: true, stockQuantity: 5 });
      await prismaInventoryRepository.reserveStock({
        orderId: testOrderId(),
        productId: product.id,
        quantity: 2,
        expiresAt: new Date(Date.now() - 1), // already expired
      });

      const result = await prismaInventoryRepository.setTrackInventory({
        productId: product.id,
        trackInventory: false,
      });
      expect(result).toEqual({
        outcome: "updated",
        trackInventory: false,
        stockQuantity: 5,
        adjustment: null,
      });
    });

    it("returns productNotFound for a nonexistent product", async () => {
      const result = await prismaInventoryRepository.setTrackInventory({
        productId: "does-not-exist",
        trackInventory: true,
      });
      expect(result).toEqual({ outcome: "productNotFound" });
    });

    describe("enabling with an initial quantity (race fix)", () => {
      it("applies the flag flip, the stock write, and the audit row atomically, in one call", async () => {
        const product = await createTestProduct({ trackInventory: false, stockQuantity: 0 });

        const result = await prismaInventoryRepository.setTrackInventory({
          productId: product.id,
          trackInventory: true,
          initialQuantity: 20,
          reason: "Initial stock count",
          adminUserId: "admin-1",
        });

        expect(result.outcome).toBe("updated");
        if (result.outcome !== "updated") throw new Error("unreachable");
        expect(result.trackInventory).toBe(true);
        expect(result.stockQuantity).toBe(20);
        expect(result.adjustment).not.toBeNull();
        expect(result.adjustment?.quantityChange).toBe(20);
        expect(result.adjustment?.reason).toBe("Initial stock count");
        expect(result.adjustment?.adminUserId).toBe("admin-1");

        const availability = await prismaInventoryRepository.getProductAvailability(product.id);
        expect(availability).toEqual({
          productId: product.id,
          trackInventory: true,
          stockQuantity: 20,
          reserved: 0,
          available: 20,
        });

        const history = await prismaInventoryRepository.listStockAdjustments({
          filter: { productId: product.id },
          page: 1,
          pageSize: 10,
        });
        expect(history.total).toBe(1);
        expect(history.items[0]!.quantityChange).toBe(20);
      });

      it("creates no audit row and still flips the flag when the initial quantity equals the current stock (zero delta)", async () => {
        const product = await createTestProduct({ trackInventory: false, stockQuantity: 5 });

        const result = await prismaInventoryRepository.setTrackInventory({
          productId: product.id,
          trackInventory: true,
          initialQuantity: 5,
        });

        expect(result).toEqual({
          outcome: "updated",
          trackInventory: true,
          stockQuantity: 5,
          adjustment: null,
        });

        const history = await prismaInventoryRepository.listStockAdjustments({
          filter: { productId: product.id },
          page: 1,
          pageSize: 10,
        });
        expect(history.total).toBe(0);
      });

      it("refuses a negative resulting stock quantity, writing neither the flag nor the stock", async () => {
        // Structurally this outcome can't arise through the sanctioned
        // admin flow (initialQuantity is always validated >= 0 before
        // this is called, so currentStockQuantity + delta === initialQuantity
        // can never be negative) — this test exercises the repository's
        // own defensive floor directly, the same way `adjustStock`'s own
        // tests exercise its identical floor in isolation.
        const product = await createTestProduct({ trackInventory: false, stockQuantity: 10 });
        // Force a negative target by calling with initialQuantity below
        // zero via a cast — the repository itself does not re-validate
        // non-negativity of `initialQuantity`, only that the computed
        // result isn't negative (mirroring `adjustStock`, which also
        // trusts its caller's `quantityChange` sign and only checks the
        // resulting total).
        const result = await prismaInventoryRepository.setTrackInventory({
          productId: product.id,
          trackInventory: true,
          initialQuantity: -5,
        });
        expect(result).toEqual({ outcome: "wouldGoNegative", currentStockQuantity: 10 });

        const availability = await prismaInventoryRepository.getProductAvailability(product.id);
        expect(availability?.trackInventory).toBe(false);
        expect(availability?.stockQuantity).toBe(10);
      });

      it("refuses an initial quantity below already-active reservations, writing neither the flag nor the stock", async () => {
        // Also structurally unreachable through the sanctioned admin
        // flow today (a product can only have ACTIVE reservations once
        // it has already been tracked at some point, and the enable
        // path is only reachable while untracked) — exercised directly
        // against the repository, as above, to prove the floor itself
        // is correct in isolation, the same way `adjustStock`'s own
        // `belowActiveReservations` test does.
        const product = await createTestProduct({ trackInventory: true, stockQuantity: 10 });
        await prismaInventoryRepository.reserveStock({
          orderId: testOrderId(),
          productId: product.id,
          quantity: 8,
          expiresAt: new Date(Date.now() + 60_000),
        });
        // Disable first so the product is back in the one state the
        // enable branch actually runs from, while the reservation (an
        // already-committed, independent row) stays ACTIVE — this is
        // the only way to construct the precondition at all, and it
        // requires disabling to succeed despite the active reservation,
        // which it would not through the normal `activeReservationsExist`
        // floor; so this test writes the product directly to simulate
        // a product that is untracked yet still has a lingering ACTIVE
        // reservation row, a state the sanctioned admin flow can never
        // itself produce.
        await prisma.product.update({ where: { id: product.id }, data: { trackInventory: false } });

        const result = await prismaInventoryRepository.setTrackInventory({
          productId: product.id,
          trackInventory: true,
          initialQuantity: 3,
        });
        expect(result).toEqual({
          outcome: "belowActiveReservations",
          currentStockQuantity: 10,
          activeReserved: 8,
        });

        const availability = await prismaInventoryRepository.getProductAvailability(product.id);
        expect(availability?.trackInventory).toBe(false);
        expect(availability?.stockQuantity).toBe(10);
      });

      it("sweeps a merely-stale ACTIVE reservation before computing the floor, consistent with adjustStock", async () => {
        const product = await createTestProduct({ trackInventory: true, stockQuantity: 10 });
        await prismaInventoryRepository.reserveStock({
          orderId: testOrderId(),
          productId: product.id,
          quantity: 8,
          expiresAt: new Date(Date.now() - 1), // already expired, not yet swept
        });
        await prisma.product.update({ where: { id: product.id }, data: { trackInventory: false } });

        const result = await prismaInventoryRepository.setTrackInventory({
          productId: product.id,
          trackInventory: true,
          initialQuantity: 3,
        });
        expect(result.outcome).toBe("updated");
        if (result.outcome !== "updated") throw new Error("unreachable");
        expect(result.stockQuantity).toBe(3);
      });

      it("rolls back the flag flip and the stock write together when a later step in the same transaction fails", async () => {
        const product = await createTestProduct({ trackInventory: false, stockQuantity: 0 });
        const testRepository = createPrismaInventoryRepository({
          beforeInitialStockAdjustmentInsert: async () => {
            throw new Error("injected failure after the product write, before the audit row");
          },
        });

        await expect(
          testRepository.setTrackInventory({
            productId: product.id,
            trackInventory: true,
            initialQuantity: 20,
            reason: "should never persist",
          }),
        ).rejects.toThrow("injected failure");

        // The whole transaction — including the `trackInventory`/
        // `stockQuantity` write that ran BEFORE the injected failure —
        // must have rolled back together. Read via a separate,
        // unrelated repository instance, after the failed call's own
        // transaction has definitely ended.
        const availability = await prismaInventoryRepository.getProductAvailability(product.id);
        expect(availability?.trackInventory).toBe(false);
        expect(availability?.stockQuantity).toBe(0);

        const history = await prismaInventoryRepository.listStockAdjustments({
          filter: { productId: product.id },
          page: 1,
          pageSize: 10,
        });
        expect(history.total).toBe(0);
      });

      it("a concurrent reserveStock call can never observe trackInventory=true paired with the pre-initialization stock — it is blocked by the same row lock until the enabling transaction commits", async () => {
        const product = await createTestProduct({ trackInventory: false, stockQuantity: 0 });
        const orderId = testOrderId();

        const box: { reserveStockPromise: Promise<ReserveStockResult> | null } = {
          reserveStockPromise: null,
        };

        const testRepository = createPrismaInventoryRepository({
          beforeInitialStockAdjustmentInsert: async () => {
            // At this exact point, inside the still-open enabling
            // transaction, the product row's `trackInventory`/
            // `stockQuantity` have already been written but NOT yet
            // committed — and the row is still locked (`FOR UPDATE`) by
            // this same transaction. Firing a real, unmodified
            // `reserveStock` call here — on the shared production
            // repository, a separate connection — and NOT awaiting it
            // yet proves it cannot proceed past its own `FOR UPDATE`
            // read until this transaction ends.
            box.reserveStockPromise = prismaInventoryRepository.reserveStock({
              orderId,
              productId: product.id,
              quantity: 20,
              expiresAt: new Date(Date.now() + 60_000),
            });
            // Give the now-blocked call a moment to actually reach and
            // block on the lock, so this transaction's own commit
            // (immediately after this hook returns) is genuinely what
            // unblocks it, not a lucky ordering.
            await new Promise((resolve) => setTimeout(resolve, 50));
          },
        });

        const enableResult = await testRepository.setTrackInventory({
          productId: product.id,
          trackInventory: true,
          initialQuantity: 20,
          reason: "Initial stock count",
        });
        expect(enableResult.outcome).toBe("updated");

        if (!box.reserveStockPromise) {
          throw new Error("the hook never fired — test is not exercising the intended window");
        }
        const reserveResult = await box.reserveStockPromise;

        // The decisive assertion: by the time `reserveStock` actually
        // ran its own availability check, it was reading the FULLY
        // committed post-initialization row (trackInventory=true AND
        // stockQuantity=20 together) — never the old, two-transaction
        // design's partial state (trackInventory=true, stockQuantity=0)
        // that would have wrongly reported `insufficientStock` here.
        expect(reserveResult.outcome).toBe("reserved");

        // `reserveStock` never decrements `stockQuantity` itself (only
        // `consumeReservation` does) — it only creates the reservation
        // row, so the on-hand count is still 20 and the full 20 units
        // are now reflected as reserved, leaving nothing available.
        const availability = await prismaInventoryRepository.getProductAvailability(product.id);
        expect(availability).toEqual({
          productId: product.id,
          trackInventory: true,
          stockQuantity: 20,
          reserved: 20,
          available: 0,
        });
      });
    });
  });

  describe("listStockAdjustments", () => {
    it("returns adjustments for one product, newest first, joined with the product's name", async () => {
      const product = await createTestProduct({ trackInventory: true, stockQuantity: 0 });
      await prismaInventoryRepository.adjustStock({
        productId: product.id,
        quantityChange: 10,
        reason: "Initial stock",
        adminUserId: "admin-1",
      });
      await prismaInventoryRepository.adjustStock({
        productId: product.id,
        quantityChange: -3,
        reason: "Damaged units",
        adminUserId: "admin-1",
      });

      const page = await prismaInventoryRepository.listStockAdjustments({
        filter: { productId: product.id },
        page: 1,
        pageSize: 20,
      });

      expect(page.total).toBe(2);
      expect(page.items).toHaveLength(2);
      expect(page.items[0]!.reason).toBe("Damaged units");
      expect(page.items[0]!.quantityChange).toBe(-3);
      expect(page.items[1]!.reason).toBe("Initial stock");
      expect(page.items.every((item) => item.productName === "Inventory Test Product")).toBe(true);
    });

    it("paginates and never returns another product's rows when filtered by productId", async () => {
      const productA = await createTestProduct({ trackInventory: true, stockQuantity: 0 });
      const productB = await createTestProduct({ trackInventory: true, stockQuantity: 0 });
      await prismaInventoryRepository.adjustStock({
        productId: productA.id,
        quantityChange: 5,
        reason: "A's stock",
        adminUserId: null,
      });
      await prismaInventoryRepository.adjustStock({
        productId: productB.id,
        quantityChange: 5,
        reason: "B's stock",
        adminUserId: null,
      });

      const page = await prismaInventoryRepository.listStockAdjustments({
        filter: { productId: productA.id },
        page: 1,
        pageSize: 20,
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0]!.productId).toBe(productA.id);
      expect(page.items[0]!.reason).toBe("A's stock");
    });

    it("records a null adminUserId as-is, never inventing an actor", async () => {
      const product = await createTestProduct({ trackInventory: true, stockQuantity: 0 });
      await prismaInventoryRepository.adjustStock({
        productId: product.id,
        quantityChange: 1,
        reason: "No admin id on this one",
        adminUserId: null,
      });

      const page = await prismaInventoryRepository.listStockAdjustments({
        filter: { productId: product.id },
        page: 1,
        pageSize: 20,
      });
      expect(page.items[0]!.adminUserId).toBeNull();
    });
  });
});
