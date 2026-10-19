import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/modules/catalog/infrastructure/prisma-client";
import type {
  InventoryRepository,
  ReserveStockInput,
  ReserveStockResult,
  ConsumeReservationResult,
  ReleaseReservationResult,
  RequiredPaymentItem,
  SecurePaymentWindowResult,
  SecurePaymentWindowFailure,
  AdjustStockInput,
  AdjustStockResult,
  RecordInventoryExceptionInput,
  RecordInventoryExceptionResult,
} from "@/modules/catalog/repositories/inventory-repository";
import type {
  StockReservation,
  StockAdjustment,
  InventoryException,
  ProductAvailability,
} from "@/modules/catalog/domain/inventory";

/**
 * IMP-048, Increment 2 — reservation-based inventory tracking.
 *
 * Concurrency protocol (approved across three architecture review
 * rounds — see this module's own history for the rejected alternatives):
 *
 * 1. Every operation that computes an aggregate (sum of `ACTIVE`
 *    reservations, or on-hand stock) and THEN decides whether to write a
 *    NEW row (`reserveStock`, `adjustStock`) first takes a
 *    `SELECT ... FOR UPDATE` lock on the single `Product` row involved,
 *    inside its own short transaction, and never holds more than one
 *    product's lock at a time. Prisma's schema DSL has no row-locking
 *    primitive, so this one lock-acquiring statement is raw SQL — the
 *    rest of each operation uses the normal Prisma Client.
 * 2. Because step 1 never holds two product locks at once, and nothing
 *    else in this file ever takes a product lock, two product locks can
 *    never be acquired in conflicting order — deadlock between these
 *    operations is structurally impossible, not just unlikely.
 * 3. Every operation that targets ONE already-identified row by its own
 *    key (`consumeReservation`, `releaseReservation`,
 *    `securePaymentWindow`'s per-item touch) needs no product lock: it is
 *    a single conditional `UPDATE ... WHERE id = ... AND status = ...`,
 *    safe via Postgres's own per-row locking. Two such operations for
 *    DIFFERENT orders can never target the same row at all (a
 *    reservation is keyed by `(orderId, productId)`), so there is no
 *    lock-ordering concern between them either.
 * 4. Reservation expiry is never decided by filtering `expiresAt > now()`
 *    at read time alone — that cannot prevent a late webhook from
 *    consuming stock already granted to a second order (filtering
 *    doesn't change the row's actual `status` column). Instead:
 *      - `reserveStock`/`adjustStock` perform a real, atomic
 *        `ACTIVE → EXPIRED` transition for the one product they hold the
 *        lock on, INLINE, before computing the aggregate they decide on.
 *      - `consumeReservation`'s conditional `UPDATE` includes
 *        `AND "expiresAt" > now()` in its own `WHERE` clause, so it fails
 *        closed purely on wall-clock time even if no sweep has physically
 *        flipped the row yet — it never depends on the timing of an
 *        unrelated transaction's sweep.
 *      - `securePaymentWindow`'s touch is the same conditional-`UPDATE`
 *        shape: it can never resurrect a row whose `status` or
 *        `expiresAt` has already moved past `ACTIVE`-and-current.
 */

function toDomainReservation(row: {
  id: string;
  productId: string;
  orderId: string;
  quantity: number;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): StockReservation {
  return {
    id: row.id,
    productId: row.productId,
    orderId: row.orderId,
    quantity: row.quantity,
    status: row.status as StockReservation["status"],
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDomainAdjustment(row: {
  id: string;
  productId: string;
  quantityChange: number;
  reason: string;
  adminUserId: string | null;
  createdAt: Date;
}): StockAdjustment {
  return {
    id: row.id,
    productId: row.productId,
    quantityChange: row.quantityChange,
    reason: row.reason,
    adminUserId: row.adminUserId,
    createdAt: row.createdAt,
  };
}

function toDomainException(row: {
  id: string;
  reservationId: string;
  orderId: string;
  productId: string;
  quantity: number;
  paymentId: string | null;
  reason: string;
  status: string;
  detectedAt: Date;
  resolvedAt: Date | null;
  resolvedByAdminUserId: string | null;
  resolutionNote: string | null;
}): InventoryException {
  return {
    id: row.id,
    reservationId: row.reservationId,
    orderId: row.orderId,
    productId: row.productId,
    quantity: row.quantity,
    paymentId: row.paymentId,
    reason: row.reason,
    status: row.status as InventoryException["status"],
    detectedAt: row.detectedAt,
    resolvedAt: row.resolvedAt,
    resolvedByAdminUserId: row.resolvedByAdminUserId,
    resolutionNote: row.resolutionNote,
  };
}

/** Thrown inside `securePaymentWindow`'s transaction purely to force a rollback of any already-applied per-item extensions once a later item fails — caught immediately outside, never leaks. */
class SecurePaymentWindowAbort extends Error {
  constructor(public readonly failures: SecurePaymentWindowFailure[]) {
    super("securePaymentWindow: one or more required items failed validation");
  }
}

export const prismaInventoryRepository: InventoryRepository = {
  async reserveStock(input: ReserveStockInput): Promise<ReserveStockResult> {
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string; trackInventory: boolean; stockQuantity: number }[]
      >`SELECT "id", "trackInventory", "stockQuantity" FROM "products" WHERE "id" = ${input.productId} FOR UPDATE`;
      if (locked.length === 0) {
        return { outcome: "productNotFound" as const };
      }
      const product = locked[0]!;

      const existing = await tx.stockReservation.findUnique({
        where: { orderId_productId: { orderId: input.orderId, productId: input.productId } },
      });
      if (existing) {
        if (existing.status === "ACTIVE" && existing.expiresAt > new Date()) {
          return {
            outcome: "alreadyReserved" as const,
            reservation: toDomainReservation(existing),
          };
        }
        if (existing.status === "ACTIVE") {
          // CR-4: still literally ACTIVE in the database, but its
          // wall-clock `expiresAt` has already passed and nothing has
          // swept it yet. We already hold this product's row lock here,
          // so this is the correct place to perform that real, atomic
          // ACTIVE -> EXPIRED transition for this one row — it must never
          // be reported as a successful reservation, and the pair is now
          // permanently terminal (never revived), exactly like the
          // RELEASED/CONSUMED rows handled just below. Deliberately makes
          // the outcome identical whether or not some other operation's
          // sweep already flipped this exact row first.
          const expired = await tx.stockReservation.update({
            where: { id: existing.id },
            data: { status: "EXPIRED" },
          });
          return { outcome: "alreadyFinal" as const, reservation: toDomainReservation(expired) };
        }
        return { outcome: "alreadyFinal" as const, reservation: toDomainReservation(existing) };
      }

      if (!product.trackInventory) {
        return { outcome: "notTracked" as const };
      }

      const now = new Date();
      await tx.stockReservation.updateMany({
        where: { productId: input.productId, status: "ACTIVE", expiresAt: { lt: now } },
        data: { status: "EXPIRED" },
      });

      const aggregate = await tx.stockReservation.aggregate({
        where: { productId: input.productId, status: "ACTIVE" },
        _sum: { quantity: true },
      });
      const reserved = aggregate._sum.quantity ?? 0;
      const available = product.stockQuantity - reserved;
      if (available < input.quantity) {
        return { outcome: "insufficientStock" as const, available };
      }

      const created = await tx.stockReservation.create({
        data: {
          orderId: input.orderId,
          productId: input.productId,
          quantity: input.quantity,
          status: "ACTIVE",
          expiresAt: input.expiresAt,
        },
      });
      return { outcome: "reserved" as const, reservation: toDomainReservation(created) };
    });
  },

  async consumeReservation(orderId: string, productId: string): Promise<ConsumeReservationResult> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.stockReservation.findUnique({
        where: { orderId_productId: { orderId, productId } },
      });
      if (!existing) {
        return { outcome: "notFound" as const };
      }

      const now = new Date();
      const updated = await tx.stockReservation.updateMany({
        where: { orderId, productId, status: "ACTIVE", expiresAt: { gt: now } },
        data: { status: "CONSUMED" },
      });

      if (updated.count === 0) {
        const latest = await tx.stockReservation.findUniqueOrThrow({
          where: { orderId_productId: { orderId, productId } },
        });
        if (latest.status === "CONSUMED") {
          return { outcome: "alreadyConsumed" as const, reservation: toDomainReservation(latest) };
        }
        return { outcome: "notConsumable" as const, reservation: toDomainReservation(latest) };
      }

      // `quantity` is set once at creation and never mutated by any
      // operation in this module, so the pre-update snapshot read above
      // is still an accurate amount to decrement by.
      await tx.product.update({
        where: { id: productId },
        data: { stockQuantity: { decrement: existing.quantity } },
      });

      const consumed = await tx.stockReservation.findUniqueOrThrow({
        where: { orderId_productId: { orderId, productId } },
      });
      return { outcome: "consumed" as const, reservation: toDomainReservation(consumed) };
    });
  },

  async releaseReservation(orderId: string, productId: string): Promise<ReleaseReservationResult> {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.stockReservation.updateMany({
        where: { orderId, productId, status: "ACTIVE" },
        data: { status: "RELEASED" },
      });

      if (updated.count === 0) {
        const existing = await tx.stockReservation.findUnique({
          where: { orderId_productId: { orderId, productId } },
        });
        if (!existing) {
          return { outcome: "notFound" as const };
        }
        if (existing.status === "RELEASED") {
          return {
            outcome: "alreadyReleased" as const,
            reservation: toDomainReservation(existing),
          };
        }
        return { outcome: "notReleasable" as const, reservation: toDomainReservation(existing) };
      }

      const released = await tx.stockReservation.findUniqueOrThrow({
        where: { orderId_productId: { orderId, productId } },
      });
      return { outcome: "released" as const, reservation: toDomainReservation(released) };
    });
  },

  async securePaymentWindow(
    orderId: string,
    requiredItems: RequiredPaymentItem[],
    newExpiresAt: Date,
  ): Promise<SecurePaymentWindowResult> {
    try {
      await prisma.$transaction(async (tx) => {
        const failures: SecurePaymentWindowFailure[] = [];
        const trackedProductIds: string[] = [];

        for (const item of requiredItems) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
            select: { trackInventory: true },
          });
          if (!product) {
            failures.push({ productId: item.productId, reason: "productNotFound" });
            continue;
          }
          if (product.trackInventory) {
            trackedProductIds.push(item.productId);
          }
        }
        if (failures.length > 0) {
          throw new SecurePaymentWindowAbort(failures);
        }

        const now = new Date();
        for (const productId of trackedProductIds) {
          const touched = await tx.stockReservation.updateMany({
            where: { orderId, productId, status: "ACTIVE", expiresAt: { gt: now } },
            data: { expiresAt: newExpiresAt },
          });
          if (touched.count !== 1) {
            const existing = await tx.stockReservation.findUnique({
              where: { orderId_productId: { orderId, productId } },
            });
            failures.push({
              productId,
              reason: existing ? "reservationNotActive" : "reservationMissing",
            });
          }
        }
        if (failures.length > 0) {
          // Rolls back every extension already applied above in this
          // same transaction — this is all-or-nothing by construction,
          // not by a second compensating pass.
          throw new SecurePaymentWindowAbort(failures);
        }
      });
      return { ok: true };
    } catch (error) {
      if (error instanceof SecurePaymentWindowAbort) {
        return { ok: false, failures: error.failures };
      }
      throw error;
    }
  },

  async adjustStock(input: AdjustStockInput): Promise<AdjustStockResult> {
    if (input.quantityChange === 0) {
      return { outcome: "noOp" as const };
    }
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string; stockQuantity: number }[]
      >`SELECT "id", "stockQuantity" FROM "products" WHERE "id" = ${input.productId} FOR UPDATE`;
      if (locked.length === 0) {
        return { outcome: "productNotFound" as const };
      }
      const currentStockQuantity = locked[0]!.stockQuantity;
      const newStockQuantity = currentStockQuantity + input.quantityChange;
      if (newStockQuantity < 0) {
        return { outcome: "wouldGoNegative" as const, currentStockQuantity };
      }

      const now = new Date();
      await tx.stockReservation.updateMany({
        where: { productId: input.productId, status: "ACTIVE", expiresAt: { lt: now } },
        data: { status: "EXPIRED" },
      });

      const aggregate = await tx.stockReservation.aggregate({
        where: { productId: input.productId, status: "ACTIVE" },
        _sum: { quantity: true },
      });
      const activeReserved = aggregate._sum.quantity ?? 0;
      if (newStockQuantity < activeReserved) {
        return {
          outcome: "belowActiveReservations" as const,
          currentStockQuantity,
          activeReserved,
        };
      }

      await tx.product.update({
        where: { id: input.productId },
        data: { stockQuantity: newStockQuantity },
      });
      const adjustment = await tx.stockAdjustment.create({
        data: {
          productId: input.productId,
          quantityChange: input.quantityChange,
          reason: input.reason,
          adminUserId: input.adminUserId,
        },
      });
      return {
        outcome: "applied" as const,
        adjustment: toDomainAdjustment(adjustment),
        stockQuantity: newStockQuantity,
      };
    });
  },

  async recordInventoryException(
    input: RecordInventoryExceptionInput,
  ): Promise<RecordInventoryExceptionResult> {
    try {
      const created = await prisma.inventoryException.create({
        data: {
          reservationId: input.reservationId,
          orderId: input.orderId,
          productId: input.productId,
          quantity: input.quantity,
          paymentId: input.paymentId,
          reason: input.reason,
          status: "OPEN",
        },
      });
      return { outcome: "created" as const, exception: toDomainException(created) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.inventoryException.findUniqueOrThrow({
          where: { reservationId: input.reservationId },
        });
        return { outcome: "alreadyExists" as const, exception: toDomainException(existing) };
      }
      throw error;
    }
  },

  async getProductAvailability(productId: string): Promise<ProductAvailability | null> {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, trackInventory: true, stockQuantity: true },
    });
    if (!product) {
      return null;
    }
    if (!product.trackInventory) {
      return {
        productId: product.id,
        trackInventory: false,
        stockQuantity: product.stockQuantity,
        reserved: 0,
        available: null,
      };
    }

    // Read-time filtered (`expiresAt > now()`), for display only — this
    // is a pure read, never a capacity *decision*, so the write-path race
    // this module's own doc comment describes does not apply here.
    const now = new Date();
    const aggregate = await prisma.stockReservation.aggregate({
      where: { productId, status: "ACTIVE", expiresAt: { gt: now } },
      _sum: { quantity: true },
    });
    const reserved = aggregate._sum.quantity ?? 0;
    return {
      productId: product.id,
      trackInventory: true,
      stockQuantity: product.stockQuantity,
      reserved,
      available: product.stockQuantity - reserved,
    };
  },

  async listLowStockProducts(threshold: number): Promise<ProductAvailability[]> {
    const trackedProducts = await prisma.product.findMany({
      where: { trackInventory: true },
      select: { id: true, stockQuantity: true },
    });
    if (trackedProducts.length === 0) {
      return [];
    }

    const now = new Date();
    const grouped = await prisma.stockReservation.groupBy({
      by: ["productId"],
      where: {
        productId: { in: trackedProducts.map((product) => product.id) },
        status: "ACTIVE",
        expiresAt: { gt: now },
      },
      _sum: { quantity: true },
    });
    const reservedByProduct = new Map(
      grouped.map((row) => [row.productId, row._sum.quantity ?? 0]),
    );

    return trackedProducts
      .map((product) => {
        const reserved = reservedByProduct.get(product.id) ?? 0;
        return {
          productId: product.id,
          trackInventory: true as const,
          stockQuantity: product.stockQuantity,
          reserved,
          available: product.stockQuantity - reserved,
        };
      })
      .filter((availability) => availability.available <= threshold)
      .sort((a, b) => a.available - b.available);
  },
};
