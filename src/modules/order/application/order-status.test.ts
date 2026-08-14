import { describe, expect, it } from "vitest";
import { changeOrderStatus } from "@/modules/order/application/order-status";
import type { OrderRepository } from "@/modules/order/repositories/order-repository";
import type { Order, OrderStatus } from "@/modules/order/domain/order";

/**
 * Pure application-layer tests: `OrderRepository` is injected, so a fake
 * (in-memory) store is used — mirrors `checkout-order.test.ts`'s pattern.
 * Real transition enforcement against a real Postgres row is covered
 * separately in `prisma-order-repository.test.ts`.
 */
function makeFakeRepository(seedStatus: OrderStatus): {
  repository: OrderRepository;
  updateStatusCalls: { orderId: string; status: OrderStatus }[];
} {
  const now = new Date();
  let order: Order = {
    id: "order-1",
    status: seedStatus,
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
  const updateStatusCalls: { orderId: string; status: OrderStatus }[] = [];

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
      return orderId === order.id ? order : null;
    },
    async updateStatus(orderId: string, status: OrderStatus): Promise<Order> {
      updateStatusCalls.push({ orderId, status });
      order = { ...order, status };
      return order;
    },
  };

  return { repository, updateStatusCalls };
}

describe("changeOrderStatus", () => {
  it("succeeds for PENDING -> PAID", async () => {
    const { repository, updateStatusCalls } = makeFakeRepository("PENDING");

    const result = await changeOrderStatus(repository, "order-1", "PAID");

    expect(result).toEqual({ ok: true, order: expect.objectContaining({ status: "PAID" }) });
    expect(updateStatusCalls).toEqual([{ orderId: "order-1", status: "PAID" }]);
  });

  it("succeeds for PENDING -> CANCELLED", async () => {
    const { repository, updateStatusCalls } = makeFakeRepository("PENDING");

    const result = await changeOrderStatus(repository, "order-1", "CANCELLED");

    expect(result).toEqual({ ok: true, order: expect.objectContaining({ status: "CANCELLED" }) });
    expect(updateStatusCalls).toEqual([{ orderId: "order-1", status: "CANCELLED" }]);
  });

  it("rejects PAID -> PENDING with INVALID_STATUS_TRANSITION, and never calls updateStatus", async () => {
    const { repository, updateStatusCalls } = makeFakeRepository("PAID");

    const result = await changeOrderStatus(repository, "order-1", "PENDING");

    expect(result).toEqual({ ok: false, error: "INVALID_STATUS_TRANSITION" });
    expect(updateStatusCalls).toHaveLength(0);
  });

  it("rejects PAID -> CANCELLED with INVALID_STATUS_TRANSITION", async () => {
    const { repository, updateStatusCalls } = makeFakeRepository("PAID");

    const result = await changeOrderStatus(repository, "order-1", "CANCELLED");

    expect(result).toEqual({ ok: false, error: "INVALID_STATUS_TRANSITION" });
    expect(updateStatusCalls).toHaveLength(0);
  });

  it("rejects CANCELLED -> PENDING with INVALID_STATUS_TRANSITION", async () => {
    const { repository, updateStatusCalls } = makeFakeRepository("CANCELLED");

    const result = await changeOrderStatus(repository, "order-1", "PENDING");

    expect(result).toEqual({ ok: false, error: "INVALID_STATUS_TRANSITION" });
    expect(updateStatusCalls).toHaveLength(0);
  });

  it("rejects CANCELLED -> PAID with INVALID_STATUS_TRANSITION", async () => {
    const { repository, updateStatusCalls } = makeFakeRepository("CANCELLED");

    const result = await changeOrderStatus(repository, "order-1", "PAID");

    expect(result).toEqual({ ok: false, error: "INVALID_STATUS_TRANSITION" });
    expect(updateStatusCalls).toHaveLength(0);
  });

  it("returns ORDER_NOT_FOUND for a nonexistent order, and never calls updateStatus", async () => {
    const { repository, updateStatusCalls } = makeFakeRepository("PENDING");

    const result = await changeOrderStatus(repository, "nonexistent-order-id", "PAID");

    expect(result).toEqual({ ok: false, error: "ORDER_NOT_FOUND" });
    expect(updateStatusCalls).toHaveLength(0);
  });
});
