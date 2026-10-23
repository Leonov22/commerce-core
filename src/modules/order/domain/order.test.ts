import { describe, expect, it } from "vitest";
import {
  isValidOrderStatusTransition,
  calculateOrderDiscountAmountMinor,
} from "@/modules/order/domain/order";
import type { OrderItem } from "@/modules/order/domain/order";

describe("isValidOrderStatusTransition", () => {
  it("allows PENDING -> PAID", () => {
    expect(isValidOrderStatusTransition("PENDING", "PAID")).toBe(true);
  });

  it("allows PENDING -> CANCELLED", () => {
    expect(isValidOrderStatusTransition("PENDING", "CANCELLED")).toBe(true);
  });

  it("forbids PAID -> PENDING", () => {
    expect(isValidOrderStatusTransition("PAID", "PENDING")).toBe(false);
  });

  it("forbids PAID -> CANCELLED", () => {
    expect(isValidOrderStatusTransition("PAID", "CANCELLED")).toBe(false);
  });

  it("forbids CANCELLED -> PENDING", () => {
    expect(isValidOrderStatusTransition("CANCELLED", "PENDING")).toBe(false);
  });

  it("forbids CANCELLED -> PAID", () => {
    expect(isValidOrderStatusTransition("CANCELLED", "PAID")).toBe(false);
  });

  it("treats PAID and CANCELLED as terminal — no outgoing transition at all, including to the same status", () => {
    expect(isValidOrderStatusTransition("PAID", "PAID")).toBe(false);
    expect(isValidOrderStatusTransition("CANCELLED", "CANCELLED")).toBe(false);
  });

  it("forbids a no-op PENDING -> PENDING transition", () => {
    expect(isValidOrderStatusTransition("PENDING", "PENDING")).toBe(false);
  });
});

function makeOrderItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: "item-1",
    orderId: "order-1",
    productId: "1",
    productName: "Studio Chair",
    regularUnitPriceAmountMinor: 22000,
    unitPriceAmountMinor: 22000,
    quantity: 1,
    lineTotalAmountMinor: 22000,
    currency: "EUR",
    ...overrides,
  };
}

describe("calculateOrderDiscountAmountMinor", () => {
  it("is zero when no line was discounted", () => {
    const items = [
      makeOrderItem({ regularUnitPriceAmountMinor: 22000, unitPriceAmountMinor: 22000 }),
    ];
    expect(calculateOrderDiscountAmountMinor(items)).toBe(0);
  });

  it("computes the discount for a single discounted line — the Studio Chair €220 -> €187 scenario", () => {
    const items = [
      makeOrderItem({
        regularUnitPriceAmountMinor: 22000,
        unitPriceAmountMinor: 18700,
        quantity: 1,
      }),
    ];
    expect(calculateOrderDiscountAmountMinor(items)).toBe(3300);
  });

  it("scales a discounted line's total by quantity", () => {
    const items = [
      makeOrderItem({
        regularUnitPriceAmountMinor: 22000,
        unitPriceAmountMinor: 18700,
        quantity: 3,
      }),
    ];
    expect(calculateOrderDiscountAmountMinor(items)).toBe(3300 * 3);
  });

  it("sums the discount across multiple lines, including undiscounted ones contributing zero", () => {
    const items = [
      makeOrderItem({
        id: "item-1",
        regularUnitPriceAmountMinor: 22000,
        unitPriceAmountMinor: 18700,
        quantity: 1,
      }),
      makeOrderItem({
        id: "item-2",
        regularUnitPriceAmountMinor: 4500,
        unitPriceAmountMinor: 4500,
        quantity: 2,
      }),
    ];
    expect(calculateOrderDiscountAmountMinor(items)).toBe(3300);
  });

  it("returns zero for an order with no items", () => {
    expect(calculateOrderDiscountAmountMinor([])).toBe(0);
  });
});
