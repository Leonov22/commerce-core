import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import {
  prismaInventoryRepository,
  createPrismaInventoryRepository,
} from "@/modules/catalog/infrastructure/prisma-inventory-repository";
import { prisma } from "@/modules/catalog/infrastructure/prisma-client";
import type { ReserveStockResult } from "@/modules/catalog/repositories/inventory-repository";

/**
 * Chat 3 Finding 4 (LOW): matches the exact shape this project's actual
 * installed Prisma 7.9.1 + `@prisma/adapter-pg` combination throws for
 * a real Postgres `40P01` deadlock — confirmed by directly reproducing
 * one (two transactions taking `FOR UPDATE` locks on two product rows
 * in reverse order) and logging the resulting error's `.code`, `.meta`,
 * and `Object.keys`, not by reading the (minified) source alone. That
 * reproduction showed the SAME underlying `40P01` can surface as
 * EITHER Prisma error code `P2010` ("Raw query failed", when the
 * statement Postgres chose to abort was a raw `$queryRaw ... FOR
 * UPDATE`) or `P2039` ("Database error", for an ORM call) — which one
 * occurs depends on which side of the race Postgres's own deadlock
 * detector aborts, not on anything application code controls. Both
 * carry the SAME structured `meta.driverAdapterError.cause.originalCode`
 * field, which is what `isRetryableTransactionError` now checks first
 * (see that function's own doc comment) — `prismaCode` lets a test
 * prove that check is genuinely code-agnostic by constructing both
 * observed shapes with an identical structured code.
 *
 * `40001` (serialization_failure) was NOT independently reproduced
 * against this project's own transactions — they all run at Prisma's
 * default isolation level (Postgres `READ COMMITTED`), under which
 * ordinary concurrent writes block rather than abort with `40001`
 * (that code is realistically reachable only under `SERIALIZABLE`/
 * `REPEATABLE READ`, which nothing in this file uses). Its structured
 * shape below is therefore based on reading `@prisma/adapter-pg`'s own
 * installed source (the exact same `mapDriverError` function already
 * confirmed accurate for `40P01` above), not an independent live
 * reproduction — stated here honestly rather than claimed as verified.
 */
function makeDeadlockError(
  options: { prismaCode?: "P2010" | "P2039"; sqlState?: "40P01" | "40001" } = {},
): Prisma.PrismaClientKnownRequestError {
  const prismaCode = options.prismaCode ?? "P2039";
  const sqlState = options.sqlState ?? "40P01";
  const originalMessage = sqlState === "40P01" ? "deadlock detected" : "could not serialize access";
  const message =
    prismaCode === "P2010"
      ? `Invalid \`prisma.$queryRaw()\` invocation:\n\n\nRaw query failed. Code: \`${sqlState}\`. Message: \`${originalMessage}\``
      : `Database error. Code: \`${sqlState}\`. Message: \`${originalMessage}\``;
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: prismaCode,
    clientVersion: "test",
    meta: {
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: {
          originalCode: sqlState,
          originalMessage,
          // `40001` maps to the adapter's own named `TransactionWriteConflict`
          // kind (no raw `code` field in that branch); `40P01` falls
          // through to the generic `postgres` kind, which does carry one.
          // `originalCode` (checked by production code) is present either way.
          ...(sqlState === "40001"
            ? { kind: "TransactionWriteConflict" }
            : { kind: "postgres", code: sqlState, severity: "ERROR", message: originalMessage }),
        },
      },
    },
  });
}

/**
 * Integration tests against the real Postgres database — concurrency
 * guarantees (no overselling, no deadlock, no revived terminal
 * reservations) cannot be proven against a fake repository, since a fake
 * never runs two calls on separate connections racing against the same
 * rows. See `prisma-inventory-repository.ts`'s own doc comment for the
 * locking protocol these tests are proving.
 */

/**
 * Chat 3 Finding 1 (MEDIUM): reads the backend process id of the
 * Postgres connection a given interactive-transaction `tx` client is
 * currently running on, via `pg_backend_pid()` executed ON THAT SAME
 * CONNECTION (never a separate `prisma.$queryRaw` call, which would run
 * on a different pooled connection and report the wrong pid entirely).
 * This is what makes it possible to name, precisely, which backend a
 * test expects to be the LOCK HOLDER, rather than inferring it from
 * timing.
 */
async function getBackendPid(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  return rows[0]!.pid;
}

/**
 * Chat 3 Finding 1 (MEDIUM), round 3: the ORIGINAL version of this
 * helper polled `pg_locks` for ANY backend, anywhere in the database,
 * waiting on ANY `transactionid` lock — it could not distinguish the
 * specific competing transaction a test cares about from a completely
 * unrelated one blocked by a completely unrelated holder (e.g. another
 * test file's own concurrency test, running against the same shared
 * database at the same time). Round 3 narrowed this to `pg_stat_activity`
 * joined through `pg_blocking_pids(pid)`, resolving once SOME backend's
 * blocking set contains the named `holderBackendPid`.
 *
 * Chat 3 Finding 2 (MEDIUM), round 4: being blocked BY the right holder
 * is necessary but, on its own, still not sufficient proof that the
 * waiting backend is THIS test's own competing call specifically — only
 * that it's blocked by something this holder's connection did. This
 * version adds a second, independent condition: the waiting backend's
 * own `pg_stat_activity.query` text must also match `expectedQueryPattern`
 * (a `LIKE` pattern), i.e. it must be running the EXACT kind of
 * statement the test's competing call is expected to issue — captured
 * by directly running each real call and logging the resulting
 * `pg_stat_activity.query` text (see each call site's own comment for
 * the exact pattern used and why). `wait_event_type = 'Lock'` is
 * checked too, as a third, independently-sourced confirmation that
 * this backend is genuinely blocked on a lock (not merely idle or busy
 * elsewhere) at the moment it matches.
 *
 * Capturing the competing call's own backend pid directly (e.g. via a
 * hook on ITS side) was deliberately NOT done: every one of this file's
 * competing calls is fired through the unmodified, unhooked PRODUCTION
 * singleton specifically to prove the real method blocks — adding a
 * hook there to extract its pid would reintroduce exactly the kind of
 * production-code change to an already-reviewed primitive this round
 * is told to avoid unless strictly necessary, and the query-text
 * correlation below achieves the same precision without it.
 *
 * Resolves with the one matching pid once found. Throws — failing the
 * test with a clear, actionable message, never a silent false pass —
 * if zero backends match within `timeoutMs`, or if MORE than one
 * backend matches at once (an ambiguous result this helper refuses to
 * guess through, rather than arbitrarily picking one).
 */
async function waitUntilBackendIsBlockedBy(
  holderBackendPid: number,
  expectedQueryPattern: string,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<number> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const pollIntervalMs = options.pollIntervalMs ?? 20;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<{ pid: number }[]>`
      SELECT pid
      FROM pg_stat_activity
      WHERE ${holderBackendPid} = ANY(pg_blocking_pids(pid))
        AND wait_event_type = 'Lock'
        AND query LIKE ${expectedQueryPattern}
    `;
    if (rows.length === 1) {
      return rows[0]!.pid;
    }
    if (rows.length > 1) {
      throw new Error(
        `waitUntilBackendIsBlockedBy: ${rows.length} distinct backends (pids: ` +
          `${rows.map((r) => r.pid).join(", ")}) are simultaneously blocked by backend ` +
          `${holderBackendPid} while matching the expected query pattern — ambiguous, cannot ` +
          `determine which one is this test's own competing call. The test's setup is not as ` +
          `isolated as assumed (check for leftover state or an unrelated concurrent operation ` +
          `on the same row).`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `waitUntilBackendIsBlockedBy: no backend was observed blocked specifically by backend ` +
      `${holderBackendPid} while running a statement matching ${JSON.stringify(expectedQueryPattern)} ` +
      `within ${timeoutMs}ms — the test is not exercising the intended lock-wait window, and the ` +
      `assertions that follow would not be deterministic.`,
  );
}

/** The exact tail Prisma/`@prisma/adapter-pg` generates for every raw `products` row lock in this file (`reserveStock`, `adjustStock`, `setTrackInventory`, `consumeReservation`) — confirmed by direct reproduction, not assumed; see this helper's own doc comment. */
const PRODUCT_FOR_UPDATE_QUERY_PATTERN = '%WHERE "id" = $1 FOR UPDATE%';

/** The exact tail Prisma generates for `securePaymentWindow`'s per-item conditional `stockReservation` update — confirmed by direct reproduction (temporarily logging `pg_stat_activity` from inside the real test), not assumed. */
const SECURE_PAYMENT_WINDOW_RESERVATION_UPDATE_QUERY_PATTERN =
  '%UPDATE "public"."stock_reservations" SET "expiresAt"%';
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

    // Chat 3 Finding 2 (MEDIUM) — root-cause fix. `consumeReservation`
    // used to lock a `stockReservation` row BEFORE the `products` row —
    // the reverse of `setTrackInventory`'s own order (product row,
    // then `stockReservation` rows) — which was directly reproduced as
    // a real Postgres `40P01` deadlock whenever a reservation sat right
    // at its expiry boundary (see this file's git history / this
    // round's own report for the captured error text). Reproducing that
    // exact boundary deterministically is what made the original
    // regression test flaky: it depended on a genuine race between two
    // transactions' independent wall-clock reads, which no amount of
    // `pg_locks` polling on ITS OWN can pin to a single instant. The fix
    // itself removes that dependency entirely — `consumeReservation` now
    // takes the SAME `products` row lock FIRST, unconditionally, so
    // whichever of the two operations asks for it first simply makes
    // the other wait (ordinary blocking, not a cycle), regardless of
    // any reservation's expiry timing. This test proves exactly that
    // mechanism, deterministically: it forces a real, uncommitted
    // `setTrackInventory` transaction to hold the product lock, proves
    // via Postgres's own `pg_locks` that a concurrent, completely
    // unmodified, production `consumeReservation` call is genuinely
    // blocked waiting for it (never a sleep), then releases the holder
    // and confirms the waiter proceeds to completion with no deadlock
    // and the correct final state. No hook was added to
    // `consumeReservation` itself to build this — the existing,
    // already-reviewed `beforeInitialStockAdjustmentInsert` hook on the
    // LOCK-HOLDING side was sufficient.
    it("Chat 3 Finding 2 (MEDIUM): a concurrent consumeReservation call waits cleanly for setTrackInventory's product-row lock instead of risking a reverse-order deadlock", async () => {
      const product = await createTestProduct({ trackInventory: false, stockQuantity: 0 });
      const orderId = testOrderId();
      await prisma.stockReservation.create({
        data: {
          orderId,
          productId: product.id,
          quantity: 5,
          status: "ACTIVE",
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      const box: {
        consumeReservationPromise: Promise<
          Awaited<ReturnType<typeof prismaInventoryRepository.consumeReservation>>
        > | null;
      } = { consumeReservationPromise: null };

      const testRepository = createPrismaInventoryRepository({
        beforeInitialStockAdjustmentInsert: async (tx) => {
          // At this point `setTrackInventory`'s transaction already
          // holds the product row's `FOR UPDATE` lock, uncommitted.
          // Firing the real, unmodified `consumeReservation` here (on
          // the shared production repository, a separate connection)
          // and not awaiting it yet is what lets the assertion below
          // prove it is genuinely blocked on that SAME lock, not on the
          // `stockReservation` row it will eventually also touch.
          const holderPid = await getBackendPid(tx);
          box.consumeReservationPromise = prismaInventoryRepository.consumeReservation(
            orderId,
            product.id,
          );
          // Chat 3 Finding 1/2: correlates specifically to THIS holder's
          // backend pid AND requires the waiter to be running exactly
          // `consumeReservation`'s own raw product-row lock statement —
          // passing cannot be explained by an unrelated transaction
          // blocked by an unrelated holder, nor by some other statement
          // that happens to be blocked by this same holder.
          await waitUntilBackendIsBlockedBy(holderPid, PRODUCT_FOR_UPDATE_QUERY_PATTERN);
        },
      });

      try {
        const enableResult = await testRepository.setTrackInventory({
          productId: product.id,
          trackInventory: true,
          initialQuantity: 10,
          reason: "Initial stock count",
        });
        expect(enableResult.outcome).toBe("updated");
        if (enableResult.outcome !== "updated") throw new Error("unreachable");
        expect(enableResult.stockQuantity).toBe(10);

        if (!box.consumeReservationPromise) {
          throw new Error("the hook never fired — test is not exercising the intended window");
        }
        // The decisive assertion: this resolves at all (no deadlock error
        // was thrown by either side) and reports the reservation as
        // consumed against the now-fully-initialized stock.
        const consumeResult = await box.consumeReservationPromise;
        expect(consumeResult.outcome).toBe("consumed");
      } finally {
        // Chat 3 Finding 1: on EVERY path — success, an assertion above
        // throwing, or the holder's own transaction rolling back after
        // `waitUntilBackendIsBlockedBy` timed out inside the hook — the
        // holder's lock has already been released (committed or rolled
        // back) by the time control reaches here, so the competing call
        // has either already settled or is settling right now. Awaiting
        // it here (and swallowing any rejection) drains it on every
        // path, so it can never become a detached/unhandled rejection
        // surfacing after this test has already finished.
        await box.consumeReservationPromise?.catch(() => {});
      }

      const finalProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(finalProduct.stockQuantity).toBe(5); // 10 initialized - 5 consumed

      const reservation = await prisma.stockReservation.findUniqueOrThrow({
        where: { orderId_productId: { orderId, productId: product.id } },
      });
      expect(reservation.status).toBe("CONSUMED");
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

    // Chat 3 Finding 2 (MEDIUM) — root-cause fix for a SECOND, distinct
    // lock-order risk from the one already closed for `consumeReservation`:
    // this method's own per-item loop used to acquire each tracked item's
    // `stockReservation` row lock in whatever order the CALLER's own
    // `requiredItems` array happened to list them. Two concurrent calls
    // for the same order, sharing more than one tracked item but supplied
    // in different array orders by their own callers (e.g. a payment
    // resume racing a retry), could each come to hold one shared row's
    // lock while waiting on the other's — a genuine AB-BA cycle. The fix
    // canonicalizes the order (ascending by `productId`) before touching
    // any row, so every concurrent call now contends for the SAME first
    // resource regardless of its own caller's array order — eliminating
    // the cycle structurally, the same way `consumeReservation`'s own
    // fix did for the product-row lock. This test forces a real,
    // uncommitted call to hold the FIRST canonical item's lock, proves
    // via `pg_blocking_pids` that a second, real, unmodified concurrent
    // call — given the exact same two items in the OPPOSITE array order —
    // is genuinely blocked waiting for that same lock (never a deadlock),
    // then releases the holder and confirms both calls complete
    // successfully with a single, consistent final state.
    it("Chat 3 Finding 2 (MEDIUM): two concurrent securePaymentWindow calls for the same order, given the same two tracked items in opposite array orders, wait cleanly instead of risking an AB-BA deadlock", async () => {
      const productOne = await createTestProduct({ stockQuantity: 5 });
      const productTwo = await createTestProduct({ stockQuantity: 5 });
      const [firstId, secondId] = [productOne.id, productTwo.id].sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0,
      );

      const orderId = testOrderId();
      await prismaInventoryRepository.reserveStock({
        orderId,
        productId: firstId,
        quantity: 1,
        expiresAt: new Date(Date.now() + 60_000),
      });
      await prismaInventoryRepository.reserveStock({
        orderId,
        productId: secondId,
        quantity: 1,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const newExpiresAtA = new Date(Date.now() + 300_000);
      const newExpiresAtB = new Date(Date.now() + 600_000);

      const box: {
        callBPromise: Promise<
          Awaited<ReturnType<typeof prismaInventoryRepository.securePaymentWindow>>
        > | null;
      } = { callBPromise: null };

      const testRepository = createPrismaInventoryRepository({
        beforeSecurePaymentWindowItemTouch: async (tx, productId) => {
          // Only pause when about to touch the SECOND canonical item —
          // by then, call A has already locked and updated the FIRST
          // canonical item's row within this same still-open
          // transaction, which is the precondition the competing call
          // below needs to actually collide with.
          if (productId !== secondId) {
            return;
          }
          const holderPid = await getBackendPid(tx);
          // Call B supplies the exact same two items in the OPPOSITE
          // order to ITS OWN `requiredItems` — proving the fix does not
          // depend on either caller happening to agree on an order.
          box.callBPromise = prismaInventoryRepository.securePaymentWindow(
            orderId,
            [
              { productId: secondId, quantity: 1 },
              { productId: firstId, quantity: 1 },
            ],
            newExpiresAtB,
          );
          // Chat 3 Finding 2 (round 4): requires the waiter to be
          // running exactly the per-item `stockReservation` update
          // statement, not merely "something" blocked by this holder.
          await waitUntilBackendIsBlockedBy(
            holderPid,
            SECURE_PAYMENT_WINDOW_RESERVATION_UPDATE_QUERY_PATTERN,
          );
        },
      });

      try {
        const resultA = await testRepository.securePaymentWindow(
          orderId,
          [
            { productId: firstId, quantity: 1 },
            { productId: secondId, quantity: 1 },
          ],
          newExpiresAtA,
        );
        expect(resultA).toEqual({ ok: true });

        if (!box.callBPromise) {
          throw new Error("the hook never fired — test is not exercising the intended window");
        }
        // The decisive assertion: this resolves at all (no deadlock
        // error was thrown by either side).
        const resultB = await box.callBPromise;
        expect(resultB).toEqual({ ok: true });
      } finally {
        await box.callBPromise?.catch(() => {});
      }

      // Call A committed first (it held the first canonical item's lock
      // throughout); call B could only proceed once A released it, so
      // B's writes landed LAST for both items — a single, consistent
      // final state, never a mix of A's and B's values across the two
      // rows.
      const reservationFirst = await prisma.stockReservation.findUniqueOrThrow({
        where: { orderId_productId: { orderId, productId: firstId } },
      });
      const reservationSecond = await prisma.stockReservation.findUniqueOrThrow({
        where: { orderId_productId: { orderId, productId: secondId } },
      });
      expect(reservationFirst.expiresAt.getTime()).toBe(newExpiresAtB.getTime());
      expect(reservationSecond.expiresAt.getTime()).toBe(newExpiresAtB.getTime());
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

  // Chat 3 Finding 3 (MEDIUM): batched availability, proven to match
  // `getProductAvailability`'s own per-product calculation exactly.
  describe("getProductsAvailability", () => {
    it("matches getProductAvailability's own result for a tracked product with an active reservation", async () => {
      const product = await createTestProduct({ trackInventory: true, stockQuantity: 10 });
      await prismaInventoryRepository.reserveStock({
        orderId: testOrderId(),
        productId: product.id,
        quantity: 4,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const single = await prismaInventoryRepository.getProductAvailability(product.id);
      const batched = await prismaInventoryRepository.getProductsAvailability([product.id]);

      expect(batched.get(product.id)).toEqual(single);
      expect(batched.get(product.id)).toEqual({
        productId: product.id,
        trackInventory: true,
        stockQuantity: 10,
        reserved: 4,
        available: 6,
      });
    });

    it("matches getProductAvailability's own result for a tracked product whose only reservation has expired (reserved: 0)", async () => {
      const product = await createTestProduct({ trackInventory: true, stockQuantity: 10 });
      await prismaInventoryRepository.reserveStock({
        orderId: testOrderId(),
        productId: product.id,
        quantity: 4,
        expiresAt: new Date(Date.now() - 1), // already expired
      });

      const single = await prismaInventoryRepository.getProductAvailability(product.id);
      const batched = await prismaInventoryRepository.getProductsAvailability([product.id]);

      expect(batched.get(product.id)).toEqual(single);
      expect(batched.get(product.id)).toEqual({
        productId: product.id,
        trackInventory: true,
        stockQuantity: 10,
        reserved: 0,
        available: 10,
      });
    });

    it("matches getProductAvailability's own result for an untracked product (available: null)", async () => {
      const product = await createTestProduct({ trackInventory: false, stockQuantity: 7 });

      const single = await prismaInventoryRepository.getProductAvailability(product.id);
      const batched = await prismaInventoryRepository.getProductsAvailability([product.id]);

      expect(batched.get(product.id)).toEqual(single);
      expect(batched.get(product.id)).toEqual({
        productId: product.id,
        trackInventory: false,
        stockQuantity: 7,
        reserved: 0,
        available: null,
      });
    });

    it("batches multiple products in one call, each matching its own getProductAvailability result, and omits nonexistent ids entirely", async () => {
      const tracked = await createTestProduct({ trackInventory: true, stockQuantity: 20 });
      await prismaInventoryRepository.reserveStock({
        orderId: testOrderId(),
        productId: tracked.id,
        quantity: 5,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const untracked = await createTestProduct({ trackInventory: false, stockQuantity: 3 });

      const batched = await prismaInventoryRepository.getProductsAvailability([
        tracked.id,
        untracked.id,
        "does-not-exist",
      ]);

      expect(batched.size).toBe(2);
      expect(batched.get(tracked.id)).toEqual(
        await prismaInventoryRepository.getProductAvailability(tracked.id),
      );
      expect(batched.get(untracked.id)).toEqual(
        await prismaInventoryRepository.getProductAvailability(untracked.id),
      );
      expect(batched.has("does-not-exist")).toBe(false);
    });

    it("returns an empty map for an empty input, without querying", async () => {
      const batched = await prismaInventoryRepository.getProductsAvailability([]);
      expect(batched.size).toBe(0);
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

      it("Chat 3 Finding 1 (HIGH): requires a reason computed from the REAL, row-locked stock — not whatever a stale pre-check assumed — and writes nothing when it's missing", async () => {
        // Simulates the exact scenario Chat 3 flagged: a caller's own
        // pre-check reads `stockQuantity: 10`, sees `initialQuantity: 10`
        // matches it, and concludes no reason is needed — but a
        // DIFFERENT, concurrent write (any direct `adjustStock` call;
        // nothing requires `trackInventory` to be true for that) changes
        // the real on-hand count to 15 before this call ever acquires
        // its row lock. The ACTUAL delta is therefore -5, not 0.
        const product = await createTestProduct({ trackInventory: false, stockQuantity: 10 });
        await prisma.product.update({ where: { id: product.id }, data: { stockQuantity: 15 } });

        const result = await prismaInventoryRepository.setTrackInventory({
          productId: product.id,
          trackInventory: true,
          initialQuantity: 10, // matches the STALE read of 10, not the real 15
          // no reason supplied — exactly what a caller relying on the
          // stale pre-check would have omitted
        });

        expect(result).toEqual({ outcome: "reasonRequired" });

        // Nothing was written: not the flag, not the stock, no audit row.
        const availability = await prismaInventoryRepository.getProductAvailability(product.id);
        expect(availability?.trackInventory).toBe(false);
        expect(availability?.stockQuantity).toBe(15);

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
          reason: "test",
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
          reason: "test",
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
          reason: "test",
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

      // Chat 3 Finding 2 (MEDIUM) mitigation: `setTrackInventory`'s
      // bounded retry on recognized, retryable Postgres errors.
      // `beforeInitialStockAdjustmentInsert` is reused here purely as an
      // injection point for a *simulated* error of the exact shape
      // directly observed by reproducing the real deadlock (see this
      // file's own "lock order" analysis above and this round's report)
      // — it is not re-proving the deadlock itself, only this method's
      // own reaction to that specific, recognized failure mode.
      describe("bounded retry on a recognized deadlock/serialization error", () => {
        it("retries up to the bound and succeeds once the error stops recurring, committing exactly once", async () => {
          const product = await createTestProduct({ trackInventory: false, stockQuantity: 0 });
          let attempts = 0;
          const testRepository = createPrismaInventoryRepository({
            beforeInitialStockAdjustmentInsert: async () => {
              attempts += 1;
              if (attempts < 3) {
                throw makeDeadlockError();
              }
            },
          });

          const result = await testRepository.setTrackInventory({
            productId: product.id,
            trackInventory: true,
            initialQuantity: 10,
            reason: "test",
          });

          expect(result.outcome).toBe("updated");
          expect(attempts).toBe(3);

          // Each retried attempt re-runs the whole transaction from
          // scratch; the two that threw rolled back entirely (no
          // partial writes to accumulate), so only the attempt that
          // actually committed leaves exactly one audit row behind.
          const history = await prismaInventoryRepository.listStockAdjustments({
            filter: { productId: product.id },
            page: 1,
            pageSize: 10,
          });
          expect(history.total).toBe(1);
        });

        it("never retries an error that is not one of the two recognized, retryable codes", async () => {
          const product = await createTestProduct({ trackInventory: false, stockQuantity: 0 });
          let attempts = 0;
          const testRepository = createPrismaInventoryRepository({
            beforeInitialStockAdjustmentInsert: async () => {
              attempts += 1;
              throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
                code: "P2002",
                clientVersion: "test",
              });
            },
          });

          await expect(
            testRepository.setTrackInventory({
              productId: product.id,
              trackInventory: true,
              initialQuantity: 10,
              reason: "test",
            }),
          ).rejects.toThrow("Unique constraint failed");
          expect(attempts).toBe(1);
        });

        it("gives up and propagates the error once the retry bound is exhausted", async () => {
          const product = await createTestProduct({ trackInventory: false, stockQuantity: 0 });
          let attempts = 0;
          const testRepository = createPrismaInventoryRepository({
            beforeInitialStockAdjustmentInsert: async () => {
              attempts += 1;
              throw makeDeadlockError();
            },
          });

          await expect(
            testRepository.setTrackInventory({
              productId: product.id,
              trackInventory: true,
              initialQuantity: 10,
              reason: "test",
            }),
          ).rejects.toThrow(/40P01/);
          expect(attempts).toBe(3);

          const availability = await prismaInventoryRepository.getProductAvailability(product.id);
          expect(availability?.trackInventory).toBe(false);
        });

        // Chat 3 Finding 4 (LOW): the top-level Prisma error code that
        // wraps a `40P01` is not stable (see `makeDeadlockError`'s own
        // doc comment for the direct reproduction proving this) — the
        // retry helper must key off the structured
        // `meta.driverAdapterError.cause.originalCode` field, not the
        // top-level `.code`, so it retries correctly no matter which
        // Prisma code happened to wrap this particular occurrence.
        it('retries a deadlock wrapped as P2010 ("Raw query failed") exactly the same as one wrapped as P2039 ("Database error")', async () => {
          const product = await createTestProduct({ trackInventory: false, stockQuantity: 0 });
          let attempts = 0;
          const testRepository = createPrismaInventoryRepository({
            beforeInitialStockAdjustmentInsert: async () => {
              attempts += 1;
              if (attempts < 2) {
                throw makeDeadlockError({ prismaCode: "P2010" });
              }
            },
          });

          const result = await testRepository.setTrackInventory({
            productId: product.id,
            trackInventory: true,
            initialQuantity: 10,
            reason: "test",
          });
          expect(result.outcome).toBe("updated");
          expect(attempts).toBe(2);
        });

        // Chat 3 Finding 4 (LOW): proves the structured field is checked
        // FIRST and takes precedence — an error whose structured code is
        // a non-retryable one (a unique-constraint violation) must never
        // be retried, even though nothing here claims its message text
        // avoids the substring "40P01"; this specifically guards against
        // a future regression where someone reverts to message-only
        // matching and a coincidental substring match causes a wrong
        // retry.
        it("never retries a non-retryable error, judged by its structured code, regardless of any coincidental message text", async () => {
          const product = await createTestProduct({ trackInventory: false, stockQuantity: 0 });
          let attempts = 0;
          const testRepository = createPrismaInventoryRepository({
            beforeInitialStockAdjustmentInsert: async () => {
              attempts += 1;
              throw new Prisma.PrismaClientKnownRequestError(
                "Unique constraint failed on fields mentioning 40P01 only incidentally",
                {
                  code: "P2002",
                  clientVersion: "test",
                  meta: {
                    driverAdapterError: {
                      name: "DriverAdapterError",
                      cause: { originalCode: "23505", originalMessage: "duplicate key value" },
                    },
                  },
                },
              );
            },
          });

          await expect(
            testRepository.setTrackInventory({
              productId: product.id,
              trackInventory: true,
              initialQuantity: 10,
              reason: "test",
            }),
          ).rejects.toThrow("Unique constraint failed");
          expect(attempts).toBe(1);
        });

        // Chat 3 Finding 4 (LOW): the fallback path — kept for the case
        // (not observed in this project's own reproduction, but not
        // provably impossible on some future Prisma/adapter version)
        // where `meta.driverAdapterError` is absent entirely. Confirms
        // the helper still recognizes a retryable error purely from its
        // message text when the structured field cannot be read at all.
        it("falls back to the message-text check when the structured driver-adapter field is absent", async () => {
          const product = await createTestProduct({ trackInventory: false, stockQuantity: 0 });
          let attempts = 0;
          const testRepository = createPrismaInventoryRepository({
            beforeInitialStockAdjustmentInsert: async () => {
              attempts += 1;
              if (attempts < 2) {
                throw new Prisma.PrismaClientKnownRequestError(
                  "Database error. Code: `40P01`. Message: `deadlock detected`",
                  { code: "P2039", clientVersion: "test" }, // no `meta` at all
                );
              }
            },
          });

          const result = await testRepository.setTrackInventory({
            productId: product.id,
            trackInventory: true,
            initialQuantity: 10,
            reason: "test",
          });
          expect(result.outcome).toBe("updated");
          expect(attempts).toBe(2);
        });
      });

      it("a concurrent reserveStock call can never observe trackInventory=true paired with the pre-initialization stock — it is blocked by the same row lock until the enabling transaction commits", async () => {
        const product = await createTestProduct({ trackInventory: false, stockQuantity: 0 });
        const orderId = testOrderId();

        const box: { reserveStockPromise: Promise<ReserveStockResult> | null } = {
          reserveStockPromise: null,
        };

        const testRepository = createPrismaInventoryRepository({
          beforeInitialStockAdjustmentInsert: async (tx) => {
            // At this exact point, inside the still-open enabling
            // transaction, the product row's `trackInventory`/
            // `stockQuantity` have already been written but NOT yet
            // committed — and the row is still locked (`FOR UPDATE`) by
            // this same transaction. Firing a real, unmodified
            // `reserveStock` call here — on the shared production
            // repository, a separate connection — and NOT awaiting it
            // yet proves it cannot proceed past its own `FOR UPDATE`
            // read until this transaction ends.
            const holderPid = await getBackendPid(tx);
            box.reserveStockPromise = prismaInventoryRepository.reserveStock({
              orderId,
              productId: product.id,
              quantity: 20,
              expiresAt: new Date(Date.now() + 60_000),
            });
            // Chat 3 Finding 1/2: proves, via Postgres's own
            // `pg_blocking_pids`, that the call above is blocked
            // SPECIFICALLY by this transaction's own backend, AND that
            // it is running exactly `reserveStock`'s own raw
            // product-row lock statement — not a fixed sleep, not
            // merely "something, somewhere is waiting," and not some
            // other statement that happens to be blocked by this same
            // holder. This transaction's own commit (immediately after
            // this hook returns) is therefore provably what unblocks
            // it, not a lucky timing guess or an unrelated
            // transaction's unrelated lock.
            await waitUntilBackendIsBlockedBy(holderPid, PRODUCT_FOR_UPDATE_QUERY_PATTERN);
          },
        });

        try {
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
        } finally {
          // Chat 3 Finding 1: drains the competing promise on every
          // path (success, an assertion throwing, or a hook timeout
          // that rolled the holder back) so it can never become a
          // detached/unhandled rejection — see the sibling
          // `consumeReservation` test's own comment for the full
          // reasoning, identical here.
          await box.reserveStockPromise?.catch(() => {});
        }

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
