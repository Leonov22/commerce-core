import { isValidPaymentStatusTransition } from "@/modules/payment/domain/payment";
import type { PaymentRepository } from "@/modules/payment/repositories/payment-repository";
import type { Payment, PaymentStatus } from "@/modules/payment/domain/payment";

/**
 * Payment lifecycle write use case (IMP-039) — the Payment-side mirror of
 * `@/modules/order/application/order-status.ts`'s `changeOrderStatus`,
 * reusing the exact same read-validate-atomic-write shape. Established now
 * as a generic, reusable transition primitive (not webhook-specific);
 * `process-stripe-webhook-event.ts` builds its own idempotent-retry
 * handling on top of this, the same way `changeOrderStatus` itself has no
 * knowledge of any particular caller.
 */
export type ChangePaymentStatusResult =
  | { ok: true; payment: Payment }
  | { ok: false; error: "PAYMENT_NOT_FOUND" }
  | { ok: false; error: "INVALID_STATUS_TRANSITION" }
  | { ok: false; error: "PAYMENT_STATUS_CHANGED" };

/**
 * CR-030's reasoning applies identically here: the transition is validated
 * against whatever status was just read, but that read can be stale by the
 * time the write happens — two concurrent callers can both read PENDING and
 * both pass validation. The actual guarantee against a forbidden
 * terminal-state transition comes from `updateStatusIfCurrent`'s atomic,
 * database-enforced conditional write, not from this function's own
 * read-then-write sequencing. If the conditional update reports no row
 * changed, that means another caller already moved the Payment to a
 * different status between this function's read and its write — reported
 * as `PAYMENT_STATUS_CHANGED`, never silently ignored and never retried
 * automatically here.
 */
export async function changePaymentStatus(
  repository: PaymentRepository,
  paymentId: string,
  nextStatus: PaymentStatus,
): Promise<ChangePaymentStatusResult> {
  const payment = await repository.findById(paymentId);
  if (!payment) {
    return { ok: false, error: "PAYMENT_NOT_FOUND" };
  }

  if (!isValidPaymentStatusTransition(payment.status, nextStatus)) {
    return { ok: false, error: "INVALID_STATUS_TRANSITION" };
  }

  const updated = await repository.updateStatusIfCurrent(paymentId, payment.status, nextStatus);
  if (!updated) {
    return { ok: false, error: "PAYMENT_STATUS_CHANGED" };
  }

  return { ok: true, payment: updated };
}
