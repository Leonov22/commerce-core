import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/modules/payment/infrastructure/prisma-client";
import type {
  PaymentRepository,
  NewPaymentInput,
  CreatePaymentResult,
} from "@/modules/payment/repositories/payment-repository";
import type { Payment, PaymentStatus } from "@/modules/payment/domain/payment";

async function findPaymentRecord(paymentId: string) {
  return prisma.payment.findUnique({ where: { id: paymentId } });
}

type PaymentRow = Awaited<ReturnType<typeof findPaymentRecord>>;

function toDomainPayment(row: NonNullable<PaymentRow>): Payment {
  return {
    id: row.id,
    orderId: row.orderId,
    status: row.status as PaymentStatus,
    amountMinor: row.amountMinor,
    currency: row.currency,
    providerReference: row.providerReference,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * True for any unique-constraint violation on `payments` — safe to treat
 * as specifically the `orderId` constraint because that's the only unique
 * column `payments` has besides its primary key (which `create` cannot
 * collide on: `id` is a fresh `cuid()`). See the identical reasoning on
 * `isIdempotencyKeyViolation` in `@/modules/order/infrastructure/prisma-order-repository.ts`
 * for why this doesn't narrow further via `error.meta.target`.
 */
function isOrderPaymentViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Prisma implementation of `PaymentRepository`. This is the only file in
 * Payment allowed to run Prisma queries — the application layer depends on
 * the `PaymentRepository` interface, never on this class directly.
 */
export const prismaPaymentRepository: PaymentRepository = {
  async create(input: NewPaymentInput): Promise<CreatePaymentResult> {
    // IMP-032 §12/§13: a single INSERT that either succeeds outright or
    // fails on Postgres's own unique constraint on `orderId` — never a
    // separate "does a Payment already exist for this Order?" read
    // beforehand. Two concurrent calls for the same Order both reach this
    // statement; Postgres allows exactly one of them to actually insert
    // and rejects the other with a constraint violation, so which caller
    // "wins" is decided by the database, not by this function's control
    // flow — the exact mechanism `OrderRepository.createIdempotent` uses.
    try {
      const row = await prisma.payment.create({
        data: {
          orderId: input.orderId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          status: "PENDING",
        },
      });
      return { outcome: "created", payment: toDomainPayment(row) };
    } catch (error) {
      if (!isOrderPaymentViolation(error)) {
        throw error;
      }

      // Lost the race (or this is a genuine repeat call) — the row that
      // actually exists for this Order is the only source of truth for
      // what happens next, never this call's own (rejected) input.
      const existing = await prisma.payment.findUnique({ where: { orderId: input.orderId } });
      if (!existing) {
        // The row that caused the violation is gone by the time we
        // re-read (e.g. deleted between the two statements) — surface the
        // original database error rather than fabricating an outcome.
        throw error;
      }
      return { outcome: "duplicate", payment: toDomainPayment(existing) };
    }
  },

  async findById(paymentId: string): Promise<Payment | null> {
    const row = await findPaymentRecord(paymentId);
    return row ? toDomainPayment(row) : null;
  },

  async findByOrderId(orderId: string): Promise<Payment | null> {
    const row = await prisma.payment.findUnique({ where: { orderId } });
    return row ? toDomainPayment(row) : null;
  },

  async updateStatusIfCurrent(
    paymentId: string,
    expectedStatus: PaymentStatus,
    nextStatus: PaymentStatus,
  ): Promise<Payment | null> {
    // Same mechanism as CR-030's `OrderRepository.updateStatusIfCurrent`:
    // `updateMany` (not `update`) so the WHERE clause can include `status`
    // alongside `id` — Prisma's single-record `update` only accepts a
    // unique selector. Postgres evaluates this WHERE against the row's
    // actual committed status at the moment this statement runs, so a
    // status read earlier by the application can never be stale by the
    // time this executes.
    const result = await prisma.payment.updateMany({
      where: { id: paymentId, status: expectedStatus },
      data: { status: nextStatus },
    });

    if (result.count === 0) {
      return null;
    }

    const row = await findPaymentRecord(paymentId);
    return row ? toDomainPayment(row) : null;
  },

  async setProviderReferenceIfPending(
    paymentId: string,
    providerReference: string,
  ): Promise<Payment | null> {
    // IMP-034: `updateMany` (not `update`) so the WHERE clause can include
    // both `status` and `providerReference` alongside `id` — Prisma's
    // single-record `update` only accepts a unique selector. Conditioning
    // on `providerReference: null` (in addition to `status: "PENDING"`) is
    // what actually prevents two concurrent callers from silently
    // overwriting each other's reference: whichever write lands first
    // flips `providerReference` away from `null`, so the second write's
    // WHERE clause no longer matches and `count` is 0 — never a
    // last-write-wins clobber.
    const result = await prisma.payment.updateMany({
      where: { id: paymentId, status: "PENDING", providerReference: null },
      data: { providerReference },
    });

    if (result.count === 0) {
      return null;
    }

    const row = await findPaymentRecord(paymentId);
    return row ? toDomainPayment(row) : null;
  },
};
