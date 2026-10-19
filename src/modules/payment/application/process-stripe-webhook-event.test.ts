import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { processStripeWebhookEvent } from "@/modules/payment/application/process-stripe-webhook-event";
import type { ChangeOrderStatusFn } from "@/modules/payment/application/process-stripe-webhook-event";
import type { PaymentRepository } from "@/modules/payment/repositories/payment-repository";
import type {
  PaymentWebhookEventRepository,
  NewPaymentWebhookEventInput,
} from "@/modules/payment/repositories/payment-webhook-event-repository";
import type {
  VerifyStripeWebhookResult,
  StripeWebhookEvent,
} from "@/modules/payment/providers/stripe-webhook";
import type { Payment, PaymentStatus } from "@/modules/payment/domain/payment";
import { prismaPaymentRepository } from "@/modules/payment/infrastructure/prisma-payment-repository";
import { prismaPaymentWebhookEventRepository } from "@/modules/payment/infrastructure/prisma-payment-webhook-event-repository";
import { prisma as paymentPrisma } from "@/modules/payment/infrastructure/prisma-client";
import { createOrder as createOrderCommand } from "@/modules/order/application/order-commands";
import { changeOrderStatus as changeOrderStatusCommand } from "@/modules/order/application/order-status";
import { prismaOrderRepository } from "@/modules/order/infrastructure/prisma-order-repository";
import { prisma as orderPrisma } from "@/modules/order/infrastructure/prisma-client";
import type { NewOrderInput } from "@/modules/order/repositories/order-repository";

/**
 * Pure application-layer tests: every dependency
 * (`PaymentRepository`/`PaymentWebhookEventRepository`/`ChangeOrderStatusFn`/
 * event verification) is injected, so fakes are used for all of them — no
 * Prisma, no Stripe SDK, no network. Real-database concurrency coverage
 * lives separately in the "real repositories + real concurrency" describe
 * block below.
 */

function makePayment(overrides: Partial<Payment> = {}): Payment {
  const now = new Date();
  return {
    id: "payment-1",
    orderId: "order-1",
    status: "PENDING",
    amountMinor: 24800,
    currency: "USD",
    providerReference: "pi_test_123",
    providerStartAttemptedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFakePaymentRepository(initial: Payment | null): {
  repository: PaymentRepository;
  updateStatusIfCurrentCalls: {
    paymentId: string;
    expectedStatus: PaymentStatus;
    nextStatus: PaymentStatus;
  }[];
} {
  let current: Payment | null = initial;
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
      return current && current.id === paymentId ? current : null;
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
      if (!current || current.id !== paymentId || current.status !== expectedStatus) {
        return null;
      }
      current = { ...current, status: nextStatus };
      return current;
    },
    async setProviderReferenceIfPending() {
      throw new Error("not used by these tests");
    },
    async claimProviderStartAttempt() {
      throw new Error("not used by these tests");
    },
    async findByProviderReference(providerReference: string): Promise<Payment | null> {
      return current && current.providerReference === providerReference ? current : null;
    },
  };

  return { repository, updateStatusIfCurrentCalls };
}

function makeFakeWebhookEventRepository(): {
  repository: PaymentWebhookEventRepository;
  recordCalls: NewPaymentWebhookEventInput[];
} {
  const recordCalls: NewPaymentWebhookEventInput[] = [];
  const repository: PaymentWebhookEventRepository = {
    async recordIfNew(input) {
      recordCalls.push(input);
      return "recorded";
    },
  };
  return { repository, recordCalls };
}

function makeFakeChangeOrderStatus(options: { throws?: boolean } = {}): {
  fn: ChangeOrderStatusFn;
  calls: { orderId: string; nextStatus: "PAID" }[];
} {
  const calls: { orderId: string; nextStatus: "PAID" }[] = [];
  const fn: ChangeOrderStatusFn = async (orderId, nextStatus) => {
    calls.push({ orderId, nextStatus });
    if (options.throws) {
      throw new Error("simulated database failure");
    }
    return { ok: true };
  };
  return { fn, calls };
}

function makeVerifyEvent(
  result: VerifyStripeWebhookResult,
): (rawBody: string, signatureHeader: string) => VerifyStripeWebhookResult {
  return () => result;
}

function supportedEvent(
  overrides: Partial<Extract<StripeWebhookEvent, { kind: "supported" }>> = {},
): StripeWebhookEvent {
  return {
    kind: "supported",
    providerEventId: "evt_1",
    eventType: "payment_intent.succeeded",
    providerReference: "pi_test_123",
    outcome: "SUCCEEDED",
    // Matches makePayment()'s defaults (amountMinor: 24800, currency:
    // "USD") so every existing test's SUCCEEDED path passes IMP-041-FIX's
    // (PR1-F03) settlement check without having to repeat these on every
    // call site; tests specifically exercising a mismatch override them.
    settledAmountMinor: 24800,
    settledCurrency: "USD",
    ...overrides,
  };
}

function retryableFailureEvent(
  overrides: Partial<Extract<StripeWebhookEvent, { kind: "retryableFailure" }>> = {},
): StripeWebhookEvent {
  return {
    kind: "retryableFailure",
    providerEventId: "evt_retry_1",
    eventType: "payment_intent.payment_failed",
    providerReference: "pi_test_123",
    ...overrides,
  };
}

describe("processStripeWebhookEvent", () => {
  it("returns invalidSignature and touches no repository when signature verification fails", async () => {
    const { repository: paymentRepository } = makeFakePaymentRepository(makePayment());
    const { repository: webhookEventRepository, recordCalls } = makeFakeWebhookEventRepository();
    const { fn: changeOrderStatusFn, calls: orderCalls } = makeFakeChangeOrderStatus();

    const result = await processStripeWebhookEvent(
      paymentRepository,
      webhookEventRepository,
      changeOrderStatusFn,
      makeVerifyEvent({ ok: false, error: "INVALID_SIGNATURE" }),
      "raw-body",
      "bad-signature",
    );

    expect(result).toEqual({ outcome: "invalidSignature" });
    expect(recordCalls).toHaveLength(0);
    expect(orderCalls).toHaveLength(0);
  });

  it("returns ignored and touches no repository for an unsupported event type", async () => {
    const { repository: paymentRepository } = makeFakePaymentRepository(makePayment());
    const { repository: webhookEventRepository, recordCalls } = makeFakeWebhookEventRepository();
    const { fn: changeOrderStatusFn, calls: orderCalls } = makeFakeChangeOrderStatus();

    const result = await processStripeWebhookEvent(
      paymentRepository,
      webhookEventRepository,
      changeOrderStatusFn,
      makeVerifyEvent({
        ok: true,
        event: { kind: "ignored", providerEventId: "evt_2", eventType: "charge.succeeded" },
      }),
      "raw-body",
      "sig",
    );

    expect(result).toEqual({ outcome: "ignored" });
    expect(recordCalls).toHaveLength(0);
    expect(orderCalls).toHaveLength(0);
  });

  it("returns unknownPayment and records the event with a null paymentId when no Payment matches providerReference", async () => {
    const { repository: paymentRepository } = makeFakePaymentRepository(null);
    const { repository: webhookEventRepository, recordCalls } = makeFakeWebhookEventRepository();
    const { fn: changeOrderStatusFn, calls: orderCalls } = makeFakeChangeOrderStatus();

    const result = await processStripeWebhookEvent(
      paymentRepository,
      webhookEventRepository,
      changeOrderStatusFn,
      makeVerifyEvent({ ok: true, event: supportedEvent() }),
      "raw-body",
      "sig",
    );

    expect(result).toEqual({ outcome: "unknownPayment" });
    expect(recordCalls).toEqual([
      {
        provider: "stripe",
        providerEventId: "evt_1",
        eventType: "payment_intent.succeeded",
        paymentId: null,
      },
    ]);
    expect(orderCalls).toHaveLength(0);
  });

  it("applies PENDING -> SUCCEEDED and synchronizes the Order to PAID", async () => {
    const payment = makePayment({ status: "PENDING" });
    const { repository: paymentRepository, updateStatusIfCurrentCalls } =
      makeFakePaymentRepository(payment);
    const { repository: webhookEventRepository } = makeFakeWebhookEventRepository();
    const { fn: changeOrderStatusFn, calls: orderCalls } = makeFakeChangeOrderStatus();

    const result = await processStripeWebhookEvent(
      paymentRepository,
      webhookEventRepository,
      changeOrderStatusFn,
      makeVerifyEvent({ ok: true, event: supportedEvent() }),
      "raw-body",
      "sig",
    );

    expect(result).toEqual({
      outcome: "applied",
      payment: expect.objectContaining({ status: "SUCCEEDED" }),
    });
    expect(updateStatusIfCurrentCalls).toEqual([
      { paymentId: "payment-1", expectedStatus: "PENDING", nextStatus: "SUCCEEDED" },
    ]);
    expect(orderCalls).toEqual([{ orderId: "order-1", nextStatus: "PAID" }]);
  });

  it("IMP-041-FIX (PR1-F01): a retryableFailure event does NOT transition the Payment and does NOT touch the Order", async () => {
    const payment = makePayment({ status: "PENDING" });
    const { repository: paymentRepository, updateStatusIfCurrentCalls } =
      makeFakePaymentRepository(payment);
    const { repository: webhookEventRepository, recordCalls } = makeFakeWebhookEventRepository();
    const { fn: changeOrderStatusFn, calls: orderCalls } = makeFakeChangeOrderStatus();

    const result = await processStripeWebhookEvent(
      paymentRepository,
      webhookEventRepository,
      changeOrderStatusFn,
      makeVerifyEvent({ ok: true, event: retryableFailureEvent() }),
      "raw-body",
      "sig",
    );

    expect(result).toEqual({
      outcome: "retryableFailure",
      payment: expect.objectContaining({ status: "PENDING" }),
    });
    expect(updateStatusIfCurrentCalls).toHaveLength(0);
    expect(orderCalls).toHaveLength(0);
    // Still recorded for dedup/observability, even though no state changed.
    expect(recordCalls).toEqual([
      {
        provider: "stripe",
        providerEventId: "evt_retry_1",
        eventType: "payment_intent.payment_failed",
        paymentId: "payment-1",
      },
    ]);
  });

  it("IMP-041-FIX (PR1-F01): a failed attempt followed by a genuine success still applies — a retryable failure never blocks a later legitimate success for the SAME PaymentIntent", async () => {
    const payment = makePayment({ status: "PENDING" });
    const { repository: paymentRepository, updateStatusIfCurrentCalls } =
      makeFakePaymentRepository(payment);
    const { repository: webhookEventRepository } = makeFakeWebhookEventRepository();
    const { fn: changeOrderStatusFn, calls: orderCalls } = makeFakeChangeOrderStatus();

    const failedAttempt = await processStripeWebhookEvent(
      paymentRepository,
      webhookEventRepository,
      changeOrderStatusFn,
      makeVerifyEvent({
        ok: true,
        event: retryableFailureEvent({ providerEventId: "evt_retry_1" }),
      }),
      "raw-body",
      "sig",
    );
    expect(failedAttempt).toEqual({
      outcome: "retryableFailure",
      payment: expect.objectContaining({ status: "PENDING" }),
    });

    const retrySucceeded = await processStripeWebhookEvent(
      paymentRepository,
      webhookEventRepository,
      changeOrderStatusFn,
      makeVerifyEvent({ ok: true, event: supportedEvent({ providerEventId: "evt_succeeded_1" }) }),
      "raw-body",
      "sig",
    );

    expect(retrySucceeded).toEqual({
      outcome: "applied",
      payment: expect.objectContaining({ status: "SUCCEEDED" }),
    });
    expect(updateStatusIfCurrentCalls).toEqual([
      { paymentId: "payment-1", expectedStatus: "PENDING", nextStatus: "SUCCEEDED" },
    ]);
    expect(orderCalls).toEqual([{ orderId: "order-1", nextStatus: "PAID" }]);
  });

  it("IMP-041-FIX (PR1-F01): out-of-order delivery — a retryableFailure event arriving AFTER success is still a no-op and never disturbs the already-SUCCEEDED Payment", async () => {
    const payment = makePayment({ status: "SUCCEEDED" });
    const { repository: paymentRepository, updateStatusIfCurrentCalls } =
      makeFakePaymentRepository(payment);
    const { repository: webhookEventRepository } = makeFakeWebhookEventRepository();
    const { fn: changeOrderStatusFn, calls: orderCalls } = makeFakeChangeOrderStatus();

    const result = await processStripeWebhookEvent(
      paymentRepository,
      webhookEventRepository,
      changeOrderStatusFn,
      makeVerifyEvent({ ok: true, event: retryableFailureEvent() }),
      "raw-body",
      "sig",
    );

    expect(result).toEqual({
      outcome: "retryableFailure",
      payment: expect.objectContaining({ status: "SUCCEEDED" }),
    });
    expect(updateStatusIfCurrentCalls).toHaveLength(0);
    expect(orderCalls).toHaveLength(0);
  });

  it("IMP-041-FIX (PR1-F01): duplicate delivery of the SAME retryableFailure event remains a no-op both times", async () => {
    const payment = makePayment({ status: "PENDING" });
    const { repository: paymentRepository, updateStatusIfCurrentCalls } =
      makeFakePaymentRepository(payment);
    const { repository: webhookEventRepository } = makeFakeWebhookEventRepository();
    const { fn: changeOrderStatusFn } = makeFakeChangeOrderStatus();

    const first = await processStripeWebhookEvent(
      paymentRepository,
      webhookEventRepository,
      changeOrderStatusFn,
      makeVerifyEvent({ ok: true, event: retryableFailureEvent() }),
      "raw-body",
      "sig",
    );
    const duplicate = await processStripeWebhookEvent(
      paymentRepository,
      webhookEventRepository,
      changeOrderStatusFn,
      makeVerifyEvent({ ok: true, event: retryableFailureEvent() }),
      "raw-body",
      "sig",
    );

    expect(first).toEqual({
      outcome: "retryableFailure",
      payment: expect.objectContaining({ status: "PENDING" }),
    });
    expect(duplicate).toEqual(first);
    expect(updateStatusIfCurrentCalls).toHaveLength(0);
  });

  it("applies PENDING -> CANCELLED and does NOT touch the Order", async () => {
    const payment = makePayment({ status: "PENDING" });
    const { repository: paymentRepository } = makeFakePaymentRepository(payment);
    const { repository: webhookEventRepository } = makeFakeWebhookEventRepository();
    const { fn: changeOrderStatusFn, calls: orderCalls } = makeFakeChangeOrderStatus();

    const result = await processStripeWebhookEvent(
      paymentRepository,
      webhookEventRepository,
      changeOrderStatusFn,
      makeVerifyEvent({
        ok: true,
        event: supportedEvent({ outcome: "CANCELLED", eventType: "payment_intent.canceled" }),
      }),
      "raw-body",
      "sig",
    );

    expect(result).toEqual({
      outcome: "applied",
      payment: expect.objectContaining({ status: "CANCELLED" }),
    });
    expect(orderCalls).toHaveLength(0);
  });

  it("treats a duplicate SUCCEEDED delivery (Payment already SUCCEEDED) as alreadyAtTarget and still self-heals the Order sync", async () => {
    const payment = makePayment({ status: "SUCCEEDED" });
    const { repository: paymentRepository, updateStatusIfCurrentCalls } =
      makeFakePaymentRepository(payment);
    const { repository: webhookEventRepository } = makeFakeWebhookEventRepository();
    const { fn: changeOrderStatusFn, calls: orderCalls } = makeFakeChangeOrderStatus();

    const result = await processStripeWebhookEvent(
      paymentRepository,
      webhookEventRepository,
      changeOrderStatusFn,
      makeVerifyEvent({ ok: true, event: supportedEvent() }),
      "raw-body",
      "sig",
    );

    expect(result).toEqual({
      outcome: "alreadyAtTarget",
      payment: expect.objectContaining({ status: "SUCCEEDED" }),
    });
    // No wasted conditional-write attempt — nothing left to transition.
    expect(updateStatusIfCurrentCalls).toHaveLength(0);
    // But the Order sync IS retried — this is exactly what makes a retry
    // after a prior partial failure (Payment already SUCCEEDED, Order sync
    // didn't finish last time) self-healing.
    expect(orderCalls).toEqual([{ orderId: "order-1", nextStatus: "PAID" }]);
  });

  it("a payment_intent.payment_failed event whose PaymentIntent has itself become canceled maps to CANCELLED, exactly like a direct payment_intent.canceled event", async () => {
    const payment = makePayment({ status: "PENDING" });
    const { repository: paymentRepository, updateStatusIfCurrentCalls } =
      makeFakePaymentRepository(payment);
    const { repository: webhookEventRepository } = makeFakeWebhookEventRepository();
    const { fn: changeOrderStatusFn, calls: orderCalls } = makeFakeChangeOrderStatus();

    // `stripe-webhook.ts`'s own mapper is what actually decides
    // "canceled vs. retryable" from a payment_intent.payment_failed
    // event's PaymentIntent status (see stripe-webhook.test.ts) — this
    // application-layer test only proves that once mapped to a
    // "supported" CANCELLED event, it is handled identically to a direct
    // payment_intent.canceled event (never specially re-interpreted here).
    const result = await processStripeWebhookEvent(
      paymentRepository,
      webhookEventRepository,
      changeOrderStatusFn,
      makeVerifyEvent({
        ok: true,
        event: supportedEvent({ outcome: "CANCELLED", eventType: "payment_intent.payment_failed" }),
      }),
      "raw-body",
      "sig",
    );

    expect(result).toEqual({
      outcome: "applied",
      payment: expect.objectContaining({ status: "CANCELLED" }),
    });
    expect(updateStatusIfCurrentCalls).toEqual([
      { paymentId: "payment-1", expectedStatus: "PENDING", nextStatus: "CANCELLED" },
    ]);
    expect(orderCalls).toHaveLength(0);
  });

  it("returns conflict and never overrides a Payment already at a DIFFERENT terminal status (preserves terminal-state guarantee)", async () => {
    const payment = makePayment({ status: "FAILED" });
    const { repository: paymentRepository, updateStatusIfCurrentCalls } =
      makeFakePaymentRepository(payment);
    const { repository: webhookEventRepository } = makeFakeWebhookEventRepository();
    const { fn: changeOrderStatusFn, calls: orderCalls } = makeFakeChangeOrderStatus();

    const result = await processStripeWebhookEvent(
      paymentRepository,
      webhookEventRepository,
      changeOrderStatusFn,
      makeVerifyEvent({ ok: true, event: supportedEvent({ outcome: "SUCCEEDED" }) }),
      "raw-body",
      "sig",
    );

    expect(result).toEqual({
      outcome: "conflict",
      payment: expect.objectContaining({ status: "FAILED" }),
    });
    expect(updateStatusIfCurrentCalls).toHaveLength(0);
    expect(orderCalls).toHaveLength(0);
  });

  it("never overwrites Payment.amountMinor/currency with the event's settled values — they are compared against, never substituted in", async () => {
    const payment = makePayment({ status: "PENDING", amountMinor: 24800, currency: "USD" });
    const { repository: paymentRepository } = makeFakePaymentRepository(payment);
    const { repository: webhookEventRepository } = makeFakeWebhookEventRepository();
    const { fn: changeOrderStatusFn } = makeFakeChangeOrderStatus();

    const result = await processStripeWebhookEvent(
      paymentRepository,
      webhookEventRepository,
      changeOrderStatusFn,
      makeVerifyEvent({ ok: true, event: supportedEvent() }),
      "raw-body",
      "sig",
    );

    expect(result.outcome).toBe("applied");
    if (
      result.outcome === "applied" ||
      result.outcome === "alreadyAtTarget" ||
      result.outcome === "conflict"
    ) {
      expect(result.payment.amountMinor).toBe(24800);
      expect(result.payment.currency).toBe("USD");
    }
  });

  describe("IMP-041-FIX (PR1-F03): settlement amount/currency validation before SUCCEEDED", () => {
    it("applies SUCCEEDED when the settled amount and currency exactly match the persisted Payment", async () => {
      const payment = makePayment({ status: "PENDING", amountMinor: 24800, currency: "USD" });
      const { repository: paymentRepository, updateStatusIfCurrentCalls } =
        makeFakePaymentRepository(payment);
      const { repository: webhookEventRepository } = makeFakeWebhookEventRepository();
      const { fn: changeOrderStatusFn, calls: orderCalls } = makeFakeChangeOrderStatus();

      const result = await processStripeWebhookEvent(
        paymentRepository,
        webhookEventRepository,
        changeOrderStatusFn,
        makeVerifyEvent({
          ok: true,
          event: supportedEvent({ settledAmountMinor: 24800, settledCurrency: "USD" }),
        }),
        "raw-body",
        "sig",
      );

      expect(result).toEqual({
        outcome: "applied",
        payment: expect.objectContaining({ status: "SUCCEEDED" }),
      });
      expect(updateStatusIfCurrentCalls).toHaveLength(1);
      expect(orderCalls).toEqual([{ orderId: "order-1", nextStatus: "PAID" }]);
    });

    it("fails closed on an amount mismatch — neither Payment nor Order transitions", async () => {
      const payment = makePayment({ status: "PENDING", amountMinor: 24800, currency: "USD" });
      const { repository: paymentRepository, updateStatusIfCurrentCalls } =
        makeFakePaymentRepository(payment);
      const { repository: webhookEventRepository } = makeFakeWebhookEventRepository();
      const { fn: changeOrderStatusFn, calls: orderCalls } = makeFakeChangeOrderStatus();

      const result = await processStripeWebhookEvent(
        paymentRepository,
        webhookEventRepository,
        changeOrderStatusFn,
        makeVerifyEvent({
          ok: true,
          event: supportedEvent({ settledAmountMinor: 19900, settledCurrency: "USD" }),
        }),
        "raw-body",
        "sig",
      );

      expect(result).toEqual({
        outcome: "amountMismatch",
        payment: expect.objectContaining({ status: "PENDING", amountMinor: 24800 }),
      });
      expect(updateStatusIfCurrentCalls).toHaveLength(0);
      expect(orderCalls).toHaveLength(0);
    });

    it("fails closed on a currency mismatch — neither Payment nor Order transitions", async () => {
      const payment = makePayment({ status: "PENDING", amountMinor: 24800, currency: "USD" });
      const { repository: paymentRepository, updateStatusIfCurrentCalls } =
        makeFakePaymentRepository(payment);
      const { repository: webhookEventRepository } = makeFakeWebhookEventRepository();
      const { fn: changeOrderStatusFn, calls: orderCalls } = makeFakeChangeOrderStatus();

      const result = await processStripeWebhookEvent(
        paymentRepository,
        webhookEventRepository,
        changeOrderStatusFn,
        makeVerifyEvent({
          ok: true,
          event: supportedEvent({ settledAmountMinor: 24800, settledCurrency: "EUR" }),
        }),
        "raw-body",
        "sig",
      );

      expect(result).toEqual({
        outcome: "amountMismatch",
        payment: expect.objectContaining({ status: "PENDING", currency: "USD" }),
      });
      expect(updateStatusIfCurrentCalls).toHaveLength(0);
      expect(orderCalls).toHaveLength(0);
    });

    it("duplicate delivery of a mismatched event is still refused both times — never applied on a retry", async () => {
      const payment = makePayment({ status: "PENDING", amountMinor: 24800, currency: "USD" });
      const { repository: paymentRepository, updateStatusIfCurrentCalls } =
        makeFakePaymentRepository(payment);
      const { repository: webhookEventRepository } = makeFakeWebhookEventRepository();
      const { fn: changeOrderStatusFn, calls: orderCalls } = makeFakeChangeOrderStatus();
      const mismatchedEvent = makeVerifyEvent({
        ok: true,
        event: supportedEvent({ settledAmountMinor: 1, settledCurrency: "USD" }),
      });

      const first = await processStripeWebhookEvent(
        paymentRepository,
        webhookEventRepository,
        changeOrderStatusFn,
        mismatchedEvent,
        "raw-body",
        "sig",
      );
      const duplicate = await processStripeWebhookEvent(
        paymentRepository,
        webhookEventRepository,
        changeOrderStatusFn,
        mismatchedEvent,
        "raw-body",
        "sig",
      );

      expect(first).toEqual({
        outcome: "amountMismatch",
        payment: expect.objectContaining({ status: "PENDING" }),
      });
      expect(duplicate).toEqual(first);
      expect(updateStatusIfCurrentCalls).toHaveLength(0);
      expect(orderCalls).toHaveLength(0);
    });
  });

  it("does not swallow an Order-sync exception — it propagates so the webhook route can return 5xx and let Stripe retry", async () => {
    const payment = makePayment({ status: "PENDING" });
    const { repository: paymentRepository } = makeFakePaymentRepository(payment);
    const { repository: webhookEventRepository } = makeFakeWebhookEventRepository();
    const { fn: changeOrderStatusFn } = makeFakeChangeOrderStatus({ throws: true });

    await expect(
      processStripeWebhookEvent(
        paymentRepository,
        webhookEventRepository,
        changeOrderStatusFn,
        makeVerifyEvent({ ok: true, event: supportedEvent() }),
        "raw-body",
        "sig",
      ),
    ).rejects.toThrow("simulated database failure");
  });

  it("logs but does not throw when Order sync returns a benign non-ok result (e.g. Order already PAID)", async () => {
    const payment = makePayment({ status: "PENDING" });
    const { repository: paymentRepository } = makeFakePaymentRepository(payment);
    const { repository: webhookEventRepository } = makeFakeWebhookEventRepository();
    const changeOrderStatusFn: ChangeOrderStatusFn = async () => ({
      ok: false,
      error: "INVALID_STATUS_TRANSITION",
    });

    const result = await processStripeWebhookEvent(
      paymentRepository,
      webhookEventRepository,
      changeOrderStatusFn,
      makeVerifyEvent({ ok: true, event: supportedEvent() }),
      "raw-body",
      "sig",
    );

    expect(result).toEqual({
      outcome: "applied",
      payment: expect.objectContaining({ status: "SUCCEEDED" }),
    });
  });
});

/**
 * Real repositories + real concurrency (IMP-039), mirroring
 * `process-payment.test.ts`'s "real repository + real concurrency"
 * section: proves `processStripeWebhookEvent` itself — not any single
 * primitive in isolation — is safe when the SAME event is delivered
 * genuinely concurrently, against real Postgres and Order's real
 * `changeOrderStatus`.
 */
describe("processStripeWebhookEvent — real repositories + real concurrency (IMP-039)", () => {
  const orderIds: string[] = [];
  const paymentIds: string[] = [];

  afterAll(async () => {
    if (paymentIds.length > 0) {
      await paymentPrisma.paymentWebhookEvent.deleteMany({
        where: { paymentId: { in: paymentIds } },
      });
      await paymentPrisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    }
    if (orderIds.length > 0) {
      await orderPrisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await paymentPrisma.$disconnect();
    await orderPrisma.$disconnect();
  });

  function baseOrderInput(overrides: Partial<NewOrderInput> = {}): NewOrderInput {
    return {
      firstName: "Webhook",
      lastName: "Event",
      email: `webhook-event-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      phone: "+421900123456",
      userId: null,
      subtotalAmountMinor: 24000,
      deliveryAmountMinor: 800,
      totalAmountMinor: 24800,
      currency: "USD",
      items: [
        {
          productId: "1",
          productName: "Studio Chair",
          regularUnitPriceAmountMinor: 24000,
          unitPriceAmountMinor: 24000,
          quantity: 1,
          lineTotalAmountMinor: 24000,
          currency: "USD",
        },
      ],
      ...overrides,
    };
  }

  async function createTestPaymentWithReference(providerReference: string) {
    const order = await createOrderCommand(prismaOrderRepository, baseOrderInput());
    orderIds.push(order.id);
    const created = await prismaPaymentRepository.create({
      orderId: order.id,
      amountMinor: order.totalAmountMinor,
      currency: order.currency,
    });
    if (created.outcome !== "created") throw new Error("expected a fresh Payment");
    paymentIds.push(created.payment.id);
    const withReference = await prismaPaymentRepository.setProviderReferenceIfPending(
      created.payment.id,
      providerReference,
    );
    if (!withReference) throw new Error("expected setProviderReferenceIfPending to apply");
    return { payment: withReference, orderId: order.id };
  }

  const realChangeOrderStatus: ChangeOrderStatusFn = async (orderId, nextStatus) =>
    changeOrderStatusCommand(prismaOrderRepository, orderId, nextStatus);

  it("Promise.all delivering the identical succeeded event twice produces exactly one Payment transition and exactly one Order transition", async () => {
    const providerReference = `pi_concurrency_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const { payment, orderId } = await createTestPaymentWithReference(providerReference);

    const verifyEvent = makeVerifyEvent({
      ok: true,
      event: supportedEvent({
        providerEventId: `evt_concurrency_${Date.now()}`,
        providerReference,
        outcome: "SUCCEEDED",
      }),
    });

    const [a, b] = await Promise.all([
      processStripeWebhookEvent(
        prismaPaymentRepository,
        prismaPaymentWebhookEventRepository,
        realChangeOrderStatus,
        verifyEvent,
        "raw-body",
        "sig",
      ),
      processStripeWebhookEvent(
        prismaPaymentRepository,
        prismaPaymentWebhookEventRepository,
        realChangeOrderStatus,
        verifyEvent,
        "raw-body",
        "sig",
      ),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    // Exactly one call actually applied the transition; the other observed
    // it already at target — never two "applied", never a conflict.
    expect(outcomes).toEqual(["alreadyAtTarget", "applied"]);

    const refetchedPayment = await prismaPaymentRepository.findById(payment.id);
    expect(refetchedPayment?.status).toBe("SUCCEEDED");

    const refetchedOrder = await prismaOrderRepository.findById(orderId);
    expect(refetchedOrder?.status).toBe("PAID");

    const webhookEvents = await paymentPrisma.paymentWebhookEvent.findMany({
      where: { paymentId: payment.id },
    });
    // Postgres's unique constraint allowed exactly one INSERT to succeed —
    // never two rows for the same (provider, providerEventId).
    expect(webhookEvents).toHaveLength(1);
  });
});
