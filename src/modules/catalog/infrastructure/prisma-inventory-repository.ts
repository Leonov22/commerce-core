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
  SetTrackInventoryInput,
  SetTrackInventoryResult,
  RecordInventoryExceptionInput,
  RecordInventoryExceptionResult,
  StockAdjustmentListOptions,
  StockAdjustmentListPage,
  StockAdjustmentListItem,
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
 *    key (`releaseReservation`, `securePaymentWindow`'s per-item touch)
 *    needs no product lock: it is a single conditional
 *    `UPDATE ... WHERE id = ... AND status = ...`, safe via Postgres's
 *    own per-row locking. Two such operations for DIFFERENT orders can
 *    never target the same row at all (a reservation is keyed by
 *    `(orderId, productId)`), so there is no lock-ordering concern
 *    between them either. `consumeReservation` is the one exception:
 *    because it also writes `stockQuantity`, it takes the SAME product
 *    `FOR UPDATE` lock as step 1 FIRST, before touching its own
 *    `stockReservation` row — see its own doc comment (Chat 3 Finding 2)
 *    for why a reversed order here once produced a real, reproduced
 *    deadlock against this file's other operations.
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

/** Mirrors `prisma-product-repository.ts`'s own `ADMIN_LOCALE` — this project has exactly one locale (`en`) today. */
const STOCK_HISTORY_LOCALE = "en";

/**
 * Chat 3 Finding 2 (MEDIUM): `setTrackInventory`'s deadlock cycle
 * against `consumeReservation` is now closed at the root — both lock
 * the `products` row FIRST, in the same order, so the cycle that once
 * produced a reproduced Postgres `40P01` is structurally impossible
 * (see `consumeReservation`'s own doc comment). This retry stays as
 * supplemental protection, exactly as instructed: it never replaces the
 * lock-order analysis above, and it never retries any failure other
 * than the two specific, recognized Postgres codes that mean "no data
 * was corrupted, the transaction was aborted cleanly, try again" —
 * 40P01 (deadlock_detected) and 40001 (serialization_failure). Those
 * two codes are not unique to the lock-order bug just closed — Postgres
 * can raise either one under ordinary `SERIALIZABLE`-style contention
 * unrelated to this specific cycle — so keeping the retry is still
 * worthwhile defense in depth, not dead code.
 *
 * Chat 3 Finding 4 (LOW): which top-level Prisma error CODE wraps a
 * `40P01`/`40001` is not stable — directly, empirically reproducing a
 * real deadlock against this project's actual `@prisma/adapter-pg`
 * setup showed the SAME underlying Postgres error surfaces as `P2010`
 * ("Raw query failed") when the statement Postgres chose to abort was
 * one of this file's raw `$queryRaw ... FOR UPDATE` locks, or as
 * `P2039` ("Database error") when it was an ORM call instead — which
 * one occurs depends on which side of the race Postgres's own deadlock
 * detector decided to abort, not on anything this code controls. The
 * reliable, structured field that is present in both cases is
 * `error.meta.driverAdapterError.cause.originalCode` — the raw
 * Postgres SQLSTATE, set by `@prisma/adapter-pg`'s own
 * `convertDriverError` for every error that actually came from the
 * `pg` driver, confirmed by reading that exact installed package's
 * source (version pinned by this repo's lockfile) and by directly
 * reproducing a real `40P01` against it (see this round's own
 * report for the captured object). That field is checked FIRST; the
 * message-substring check below is kept only as a fallback for the
 * case — not observed, but not provably impossible on some future
 * Prisma/adapter version — where `meta.driverAdapterError` is absent.
 */
const RETRYABLE_POSTGRES_ERROR_CODES = ["40P01", "40001"];
const MAX_DEADLOCK_RETRY_ATTEMPTS = 3;

function extractDriverAdapterOriginalCode(
  error: Prisma.PrismaClientKnownRequestError,
): string | undefined {
  const meta = error.meta as
    { driverAdapterError?: { cause?: { originalCode?: unknown } } } | undefined;
  const originalCode = meta?.driverAdapterError?.cause?.originalCode;
  return typeof originalCode === "string" ? originalCode : undefined;
}

function isRetryableTransactionError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  const structuredCode = extractDriverAdapterOriginalCode(error);
  if (structuredCode !== undefined) {
    return RETRYABLE_POSTGRES_ERROR_CODES.includes(structuredCode);
  }
  return RETRYABLE_POSTGRES_ERROR_CODES.some((code) => error.message.includes(code));
}

async function runTransactionWithDeadlockRetry<T>(
  run: () => Promise<T>,
  maxAttempts: number = MAX_DEADLOCK_RETRY_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt < maxAttempts && isRetryableTransactionError(error)) {
        continue;
      }
      throw error;
    }
  }
  // Unreachable: the loop above always either returns or throws by the
  // final attempt. Satisfies the compiler's control-flow analysis only.
  throw new Error("runTransactionWithDeadlockRetry: exhausted attempts without a result");
}

/** Thrown inside `securePaymentWindow`'s transaction purely to force a rollback of any already-applied per-item extensions once a later item fails — caught immediately outside, never leaks. */
class SecurePaymentWindowAbort extends Error {
  constructor(public readonly failures: SecurePaymentWindowFailure[]) {
    super("securePaymentWindow: one or more required items failed validation");
  }
}

/**
 * Round 6: test-only hooks accepted ONLY by `createPrismaInventoryRepository`
 * itself, at construction time — never by a method call on the resulting
 * object. This is what keeps `prismaInventoryRepository.reserveStock`'s
 * own callable signature identical to the public `InventoryRepository`
 * interface's single-argument contract: no caller holding a reference to
 * the shared production object (however it got that reference — through
 * the interface type, a direct import, or runtime introspection) can
 * pass a second argument and run arbitrary code while a production
 * transaction and product-row lock are held, because the method simply
 * never accepts one. The hook lives only in the closure of whichever
 * object instance was built with it — not in any module-level mutable
 * variable — so a test that needs it builds its OWN, separate instance
 * via this factory; the shared production singleton below is always
 * built with no hooks at all.
 */
export interface PrismaInventoryRepositoryTestHooks {
  /**
   * Invoked at the exact moment between `reserveStock`'s own read of an
   * `ACTIVE`-but-expired reservation and its conditional expiry
   * `UPDATE` — lets a test run a REAL, unmodified `releaseReservation`
   * call to full completion (commit) in that gap, deterministically,
   * without resorting to `Promise.all`'s non-deterministic scheduling or
   * copying this statement's SQL into the test. Exercised only by this
   * repository's own integration test, against a repository instance
   * this factory built specifically for that one test. Receives the
   * transaction's own `tx` client (Chat 3 Finding 1) so a test can
   * query that SAME connection's `pg_backend_pid()` — never a
   * different, unrelated connection's — to correlate it precisely
   * against a concurrently-blocked backend.
   */
  beforeExpirySweep?: (tx: Prisma.TransactionClient) => Promise<void>;

  /**
   * Round 7 (race fix): invoked inside `setTrackInventory`'s enabling
   * transaction, after the combined `trackInventory`+`stockQuantity`
   * write but before the `StockAdjustment` audit row is created — see
   * that method's own doc comment for exactly what this proves.
   * Exercised only by this repository's own integration test, against a
   * repository instance this factory built specifically for that test.
   * Receives `tx` for the same reason `beforeExpirySweep` does.
   */
  beforeInitialStockAdjustmentInsert?: (tx: Prisma.TransactionClient) => Promise<void>;

  /**
   * Chat 3 Finding 2 (MEDIUM): invoked inside `securePaymentWindow`'s
   * transaction, immediately before the conditional `UPDATE` for ONE
   * canonically-ordered tracked item — lets a test deterministically
   * pause one concurrent call mid-loop (after it has already locked an
   * earlier item in the canonical order, before it locks the next one)
   * and prove a second, real, unmodified concurrent call is genuinely
   * blocked waiting on that SAME row, never a different one. Exercised
   * only by this repository's own integration test, against a
   * repository instance this factory built specifically for that test.
   */
  beforeSecurePaymentWindowItemTouch?: (
    tx: Prisma.TransactionClient,
    productId: string,
  ) => Promise<void>;
}

export function createPrismaInventoryRepository(
  testHooks: PrismaInventoryRepositoryTestHooks = {},
): InventoryRepository {
  return {
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
            // CR-4 (round 3): still literally ACTIVE in the database, but
            // its wall-clock `expiresAt` has already passed and nothing has
            // swept it yet. We hold this product's row lock here, but NOT
            // a lock on this specific reservation row — `releaseReservation`/
            // `consumeReservation` can still concurrently win a terminal
            // transition on this exact row without needing the product
            // lock (by design, per the established protocol). The sweep
            // below is therefore a CONDITIONAL `UPDATE ... WHERE id = ? AND
            // status = 'ACTIVE' AND "expiresAt" <= now()` — both conditions
            // re-asserted at the exact moment of the write itself, not
            // merely inferred from the read above — never an unconditional
            // write: if release/consume already won in between our read
            // and this statement, this matches zero rows and does NOT
            // overwrite their result. Either way, the re-read immediately
            // after reports whichever transition actually won —
            // deterministic, and the pair is permanently terminal either
            // way (never revived, never a second row).
            if (testHooks.beforeExpirySweep) {
              await testHooks.beforeExpirySweep(tx);
            }
            await tx.stockReservation.updateMany({
              where: { id: existing.id, status: "ACTIVE", expiresAt: { lte: new Date() } },
              data: { status: "EXPIRED" },
            });
            const resolved = await tx.stockReservation.findUniqueOrThrow({
              where: { id: existing.id },
            });
            return { outcome: "alreadyFinal" as const, reservation: toDomainReservation(resolved) };
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

    async consumeReservation(
      orderId: string,
      productId: string,
    ): Promise<ConsumeReservationResult> {
      return prisma.$transaction(async (tx) => {
        // Chat 3 Finding 2 (MEDIUM) — root-cause fix. This used to lock
        // one `stockReservation` row FIRST (via the conditional `UPDATE`
        // below), then the `products` row SECOND (via the decrement
        // further down) — the reverse of every other writer in this
        // file, which locks `products` first and only ever touches
        // `stockReservation` rows afterward (see this file's own
        // top-of-file doc comment, points 1–3). That reversal created a
        // genuine cycle with `reserveStock`/`adjustStock`/
        // `setTrackInventory`'s own expiry sweep whenever a reservation
        // sat right at its expiry boundary — directly reproduced as a
        // real Postgres `40P01` deadlock (not merely theorized; see this
        // round's report). Taking the SAME `products` row lock FIRST
        // here, before touching the `stockReservation` row at all,
        // restores the single, consistent lock-acquisition order every
        // writer now shares — which, per point 2 of this file's own
        // doc comment, makes a cross-method deadlock structurally
        // impossible rather than just unlikely, regardless of timing.
        // The reservation referenced by `(orderId, productId)` always
        // belongs to a product that still exists (`StockReservation
        // .productId` is `ON DELETE RESTRICT`), so this lock is always
        // available to take; it changes no observable outcome below —
        // the lookup, the conditional transition, and the decrement
        // amount are byte-for-byte what they were before this lock was
        // added.
        await tx.$queryRaw`SELECT "id" FROM "products" WHERE "id" = ${productId} FOR UPDATE`;

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
            return {
              outcome: "alreadyConsumed" as const,
              reservation: toDomainReservation(latest),
            };
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

    async releaseReservation(
      orderId: string,
      productId: string,
    ): Promise<ReleaseReservationResult> {
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

          // Chat 3 Finding 2 (MEDIUM): canonicalize the per-item update
          // order — ascending by `productId` — before touching any
          // `stockReservation` row below. Each iteration's conditional
          // `UPDATE` holds that one row's lock for the rest of this
          // transaction (same as every other per-row write in this
          // file), and `requiredItems`' own array order is entirely
          // caller-supplied. Two concurrent `securePaymentWindow` calls
          // for the same order (e.g. a payment resume racing a retry)
          // that share more than one tracked product, supplied in
          // DIFFERENT array orders by their own callers, could
          // otherwise each come to hold one shared row's lock while
          // waiting on the other's — a genuine AB-BA cycle, the same
          // shape as the product-lock cycle this file already closed
          // for `consumeReservation` (see its own doc comment). Sorting
          // here means every concurrent call acquires these locks in
          // the SAME relative order regardless of its own caller's
          // array order, which makes that specific cycle impossible
          // the same way a single canonical order always does. This
          // changes nothing about WHICH items are touched, the
          // all-or-nothing rollback behavior, or the expiry/terminal-
          // state checks below — only the sequence in which rows are
          // touched within one transaction. This never creates a
          // reverse-order dependency against the `products` row lock:
          // this method never takes that lock at all (it only ever
          // reads `trackInventory` via a plain, non-locking
          // `findUnique` above), so it cannot invert against
          // `reserveStock`/`adjustStock`/`setTrackInventory`/
          // `consumeReservation`'s own product-first protocol.
          const canonicallyOrderedProductIds = [...trackedProductIds].sort((a, b) =>
            a < b ? -1 : a > b ? 1 : 0,
          );

          const now = new Date();
          for (const productId of canonicallyOrderedProductIds) {
            if (testHooks.beforeSecurePaymentWindowItemTouch) {
              await testHooks.beforeSecurePaymentWindowItemTouch(tx, productId);
            }
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

    async setTrackInventory(input: SetTrackInventoryInput): Promise<SetTrackInventoryResult> {
      const { productId, trackInventory, initialQuantity, reason, adminUserId } = input;
      return runTransactionWithDeadlockRetry(() =>
        prisma.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<
            { id: string; stockQuantity: number }[]
          >`SELECT "id", "stockQuantity" FROM "products" WHERE "id" = ${productId} FOR UPDATE`;
          if (locked.length === 0) {
            return { outcome: "productNotFound" as const };
          }
          const currentStockQuantity = locked[0]!.stockQuantity;

          if (!trackInventory) {
            // Same sweep-then-aggregate sequence `adjustStock` uses, under
            // the same product-row lock, so a reservation that is only
            // nominally `ACTIVE` because nothing has swept it yet can never
            // cause a false "still has active reservations" refusal.
            const now = new Date();
            await tx.stockReservation.updateMany({
              where: { productId, status: "ACTIVE", expiresAt: { lt: now } },
              data: { status: "EXPIRED" },
            });
            const aggregate = await tx.stockReservation.aggregate({
              where: { productId, status: "ACTIVE" },
              _sum: { quantity: true },
            });
            const reserved = aggregate._sum.quantity ?? 0;
            if (reserved > 0) {
              return { outcome: "activeReservationsExist" as const, reserved };
            }

            await tx.product.update({ where: { id: productId }, data: { trackInventory: false } });
            return {
              outcome: "updated" as const,
              trackInventory: false,
              stockQuantity: currentStockQuantity,
              adjustment: null,
            };
          }

          // Enabling. `initialQuantity` is an absolute target, not a
          // signed delta — the delta is computed here, against the
          // row-locked `currentStockQuantity`, never against a value read
          // by an earlier, separate call. This is what makes the flag
          // flip and the stock write a single atomic operation: there is
          // no gap, visible to any other transaction, in which
          // `trackInventory` is already `true` but `stockQuantity` is
          // still stale (the race an earlier two-transaction version of
          // this method had — `reserveStock` takes the same `FOR UPDATE`
          // lock on this row, so it can only ever observe this row either
          // fully before or fully after this entire transaction commits).
          if (initialQuantity === undefined) {
            await tx.product.update({ where: { id: productId }, data: { trackInventory: true } });
            return {
              outcome: "updated" as const,
              trackInventory: true,
              stockQuantity: currentStockQuantity,
              adjustment: null,
            };
          }

          const quantityChange = initialQuantity - currentStockQuantity;
          if (quantityChange === 0) {
            await tx.product.update({ where: { id: productId }, data: { trackInventory: true } });
            return {
              outcome: "updated" as const,
              trackInventory: true,
              stockQuantity: currentStockQuantity,
              adjustment: null,
            };
          }

          // Finding 1 (Chat 3, HIGH): re-checked HERE, against the real,
          // row-locked `currentStockQuantity` — never against whatever a
          // caller's own pre-check assumed `stockQuantity` was before this
          // transaction acquired its lock. A caller (e.g. the application
          // layer) may have computed `quantityChange` as 0 from a stale
          // read and therefore omitted `reason`, while a concurrent write
          // to this same product (any `adjustStock` call, which never
          // requires `trackInventory` to be true) changed the real
          // on-hand count in between. If the ACTUAL delta is nonzero and
          // no reason was supplied, this returns without writing anything
          // — `trackInventory` has not been flipped yet at this point in
          // the function, so there is nothing to roll back; the
          // transaction simply never performs its write. An empty string
          // is never substituted for a required reason.
          if (!reason || reason.trim().length === 0) {
            return { outcome: "reasonRequired" as const };
          }

          const newStockQuantity = currentStockQuantity + quantityChange;
          if (newStockQuantity < 0) {
            return { outcome: "wouldGoNegative" as const, currentStockQuantity };
          }

          // Same sweep-then-aggregate-then-floor sequence `adjustStock`
          // itself uses — duplicated here, not called via a nested
          // `prisma.$transaction`, since Prisma cannot compose an
          // interactive transaction inside another on the same
          // connection; calling `adjustStock` here would silently start a
          // SECOND, independent transaction and reintroduce exactly the
          // two-transaction race this method exists to close.
          const now = new Date();
          await tx.stockReservation.updateMany({
            where: { productId, status: "ACTIVE", expiresAt: { lt: now } },
            data: { status: "EXPIRED" },
          });
          const aggregate = await tx.stockReservation.aggregate({
            where: { productId, status: "ACTIVE" },
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
            where: { id: productId },
            data: { trackInventory: true, stockQuantity: newStockQuantity },
          });

          // Round 7: test-only hook, invoked after the combined
          // flag-and-stock write but before the audit row is created —
          // lets a test (a) run a REAL, unmodified `reserveStock` call
          // concurrently from here, deterministically proving it blocks
          // on this same row's lock until this transaction commits, and
          // (b) throw, deterministically proving the whole transaction
          // (including the `tx.product.update` just above) rolls back
          // rather than partially applying. See `beforeExpirySweep`'s own
          // doc comment for why this is a hook rather than `Promise.all`
          // or hand-replicated SQL.
          if (testHooks.beforeInitialStockAdjustmentInsert) {
            await testHooks.beforeInitialStockAdjustmentInsert(tx);
          }

          const adjustment = await tx.stockAdjustment.create({
            data: {
              productId,
              quantityChange,
              // Never a silent `""` fallback — the `reasonRequired` check
              // above already guaranteed a non-empty, trimmed string
              // whenever this line is reached.
              reason: reason.trim(),
              adminUserId: adminUserId ?? null,
            },
          });
          return {
            outcome: "updated" as const,
            trackInventory: true,
            stockQuantity: newStockQuantity,
            adjustment: toDomainAdjustment(adjustment),
          };
        }),
      );
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

    async getProductsAvailability(productIds: string[]): Promise<Map<string, ProductAvailability>> {
      const result = new Map<string, ProductAvailability>();
      if (productIds.length === 0) {
        return result;
      }

      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, trackInventory: true, stockQuantity: true },
      });

      const trackedProductIds = products
        .filter((product) => product.trackInventory)
        .map((product) => product.id);

      const now = new Date();
      const grouped =
        trackedProductIds.length > 0
          ? await prisma.stockReservation.groupBy({
              by: ["productId"],
              where: {
                productId: { in: trackedProductIds },
                status: "ACTIVE",
                expiresAt: { gt: now },
              },
              _sum: { quantity: true },
            })
          : [];
      const reservedByProductId = new Map(
        grouped.map((row) => [row.productId, row._sum.quantity ?? 0]),
      );

      for (const product of products) {
        if (!product.trackInventory) {
          result.set(product.id, {
            productId: product.id,
            trackInventory: false,
            stockQuantity: product.stockQuantity,
            reserved: 0,
            available: null,
          });
          continue;
        }
        const reserved = reservedByProductId.get(product.id) ?? 0;
        result.set(product.id, {
          productId: product.id,
          trackInventory: true,
          stockQuantity: product.stockQuantity,
          reserved,
          available: product.stockQuantity - reserved,
        });
      }

      return result;
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

    async listStockAdjustments(
      options: StockAdjustmentListOptions,
    ): Promise<StockAdjustmentListPage> {
      const { filter, page, pageSize } = options;
      const where = filter?.productId ? { productId: filter.productId } : {};

      const [rows, total] = await Promise.all([
        prisma.stockAdjustment.findMany({
          where,
          include: {
            product: { include: { translations: { where: { locale: STOCK_HISTORY_LOCALE } } } },
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.stockAdjustment.count({ where }),
      ]);

      const items: StockAdjustmentListItem[] = rows.map((row) => ({
        ...toDomainAdjustment(row),
        productName: row.product.translations[0]?.name ?? "",
      }));

      return { items, total, page, pageSize };
    },
  };
}

/**
 * The shared production singleton — built with no test hooks, so its
 * `reserveStock` is indistinguishable, at both the type level and the
 * runtime level, from a plain `InventoryRepository` implementation that
 * never had a synchronization seam at all.
 */
export const prismaInventoryRepository: InventoryRepository = createPrismaInventoryRepository();
