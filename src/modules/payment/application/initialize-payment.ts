import "server-only";
import type { PaymentRepository } from "@/modules/payment/repositories/payment-repository";
import type { Payment } from "@/modules/payment/domain/payment";
import type { Order } from "@/modules/order/domain/order";

/**
 * The Order lookup this function needs, injected rather than imported
 * directly from `@/modules/order` — unlike `checkout-order.ts`'s direct
 * import of Catalog's `getProductsByIds` (safe only because Catalog's
 * public barrel happens to contain no JSX), Order's public barrel
 * re-exports `.tsx` presentation components this project's Vitest config
 * has no JSX transform for; a direct static import here would make this
 * file untestable without fully mocking Order away, losing the ability to
 * exercise real Order eligibility/amount data in an integration-style
 * test. Injecting this one function keeps the module-boundary rule intact
 * (only `@/modules/payment/index.ts` — the wiring layer — ever imports the
 * real `@/modules/order` barrel) while keeping this file cleanly testable
 * against real Order data via `@/modules/order/application/get-order`
 * directly, the same way every Order test file itself avoids the barrel.
 */
export type GetOrderById = (orderId: string) => Promise<Order | null>;

export type InitializePaymentResult =
  | { ok: true; payment: Payment }
  | { ok: false; error: "ORDER_NOT_FOUND" }
  | { ok: false; error: "ORDER_ALREADY_PAID" }
  | { ok: false; error: "ORDER_CANCELLED" }
  /**
   * A Payment already exists for this Order (IMP-032 §12) — the same
   * database-enforced guard `createIdempotent` uses for Checkout
   * idempotency, applied here to the one-Payment-per-Order relationship.
   * The existing Payment is returned so the caller doesn't have to make a
   * second lookup; it must never be treated as a fresh initialization.
   */
  | { ok: false; error: "PAYMENT_ALREADY_EXISTS"; payment: Payment };

/**
 * Initializes a Payment for an existing Order (IMP-032). Establishes the
 * contract a future payment-provider milestone will call — no such caller
 * exists yet, and none is added here. Never exposed to a customer-facing
 * transport in this milestone: no route calls this (see `@/modules/payment`'s
 * public exports — nothing customer-facing calls it).
 *
 * Deliberately does not depend on `OrderRepository` directly — it resolves
 * the Order through the injected `getOrder` (see `GetOrderById` above),
 * which the module boundary (`@/modules/payment/index.ts`) wires to
 * Order's own public `getOrderById`. `PaymentRepository` (this module's
 * own persistence) is injected the same way, matching every other
 * Order/Payment command in this codebase.
 *
 * Creating a Payment is NOT the same as the Order being paid — the Order
 * remains `PENDING`; nothing here mutates Order status. A future
 * payment-processing milestone, once an external provider actually
 * reports success, is responsible for that separate transition (via
 * `changeOrderStatus`, unmodified by this milestone).
 */
export async function initializePayment(
  repository: PaymentRepository,
  getOrder: GetOrderById,
  orderId: string,
): Promise<InitializePaymentResult> {
  const order = await getOrder(orderId);
  if (!order) {
    return { ok: false, error: "ORDER_NOT_FOUND" };
  }

  // Order eligibility (IMP-032 §11): PENDING is the only status a Payment
  // may be initialized for. PAID means a payment already succeeded by
  // definition of the Order lifecycle (IMP-030) — initializing a second
  // Payment would be meaningless. CANCELLED must never receive a Payment
  // at all.
  if (order.status === "PAID") {
    return { ok: false, error: "ORDER_ALREADY_PAID" };
  }
  if (order.status === "CANCELLED") {
    return { ok: false, error: "ORDER_CANCELLED" };
  }

  // order.status === "PENDING" here — the only remaining OrderStatus value.

  // Amount/currency are the Order's own authoritative, already-computed
  // totals — never a client-supplied value, never recomputed here. This
  // function accepts no amount/currency parameter at all, so there is no
  // input a caller could even attempt to override them with.
  const result = await repository.create({
    orderId: order.id,
    amountMinor: order.totalAmountMinor,
    currency: order.currency,
  });

  if (result.outcome === "duplicate") {
    return { ok: false, error: "PAYMENT_ALREADY_EXISTS", payment: result.payment };
  }

  return { ok: true, payment: result.payment };
}
