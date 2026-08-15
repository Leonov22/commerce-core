import { describe, expect, it } from "vitest";
import { changeOrderStatus } from "@/modules/order/application/order-status";
import type { OrderRepository } from "@/modules/order/repositories/order-repository";
import type { Order, OrderStatus } from "@/modules/order/domain/order";

/**
 * Pure application-layer tests: `OrderRepository` is injected, so a fake
 * (in-memory) store is used — mirrors `checkout-order.test.ts`'s pattern.
 * The fake's `updateStatusIfCurrent` genuinely implements conditional
 * semantics (checks the "real" current status before applying, exactly
 * like the real Prisma `updateMany` WHERE clause) rather than always
 * succeeding — otherwise these tests couldn't actually exercise
 * `ORDER_STATUS_CHANGED` at all. Real conditional-update behavior against
 * a real Postgres row (and the genuine concurrency race) is covered
 * separately in `prisma-order-repository.test.ts`.
 */
function makeFakeRepository(
  seedStatus: OrderStatus,
  options: { actualCurrentStatus?: OrderStatus } = {},
): {
  repository: OrderRepository;
  updateStatusIfCurrentCalls: {
    orderId: string;
    expectedStatus: OrderStatus;
    nextStatus: OrderStatus;
  }[];
} {
  const now = new Date();
  // `readStatus` is what `findById` reports, simulating a read that
  // already happened. `currentStatus` is the "real" underlying status at
  // write time — these only differ in the race-simulation test, where
  // another caller has already moved the row between the read and the
  // write `changeOrderStatus` performs.
  const readStatus = seedStatus;
  let currentStatus = options.actualCurrentStatus ?? seedStatus;

  let order: Order = {
    id: "order-1",
    status: readStatus,
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    phone: "+1234567890",
    userId: null,
    subtotalAmountMinor: 1000,
    deliveryAmountMinor: 0,
    totalAmountMinor: 1000,
    currency: "USD",
    createdAt: now,
    updatedAt: now,
    items: [],
  };
  const updateStatusIfCurrentCalls: {
    orderId: string;
    expectedStatus: OrderStatus;
    nextStatus: OrderStatus;
  }[] = [];

  const repository: OrderRepository = {
    async create(): Promise<Order> {
      throw new Error("not used by these tests");
    },
    async findManyByUserId() {
      throw new Error("not used by these tests");
    },
    async findByIdForUser() {
      throw new Error("not used by these tests");
    },
    async findById(orderId: string): Promise<Order | null> {
      return orderId === order.id ? { ...order, status: readStatus } : null;
    },
    async updateStatusIfCurrent(
      orderId: string,
      expectedStatus: OrderStatus,
      nextStatus: OrderStatus,
    ): Promise<Order | null> {
      updateStatusIfCurrentCalls.push({ orderId, expectedStatus, nextStatus });
      // Mirrors the real repository's `WHERE id = ? AND status = ?`
      // condition: only applies when the *current* status still matches.
      if (currentStatus !== expectedStatus) {
        return null;
      }
      currentStatus = nextStatus;
      order = { ...order, status: currentStatus };
      return order;
    },
    async createIdempotent(): Promise<never> {
      throw new Error("not used by these tests");
    },
  };

  return { repository, updateStatusIfCurrentCalls };
}

describe("changeOrderStatus", () => {
  it("succeeds for PENDING -> PAID", async () => {
    const { repository, updateStatusIfCurrentCalls } = makeFakeRepository("PENDING");

    const result = await changeOrderStatus(repository, "order-1", "PAID");

    expect(result).toEqual({ ok: true, order: expect.objectContaining({ status: "PAID" }) });
    expect(updateStatusIfCurrentCalls).toEqual([
      { orderId: "order-1", expectedStatus: "PENDING", nextStatus: "PAID" },
    ]);
  });

  it("succeeds for PENDING -> CANCELLED", async () => {
    const { repository, updateStatusIfCurrentCalls } = makeFakeRepository("PENDING");

    const result = await changeOrderStatus(repository, "order-1", "CANCELLED");

    expect(result).toEqual({ ok: true, order: expect.objectContaining({ status: "CANCELLED" }) });
    expect(updateStatusIfCurrentCalls).toEqual([
      { orderId: "order-1", expectedStatus: "PENDING", nextStatus: "CANCELLED" },
    ]);
  });

  it("rejects PAID -> PENDING with INVALID_STATUS_TRANSITION, and never calls updateStatusIfCurrent", async () => {
    const { repository, updateStatusIfCurrentCalls } = makeFakeRepository("PAID");

    const result = await changeOrderStatus(repository, "order-1", "PENDING");

    expect(result).toEqual({ ok: false, error: "INVALID_STATUS_TRANSITION" });
    expect(updateStatusIfCurrentCalls).toHaveLength(0);
  });

  it("rejects PAID -> CANCELLED with INVALID_STATUS_TRANSITION", async () => {
    const { repository, updateStatusIfCurrentCalls } = makeFakeRepository("PAID");

    const result = await changeOrderStatus(repository, "order-1", "CANCELLED");

    expect(result).toEqual({ ok: false, error: "INVALID_STATUS_TRANSITION" });
    expect(updateStatusIfCurrentCalls).toHaveLength(0);
  });

  it("rejects CANCELLED -> PENDING with INVALID_STATUS_TRANSITION", async () => {
    const { repository, updateStatusIfCurrentCalls } = makeFakeRepository("CANCELLED");

    const result = await changeOrderStatus(repository, "order-1", "PENDING");

    expect(result).toEqual({ ok: false, error: "INVALID_STATUS_TRANSITION" });
    expect(updateStatusIfCurrentCalls).toHaveLength(0);
  });

  it("rejects CANCELLED -> PAID with INVALID_STATUS_TRANSITION", async () => {
    const { repository, updateStatusIfCurrentCalls } = makeFakeRepository("CANCELLED");

    const result = await changeOrderStatus(repository, "order-1", "PAID");

    expect(result).toEqual({ ok: false, error: "INVALID_STATUS_TRANSITION" });
    expect(updateStatusIfCurrentCalls).toHaveLength(0);
  });

  it("rejects no-op transitions (PENDING -> PENDING, PAID -> PAID, CANCELLED -> CANCELLED) with INVALID_STATUS_TRANSITION", async () => {
    for (const status of ["PENDING", "PAID", "CANCELLED"] as const) {
      const { repository, updateStatusIfCurrentCalls } = makeFakeRepository(status);

      const result = await changeOrderStatus(repository, "order-1", status);

      expect(result).toEqual({ ok: false, error: "INVALID_STATUS_TRANSITION" });
      expect(updateStatusIfCurrentCalls).toHaveLength(0);
    }
  });

  it("returns ORDER_NOT_FOUND for a nonexistent order, and never calls updateStatusIfCurrent", async () => {
    const { repository, updateStatusIfCurrentCalls } = makeFakeRepository("PENDING");

    const result = await changeOrderStatus(repository, "nonexistent-order-id", "PAID");

    expect(result).toEqual({ ok: false, error: "ORDER_NOT_FOUND" });
    expect(updateStatusIfCurrentCalls).toHaveLength(0);
  });

  it("CR-030: returns ORDER_STATUS_CHANGED when another caller already changed the status between the read and the conditional write", async () => {
    // Simulates the exact QA-030-01 race: this call reads a stale PENDING
    // (`seedStatus`), which validates a PENDING -> CANCELLED transition —
    // but the "real" underlying status has already moved to PAID by the
    // time the conditional write runs.
    const { repository, updateStatusIfCurrentCalls } = makeFakeRepository("PENDING", {
      actualCurrentStatus: "PAID",
    });

    const result = await changeOrderStatus(repository, "order-1", "CANCELLED");

    expect(result).toEqual({ ok: false, error: "ORDER_STATUS_CHANGED" });
    // The conditional write was still attempted (with the stale expected
    // status) — it just correctly failed to apply, exactly as the real
    // `updateMany` WHERE clause would.
    expect(updateStatusIfCurrentCalls).toEqual([
      { orderId: "order-1", expectedStatus: "PENDING", nextStatus: "CANCELLED" },
    ]);
  });
});
