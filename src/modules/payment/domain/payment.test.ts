import { describe, expect, it } from "vitest";
import { isValidPaymentStatusTransition } from "@/modules/payment/domain/payment";
import type { PaymentStatus } from "@/modules/payment/domain/payment";

const ALL_STATUSES: PaymentStatus[] = ["PENDING", "SUCCEEDED", "FAILED", "CANCELLED"];

describe("isValidPaymentStatusTransition", () => {
  it("allows PENDING -> SUCCEEDED", () => {
    expect(isValidPaymentStatusTransition("PENDING", "SUCCEEDED")).toBe(true);
  });

  it("allows PENDING -> FAILED", () => {
    expect(isValidPaymentStatusTransition("PENDING", "FAILED")).toBe(true);
  });

  it("allows PENDING -> CANCELLED", () => {
    expect(isValidPaymentStatusTransition("PENDING", "CANCELLED")).toBe(true);
  });

  it("rejects the PENDING -> PENDING no-op", () => {
    expect(isValidPaymentStatusTransition("PENDING", "PENDING")).toBe(false);
  });

  describe("terminal states have no outgoing transition", () => {
    const terminalStatuses: PaymentStatus[] = ["SUCCEEDED", "FAILED", "CANCELLED"];

    for (const from of terminalStatuses) {
      for (const to of ALL_STATUSES) {
        it(`rejects ${from} -> ${to}`, () => {
          expect(isValidPaymentStatusTransition(from, to)).toBe(false);
        });
      }
    }
  });

  it("rejects a cross-terminal transition (SUCCEEDED -> FAILED)", () => {
    expect(isValidPaymentStatusTransition("SUCCEEDED", "FAILED")).toBe(false);
  });

  it("rejects a cross-terminal transition (FAILED -> CANCELLED)", () => {
    expect(isValidPaymentStatusTransition("FAILED", "CANCELLED")).toBe(false);
  });
});
