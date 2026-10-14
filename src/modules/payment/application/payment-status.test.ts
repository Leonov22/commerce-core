import { describe, expect, it } from "vitest";
import { changePaymentStatus } from "@/modules/payment/application/payment-status";
import type { PaymentRepository } from "@/modules/payment/repositories/payment-repository";
import type { Payment, PaymentStatus } from "@/modules/payment/domain/payment";

/**
 * Pure application-layer tests, mirroring
 * `@/modules/order/application/order-status.test.ts`'s exact pattern: a
 * fake `PaymentRepository` whose `updateStatusIfCurrent` genuinely
 * implements conditional semantics (checks the "real" current status
 * before applying), so `PAYMENT_STATUS_CHANGED` can actually be exercised.
 * Real conditional-update behavior against a real Postgres row is covered
 * separately in `prisma-payment-repository.test.ts`.
 */
function makeFakeRepository(
  seedStatus: PaymentStatus,
  options: { actualCurrentStatus?: PaymentStatus } = {},
): {
  repository: PaymentRepository;
  updateStatusIfCurrentCalls: {
    paymentId: string;
    expectedStatus: PaymentStatus;
    nextStatus: PaymentStatus;
  }[];
} {
  const now = new Date();
  const readStatus = seedStatus;
  let currentStatus = options.actualCurrentStatus ?? seedStatus;

  let payment: Payment = {
    id: "payment-1",
    orderId: "order-1",
    status: readStatus,
    amountMinor: 1000,
    currency: "USD",
    providerReference: null,
    providerStartAttemptedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const updateStatusIfCurrentCalls: {
    paymentId: string;
    expectedStatus: PaymentStatus;
    nextStatus: PaymentStatus;
  }[] = [];

  const repository: PaymentRepository = {
    async create(): Promise<never> {
      throw new Error("not used by these tests");
    },
    async findById(paymentId: string): Promise<Payment | null> {
      return paymentId === payment.id ? { ...payment, status: readStatus } : null;
    },
    async findByOrderId() {
      throw new Error("not used by these tests");
    },
    async updateStatusIfCurrent(
      paymentId: string,
      expectedStatus: PaymentStatus,
      nextStatus: PaymentStatus,
    ): Promise<Payment | null> {
      updateStatusIfCurrentCalls.push({ paymentId, expectedStatus, nextStatus });
      // Mirrors the real repository's `WHERE id = ? AND status = ?`
      // condition: only applies when the *current* status still matches.
      if (currentStatus !== expectedStatus) {
        return null;
      }
      currentStatus = nextStatus;
      payment = { ...payment, status: currentStatus };
      return payment;
    },
    async setProviderReferenceIfPending() {
      throw new Error("not used by these tests");
    },
    async claimProviderStartAttempt() {
      throw new Error("not used by these tests");
    },
    async findByProviderReference() {
      throw new Error("not used by these tests");
    },
  };

  return { repository, updateStatusIfCurrentCalls };
}

describe("changePaymentStatus", () => {
  it("succeeds for PENDING -> SUCCEEDED", async () => {
    const { repository, updateStatusIfCurrentCalls } = makeFakeRepository("PENDING");

    const result = await changePaymentStatus(repository, "payment-1", "SUCCEEDED");

    expect(result).toEqual({ ok: true, payment: expect.objectContaining({ status: "SUCCEEDED" }) });
    expect(updateStatusIfCurrentCalls).toEqual([
      { paymentId: "payment-1", expectedStatus: "PENDING", nextStatus: "SUCCEEDED" },
    ]);
  });

  it("succeeds for PENDING -> FAILED", async () => {
    const { repository } = makeFakeRepository("PENDING");

    const result = await changePaymentStatus(repository, "payment-1", "FAILED");

    expect(result).toEqual({ ok: true, payment: expect.objectContaining({ status: "FAILED" }) });
  });

  it("succeeds for PENDING -> CANCELLED", async () => {
    const { repository } = makeFakeRepository("PENDING");

    const result = await changePaymentStatus(repository, "payment-1", "CANCELLED");

    expect(result).toEqual({ ok: true, payment: expect.objectContaining({ status: "CANCELLED" }) });
  });

  it("rejects any transition out of a terminal status with INVALID_STATUS_TRANSITION, and never calls updateStatusIfCurrent", async () => {
    for (const from of ["SUCCEEDED", "FAILED", "CANCELLED"] as const) {
      for (const to of ["PENDING", "SUCCEEDED", "FAILED", "CANCELLED"] as const) {
        const { repository, updateStatusIfCurrentCalls } = makeFakeRepository(from);

        const result = await changePaymentStatus(repository, "payment-1", to);

        expect(result).toEqual({ ok: false, error: "INVALID_STATUS_TRANSITION" });
        expect(updateStatusIfCurrentCalls).toHaveLength(0);
      }
    }
  });

  it("returns PAYMENT_NOT_FOUND for a nonexistent payment, and never calls updateStatusIfCurrent", async () => {
    const { repository, updateStatusIfCurrentCalls } = makeFakeRepository("PENDING");

    const result = await changePaymentStatus(repository, "nonexistent-payment-id", "SUCCEEDED");

    expect(result).toEqual({ ok: false, error: "PAYMENT_NOT_FOUND" });
    expect(updateStatusIfCurrentCalls).toHaveLength(0);
  });

  it("returns PAYMENT_STATUS_CHANGED when another caller already changed the status between the read and the conditional write", async () => {
    const { repository, updateStatusIfCurrentCalls } = makeFakeRepository("PENDING", {
      actualCurrentStatus: "FAILED",
    });

    const result = await changePaymentStatus(repository, "payment-1", "SUCCEEDED");

    expect(result).toEqual({ ok: false, error: "PAYMENT_STATUS_CHANGED" });
    expect(updateStatusIfCurrentCalls).toEqual([
      { paymentId: "payment-1", expectedStatus: "PENDING", nextStatus: "SUCCEEDED" },
    ]);
  });
});
