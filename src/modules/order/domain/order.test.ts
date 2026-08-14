import { describe, expect, it } from "vitest";
import { isValidOrderStatusTransition } from "@/modules/order/domain/order";

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
