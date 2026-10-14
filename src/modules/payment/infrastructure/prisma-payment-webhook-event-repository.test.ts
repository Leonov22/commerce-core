import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prismaPaymentWebhookEventRepository } from "@/modules/payment/infrastructure/prisma-payment-webhook-event-repository";
import { prisma } from "@/modules/payment/infrastructure/prisma-client";

describe("prismaPaymentWebhookEventRepository", () => {
  const eventIds: string[] = [];

  afterAll(async () => {
    if (eventIds.length > 0) {
      await prisma.paymentWebhookEvent.deleteMany({ where: { providerEventId: { in: eventIds } } });
    }
    await prisma.$disconnect();
  });

  function uniqueEventId(): string {
    const id = `evt_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    eventIds.push(id);
    return id;
  }

  it("IMP-039: recordIfNew records a genuinely new event", async () => {
    const providerEventId = uniqueEventId();

    const result = await prismaPaymentWebhookEventRepository.recordIfNew({
      provider: "stripe",
      providerEventId,
      eventType: "payment_intent.succeeded",
      paymentId: "payment-does-not-need-to-exist-for-this-column",
    });

    expect(result).toBe("recorded");

    const row = await prisma.paymentWebhookEvent.findUnique({
      where: { provider_providerEventId: { provider: "stripe", providerEventId } },
    });
    expect(row).not.toBeNull();
    expect(row?.eventType).toBe("payment_intent.succeeded");
  });

  it("IMP-039: recordIfNew detects a sequential duplicate (same provider + providerEventId) without creating a second row", async () => {
    const providerEventId = uniqueEventId();

    const first = await prismaPaymentWebhookEventRepository.recordIfNew({
      provider: "stripe",
      providerEventId,
      eventType: "payment_intent.succeeded",
      paymentId: null,
    });
    const second = await prismaPaymentWebhookEventRepository.recordIfNew({
      provider: "stripe",
      providerEventId,
      eventType: "payment_intent.succeeded",
      paymentId: null,
    });

    expect(first).toBe("recorded");
    expect(second).toBe("duplicate");

    const rows = await prisma.paymentWebhookEvent.findMany({
      where: { provider: "stripe", providerEventId },
    });
    expect(rows).toHaveLength(1);
  });

  it("IMP-039: the same providerEventId under a DIFFERENT provider is not treated as a duplicate — the unique key is (provider, providerEventId)", async () => {
    const providerEventId = uniqueEventId();

    const first = await prismaPaymentWebhookEventRepository.recordIfNew({
      provider: "stripe",
      providerEventId,
      eventType: "payment_intent.succeeded",
      paymentId: null,
    });
    const second = await prismaPaymentWebhookEventRepository.recordIfNew({
      provider: "some-other-provider",
      providerEventId,
      eventType: "payment_intent.succeeded",
      paymentId: null,
    });

    expect(first).toBe("recorded");
    expect(second).toBe("recorded");
  });

  it("IMP-039: genuinely concurrent recordIfNew calls for the identical event — exactly one 'recorded', the rest 'duplicate', and exactly one row persists", async () => {
    const providerEventId = uniqueEventId();
    const input = {
      provider: "stripe",
      providerEventId,
      eventType: "payment_intent.succeeded",
      paymentId: null,
    };

    // Real parallel execution against the same live Postgres connection
    // pool — Postgres's own unique-constraint enforcement at insert time,
    // not this test's control flow, decides which call "wins".
    const results = await Promise.all([
      prismaPaymentWebhookEventRepository.recordIfNew(input),
      prismaPaymentWebhookEventRepository.recordIfNew(input),
      prismaPaymentWebhookEventRepository.recordIfNew(input),
    ]);

    const recorded = results.filter((r) => r === "recorded");
    const duplicate = results.filter((r) => r === "duplicate");
    expect(recorded).toHaveLength(1);
    expect(duplicate).toHaveLength(2);

    const rows = await prisma.paymentWebhookEvent.findMany({
      where: { provider: "stripe", providerEventId },
    });
    expect(rows).toHaveLength(1);
  });
});
