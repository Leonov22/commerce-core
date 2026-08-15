import { describe, expect, it } from "vitest";
import {
  getCustomerOrders,
  getCustomerOrder,
  CUSTOMER_ORDERS_PAGE_SIZE,
} from "@/modules/order/application/customer-orders";
import type {
  OrderRepository,
  FindManyByUserIdOptions,
  OrderListPage,
} from "@/modules/order/repositories/order-repository";
import type { Order } from "@/modules/order/domain/order";

/**
 * Pure application-layer tests: `OrderRepository` is injected, so a fake is
 * used and nothing is persisted — mirrors `checkout-order.test.ts`'s
 * pattern. Real ownership enforcement (the actual security boundary) is
 * covered separately in `prisma-order-repository.test.ts`'s IDOR tests,
 * since it lives in the repository's query, not in this thin layer.
 */
function makeFakeRepository(): {
  repository: OrderRepository;
  findManyCalls: { userId: string; options: FindManyByUserIdOptions }[];
  findByIdCalls: { orderId: string; userId: string }[];
} {
  const findManyCalls: { userId: string; options: FindManyByUserIdOptions }[] = [];
  const findByIdCalls: { orderId: string; userId: string }[] = [];

  const repository: OrderRepository = {
    async create(): Promise<Order> {
      throw new Error("not used by these tests");
    },
    async findManyByUserId(userId, options): Promise<OrderListPage> {
      findManyCalls.push({ userId, options });
      return { orders: [], nextCursor: null };
    },
    async findByIdForUser(orderId, userId): Promise<Order | null> {
      findByIdCalls.push({ orderId, userId });
      return null;
    },
    // Not exercised by this file's tests (order lifecycle, IMP-030) —
    // present only to satisfy `OrderRepository`'s shape.
    async findById(): Promise<Order | null> {
      throw new Error("not used by these tests");
    },
    async updateStatusIfCurrent(): Promise<Order | null> {
      throw new Error("not used by these tests");
    },
  };

  return { repository, findManyCalls, findByIdCalls };
}

describe("getCustomerOrders", () => {
  it("delegates to the repository with the given userId, cursor, and the fixed page size", async () => {
    const { repository, findManyCalls } = makeFakeRepository();

    await getCustomerOrders(repository, "user-1", "cursor-abc");

    expect(findManyCalls).toEqual([
      { userId: "user-1", options: { cursor: "cursor-abc", take: CUSTOMER_ORDERS_PAGE_SIZE } },
    ]);
  });

  it("omits the cursor for the first page", async () => {
    const { repository, findManyCalls } = makeFakeRepository();

    await getCustomerOrders(repository, "user-1");

    expect(findManyCalls[0]?.options.cursor).toBeUndefined();
    expect(findManyCalls[0]?.options.take).toBe(CUSTOMER_ORDERS_PAGE_SIZE);
  });
});

describe("getCustomerOrder", () => {
  it("delegates to the repository's ownership-filtered lookup", async () => {
    const { repository, findByIdCalls } = makeFakeRepository();

    await getCustomerOrder(repository, "user-1", "order-1");

    expect(findByIdCalls).toEqual([{ orderId: "order-1", userId: "user-1" }]);
  });
});
