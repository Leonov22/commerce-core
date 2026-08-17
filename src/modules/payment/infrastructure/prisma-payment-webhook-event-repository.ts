import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/modules/payment/infrastructure/prisma-client";
import type {
  PaymentWebhookEventRepository,
  NewPaymentWebhookEventInput,
  RecordPaymentWebhookEventResult,
} from "@/modules/payment/repositories/payment-webhook-event-repository";

/**
 * True for any unique-constraint violation on `payment_webhook_events` —
 * safe to treat as specifically the `(provider, providerEventId)`
 * constraint because that's the only unique combination this table has
 * besides its primary key (which `recordIfNew` cannot collide on: `id` is a
 * fresh `cuid()`). Same reasoning as `isOrderPaymentViolation` in
 * `prisma-payment-repository.ts`.
 */
function isDuplicateEventViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Prisma implementation of `PaymentWebhookEventRepository`. This is the
 * only file allowed to run Prisma queries against `payment_webhook_events`.
 */
export const prismaPaymentWebhookEventRepository: PaymentWebhookEventRepository = {
  async recordIfNew(input: NewPaymentWebhookEventInput): Promise<RecordPaymentWebhookEventResult> {
    // IMP-039: a single INSERT that either succeeds outright or fails on
    // Postgres's own unique constraint on `(provider, providerEventId)` —
    // never a separate "does this event already exist?" read beforehand.
    // Two concurrent deliveries of the same event both reach this
    // statement; Postgres allows exactly one of them to actually insert and
    // rejects the other with a constraint violation, so which caller
    // "wins" is decided by the database, exactly like
    // `PaymentRepository.create`.
    try {
      await prisma.paymentWebhookEvent.create({
        data: {
          provider: input.provider,
          providerEventId: input.providerEventId,
          eventType: input.eventType,
          paymentId: input.paymentId,
        },
      });
      return "recorded";
    } catch (error) {
      if (!isDuplicateEventViolation(error)) {
        throw error;
      }
      return "duplicate";
    }
  },
};
