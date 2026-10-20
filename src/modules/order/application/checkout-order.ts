import "server-only";
import { getProductsByIds, reserveStock, releaseReservation } from "@/modules/catalog";
import { computeCheckoutSubmissionFingerprint } from "@/modules/order/application/idempotency";
import { changeOrderStatus } from "@/modules/order/application/order-status";
import type { OrderRepository } from "@/modules/order/repositories/order-repository";
import type { Order } from "@/modules/order/domain/order";
import type { ReleaseReservationResult } from "@/modules/catalog";

export interface CheckoutOrderCustomer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface CheckoutOrderItemRequest {
  productId: string;
  quantity: number;
}

export interface CheckoutOrderRequest {
  customer: CheckoutOrderCustomer;
  items: CheckoutOrderItemRequest[];
  /**
   * Already resolved server-side from a submitted delivery *method* before
   * this function is called — never a client-supplied amount. See
   * `@/modules/checkout`'s `getDeliveryAmountMinor`.
   */
  deliveryAmountMinor: number;
  locale: string;
  /**
   * The authenticated customer's id, or `null`/omitted for a guest
   * checkout (IMP-029) — resolved server-side by the caller (the API
   * route, via Identity's `getCurrentUser()`) before this function is ever
   * invoked. This function trusts it as already-authoritative and never
   * re-derives or second-guesses it; it must never come from client
   * request input. Optional (defaults to `null`) so every pre-IMP-029 test
   * case that doesn't specify it keeps compiling as a guest-order test.
   */
  userId?: string | null;
  /**
   * IMP-031 checkout submission idempotency. The transport boundary (the
   * `POST /api/orders` route) requires this on every real request via the
   * `Idempotency-Key` header; it stays optional here — mirroring `userId`
   * above — so callers that don't care about idempotency (the generic
   * internal `createOrder` command, and every pre-IMP-031 test exercising
   * pure checkout validation) keep working unchanged via a plain
   * `repository.create()`. Supplying it switches this function onto the
   * atomic `repository.createIdempotent()` path.
   */
  idempotencyKey?: string;
}

export type CreateOrderFromCheckoutResult =
  | {
      ok: true;
      order: Order;
      /**
       * `false` only when this call returned an Order that had already
       * been created by an earlier (or concurrently racing) call under the
       * same idempotency key — i.e. nothing new was persisted this time.
       * Absent when no `idempotencyKey` was supplied at all. The API route
       * uses this to choose between 201 (created) and 200 (replayed).
       */
      created?: boolean;
    }
  | { ok: false; error: "EMPTY_CART" }
  | { ok: false; error: "INVALID_QUANTITY"; productId: string }
  | { ok: false; error: "UNRESOLVED_PRODUCTS"; productIds: string[] }
  | { ok: false; error: "INCONSISTENT_CURRENCY" }
  | { ok: false; error: "AMOUNT_OUT_OF_RANGE" }
  /**
   * IMP-031: `idempotencyKey` was already used for a Order whose submission
   * fingerprint doesn't match this request — a materially different
   * submission (including a different resolved user) reusing someone
   * else's key. The caller must reject this outright and must never fall
   * back to returning the mismatched existing Order.
   */
  | { ok: false; error: "IDEMPOTENCY_KEY_CONFLICT" }
  /**
   * IMP-048 Increment 3: at least one *tracked* item could not be
   * reserved (not enough on-hand stock, or the product vanished between
   * Catalog resolution and reservation). The newly created Order has
   * already been cancelled and every reservation this attempt created
   * has already been released — never left dangling. `productIds` names
   * the item(s) known to have failed; it can be empty when this is a
   * replay of a submission that already failed this way on an earlier
   * attempt (see `securePendingReservationsAndFinalize`'s own doc
   * comment on why that case is inferred from the Order's own status
   * rather than re-derived).
   */
  | { ok: false; error: "INSUFFICIENT_STOCK"; productIds: string[] }
  /**
   * CR-2 remediation (round 2): a reservation failed AND the attempt to
   * clean up after that failure (cancel the Order, release whichever
   * reservations this attempt made) could not be fully confirmed —
   * e.g. one or more `releaseReservation` calls failed, or the Order's
   * own status could not be conclusively determined afterward. Never
   * returned for a cleanly resolved failure (that's `INSUFFICIENT_STOCK`
   * above) — this exists specifically so the caller is never told "the
   * order was cancelled and every reservation released" when that isn't
   * known to be true. `productIds` names the item(s) whose release
   * could not be confirmed; deliberately generic (no raw error detail)
   * since this crosses into a customer-facing boundary — full detail is
   * only in the server-side logs (`console.error`).
   */
  | { ok: false; error: "RESERVATION_CLEANUP_INCOMPLETE"; productIds: string[] };

/**
 * A single OrderItem's quantity ceiling. 100 units of one product is
 * already far beyond a normal consumer checkout for this storefront's
 * catalog (furniture/lighting/decor, priced $86-$310) — a quantity above
 * this is treated as invalid input rather than a genuine bulk order, which
 * this MVP does not support. This is a business-level limit, not a
 * database-derived one; the separate `MAX_AMOUNT_MINOR` check below is
 * what actually protects the database range.
 */
export const MAX_QUANTITY_PER_ITEM = 100;

/**
 * PostgreSQL's `INTEGER` (int4) column type — used for every money field in
 * the Order/OrderItem schema — is a signed 32-bit integer, max 2^31 - 1.
 * Any calculated amount above this must never reach Prisma: it would
 * either be silently truncated or throw a raw, unhelpful database error.
 * `MAX_QUANTITY_PER_ITEM` alone does not guarantee this — a single
 * absurdly-priced Catalog product multiplied by an in-range quantity, or a
 * cart with many high-value lines summed together, could still exceed it.
 */
export const MAX_AMOUNT_MINOR = 2_147_483_647;

/**
 * Exported for direct unit testing — real seeded Catalog prices are far too
 * small to actually trigger an overflow through the full
 * `createOrderFromCheckout` path without either modifying Catalog data or
 * an elaborate fake, so the boundary itself is tested in isolation.
 */
export function isWithinSafeAmountRange(amountMinor: number): boolean {
  return Number.isInteger(amountMinor) && amountMinor >= 0 && amountMinor <= MAX_AMOUNT_MINOR;
}

/**
 * IMP-048 Increment 3: how long a checkout's stock reservation holds
 * before it becomes eligible to be swept as expired by some other
 * order's `reserveStock`/`adjustStock` call on the same product.
 * Provisional — no payment flow exists yet to call Catalog's
 * `securePaymentWindow` and extend it before this elapses; that wiring
 * is a separately-approved, later increment. 15 minutes mirrors a
 * typical checkout session window.
 */
const STOCK_RESERVATION_TTL_MS = 15 * 60 * 1000;

/**
 * CR-1: merges duplicate `productId` entries in a checkout submission
 * into one line per product, summing quantity. Applied once, at the very
 * entrypoint (`createOrderFromCheckout`), before quantity validation,
 * pricing, order creation, and inventory reservation — so every
 * downstream step, including the idempotency fingerprint, sees exactly
 * one line per distinct product, and the quantity charged, ordered, and
 * reserved can never diverge. Without this, two lines for the same
 * product each resolve and charge their own quantity, but
 * `reserveStockForOrder` below only ever reserves the FIRST line's
 * quantity for that `(orderId, productId)` pair — the second call sees
 * `"alreadyReserved"` and is silently treated as success, under-reserving
 * relative to what was actually charged.
 *
 * The existing cart/API contract already allowed a client to submit the
 * same `productId` more than once (nothing validated against it before);
 * merging is the smallest correction that closes this without changing
 * that contract's shape — a client that accidentally sends two lines for
 * one product still gets a normal, correctly-priced, correctly-reserved
 * checkout, not a rejection.
 */
function aggregateCheckoutItems(items: CheckoutOrderItemRequest[]): CheckoutOrderItemRequest[] {
  const quantityByProductId = new Map<string, number>();
  const productIdsInFirstSeenOrder: string[] = [];
  for (const item of items) {
    const existingQuantity = quantityByProductId.get(item.productId);
    if (existingQuantity === undefined) {
      productIdsInFirstSeenOrder.push(item.productId);
      quantityByProductId.set(item.productId, item.quantity);
    } else {
      quantityByProductId.set(item.productId, existingQuantity + item.quantity);
    }
  }
  return productIdsInFirstSeenOrder.map((productId) => ({
    productId,
    // Non-null: every id in `productIdsInFirstSeenOrder` was just set above.
    quantity: quantityByProductId.get(productId)!,
  }));
}

/**
 * Attempts to reserve every item of an already-persisted, still-PENDING
 * Order, one at a time, stopping at the first item that cannot be
 * secured. Untracked products (the only kind that exist today — see
 * `reserveStock`'s own "notTracked" outcome) are a complete no-op here,
 * which is what keeps this step's introduction a zero-behavior-change
 * for every product that hasn't opted into inventory tracking.
 *
 * Idempotent by construction: re-running this for an Order whose items
 * were already reserved by an earlier, interrupted attempt simply sees
 * `"alreadyReserved"` for each already-secured pair and continues — it
 * never creates a duplicate row, and never re-attempts (or revives) a
 * pair that already reached a terminal state.
 */
async function reserveStockForOrder(
  order: Order,
): Promise<{ ok: true } | { ok: false; failedProductIds: string[] }> {
  const expiresAt = new Date(Date.now() + STOCK_RESERVATION_TTL_MS);
  for (const item of order.items) {
    const result = await reserveStock({
      orderId: order.id,
      productId: item.productId,
      quantity: item.quantity,
      expiresAt,
    });
    if (
      result.outcome === "reserved" ||
      result.outcome === "alreadyReserved" ||
      result.outcome === "notTracked"
    ) {
      continue;
    }
    // "insufficientStock" | "productNotFound" | "alreadyFinal" — this
    // item cannot be secured. Stop here rather than attempting the
    // remaining items: whatever this call already reserved above gets
    // released unconditionally by the caller regardless of how far this
    // loop got.
    return { ok: false, failedProductIds: [item.productId] };
  }
  return { ok: true };
}

/**
 * CR-2 (round 4): classifies an actual `ReleaseReservationResult` — not
 * just "did the call throw" — against the real repository contract (see
 * `@/modules/catalog`'s `ReleaseReservationResult`):
 *
 * - `"released"`, `"alreadyReleased"`: the pair is terminal and no stock
 *   was ever consumed for it — confirmed safe, whether this call or an
 *   earlier one is what actually released it.
 * - `"notFound"`: nothing was ever reserved for this pair (untracked
 *   product, or never reached) — confirmed safe, nothing to reconcile.
 * - `"notReleasable"` covers two DIFFERENT terminal reasons the
 *   repository folds into one outcome (see its own doc comment) — this
 *   function tells them apart by inspecting `reservation.status`:
 *     - `EXPIRED`: no stock was ever consumed, just a timed-out hold —
 *       confirmed safe, consistent with the Order being cancelled.
 *     - `CONSUMED`: stock WAS actually taken for this pair. An Order
 *       being cancelled must never silently treat that as resolved
 *       cleanup — this is an inconsistency worth surfacing, not success.
 *
 * Exported for direct unit testing — every outcome the real repository
 * contract can produce is cheap to construct as a plain object, so this
 * pure classification is tested directly rather than only indirectly
 * through a full database-backed checkout scenario per outcome.
 */
export function classifyReleaseOutcome(
  result: ReleaseReservationResult,
): "confirmedSafe" | "unresolved" {
  switch (result.outcome) {
    case "released":
    case "alreadyReleased":
    case "notFound":
      return "confirmedSafe";
    case "notReleasable":
      return result.reservation.status === "EXPIRED" ? "confirmedSafe" : "unresolved";
  }
}

/**
 * Attempts to release every item of an Order's reservations
 * INDEPENDENTLY — CR-2 (round 2): a failure releasing one item must never
 * prevent the remaining items from being attempted. Safe and idempotent
 * to call for an item that was never reserved at all and for one already
 * released by an earlier attempt.
 *
 * CR-2 (round 4): a thrown release call is one way this can be
 * unresolved, but not the only one — each call's actual, non-throwing
 * RESULT is also classified via `classifyReleaseOutcome` (see its own
 * doc comment), since a `notReleasable` outcome caused by a `CONSUMED`
 * reservation must not silently count as safe cleanup just because the
 * call itself didn't throw.
 *
 * Returns the `productId`s whose outcome could not be classified as
 * confirmed-safe (thrown, or a non-safe result) — an empty array means
 * every item's reservation is now in a confirmed-safe terminal state.
 */
async function releaseEachReservationIndependently(order: Order): Promise<string[]> {
  const unresolvedProductIds: string[] = [];
  for (const item of order.items) {
    try {
      const result = await releaseReservation(order.id, item.productId);
      if (classifyReleaseOutcome(result) === "unresolved") {
        console.error(
          "[order/checkout-order] a reservation release outcome could not be classified as safe cleanup — manual reconciliation required",
          { orderId: order.id, productId: item.productId, result },
        );
        unresolvedProductIds.push(item.productId);
      }
    } catch (releaseError) {
      console.error(
        "[order/checkout-order] failed to release a reservation during cleanup — manual reconciliation required",
        { orderId: order.id, productId: item.productId, releaseError },
      );
      unresolvedProductIds.push(item.productId);
    }
  }
  return unresolvedProductIds;
}

/** The outcome of an attempt to clean up after a reservation problem — see `cleanupReservationsAndReconcileOrder`'s own doc comment. */
interface ReservationCleanupOutcome {
  /** The best currently-known Order state. */
  order: Order;
  /**
   * `"confirmed"`: the returned `order.status` is authoritative (either
   * this attempt's own cancellation was confirmed to succeed and every
   * reservation release it attempted completed without throwing, or the
   * Order was found to have already, confirmably, moved to `PAID`/
   * `CANCELLED` by something else). `"incomplete"`: some part of this
   * could not be confirmed — never treat this the same as a cleanly
   * resolved failure.
   */
  status: "confirmed" | "incomplete";
  /** `productId`s whose release attempt itself threw, if any. */
  unresolvedProductIds: string[];
}

/**
 * CR-2 / CR-3 (round 2): the one place reservation cleanup actually
 * happens — used both when `reserveStockForOrder` cleanly reports a
 * business-outcome failure and when it THROWS (an unexpected fault).
 * Never throws itself: every internal failure is logged loudly
 * (`console.error`, matching this codebase's existing convention — see
 * `stripe-webhook.ts`/`process-stripe-webhook-event.ts`) and folded into
 * an explicit `"incomplete"` outcome rather than silently treated as
 * resolved.
 *
 * CR-3 lifecycle coordination protocol — **cancel first, release only
 * after that is confirmed**: earlier code re-read the Order, decided
 * from that read alone that it was safe to release, and only attempted
 * `changeOrderStatus` afterward. That is provably insufficient: the
 * Order can move to `PAID` in the window between the read and the
 * release, and no later re-read can undo a release that already
 * happened. The fix does not add another read — it reorders the two
 * side effects so the ONE thing in this system that is already atomic
 * (`changeOrderStatus`'s `updateStatusIfCurrent`, a single
 * `UPDATE ... WHERE id = ? AND status = ?`, established by CR-030) is
 * the sole gate: `changeOrderStatus(..., "CANCELLED")` is attempted
 * FIRST, with no prior read of our own. Reservations are released only
 * once that call has been CONFIRMED to have succeeded — never before,
 * and never based on a read that could already be stale by the time the
 * release actually runs. This requires no new primitive, no cross-module
 * transaction, and no ad hoc status write; it is the existing CR-030
 * guarantee used as the single source of truth instead of a read this
 * function performed itself.
 *
 * This closes the checkout side of the race. It depends on one
 * documented, NOT-YET-IMPLEMENTED constraint on the future payment-
 * success path (Increment 5, not approved/not written here): that code
 * must likewise call `changeOrderStatus(orderId, "PAID")` as ITS OWN
 * gate BEFORE calling `consumeReservation` for any item, never the
 * reverse order and never unconditionally. Only then are "release" and
 * "consume" guaranteed never to race each other for the same reservation
 * row — because only one of `PENDING -> CANCELLED` / `PENDING -> PAID`
 * can ever succeed (Postgres's own row lock on the Order row during that
 * single `UPDATE` already guarantees this, with zero new infrastructure),
 * and each side only acts on its own reservations after ITS OWN
 * transition is confirmed. This is flagged here as a requirement for
 * that future, separately-approved work — not implemented, since no
 * payment-success code exists yet to apply it to.
 */
async function cleanupReservationsAndReconcileOrder(
  repository: OrderRepository,
  order: Order,
): Promise<ReservationCleanupOutcome> {
  let cancelResult;
  try {
    cancelResult = await changeOrderStatus(repository, order.id, "CANCELLED");
  } catch (cancelThrow) {
    console.error(
      "[order/checkout-order] changeOrderStatus threw while attempting to cancel during reservation cleanup — compensation is incomplete, no reservation was released",
      { orderId: order.id, cancelThrow },
    );
    return { order, status: "incomplete", unresolvedProductIds: [] };
  }

  if (cancelResult.ok) {
    // CONFIRMED: this attempt's cancellation succeeded — the Order was
    // still PENDING at the exact instant of that atomic write and is now
    // CANCELLED. Only now is it safe to release.
    const unresolvedProductIds = await releaseEachReservationIndependently(cancelResult.order);
    return {
      order: cancelResult.order,
      status: unresolvedProductIds.length > 0 ? "incomplete" : "confirmed",
      unresolvedProductIds,
    };
  }

  if (
    cancelResult.error === "ORDER_STATUS_CHANGED" ||
    cancelResult.error === "INVALID_STATUS_TRANSITION"
  ) {
    // The Order was not PENDING at the time of that atomic write (or of
    // changeOrderStatus's own internal read) — find out what it actually
    // is now, authoritatively, via a fresh read.
    let latest: Order | null;
    try {
      latest = await repository.findById(order.id);
    } catch (rereadError) {
      console.error(
        "[order/checkout-order] could not re-read order after a failed cancellation attempt during cleanup — compensation is incomplete, no reservation was released",
        { orderId: order.id, cancelError: cancelResult.error, rereadError },
      );
      return { order, status: "incomplete", unresolvedProductIds: [] };
    }
    if (!latest) {
      console.error(
        "[order/checkout-order] order not found while reconciling a failed cancellation attempt during cleanup",
        { orderId: order.id, cancelError: cancelResult.error },
      );
      return { order, status: "incomplete", unresolvedProductIds: [] };
    }
    if (latest.status === "PAID") {
      // Confirmed: something else (e.g. a future payment-success path)
      // already won this Order — its reservations are that process's to
      // manage, never released here.
      return { order: latest, status: "confirmed", unresolvedProductIds: [] };
    }
    if (latest.status === "CANCELLED") {
      // Confirmed CANCELLED — but not necessarily by a call that also
      // finished releasing every reservation (e.g. an earlier, crashed
      // attempt). Resuming the release here is safe and idempotent,
      // exactly like `reserveStockForOrder`'s own resume behavior.
      const unresolvedProductIds = await releaseEachReservationIndependently(latest);
      return {
        order: latest,
        status: unresolvedProductIds.length > 0 ? "incomplete" : "confirmed",
        unresolvedProductIds,
      };
    }
    // Still PENDING (or any other value): unexpected given the lifecycle
    // rules (CANCELLED/PAID are both terminal, so this shouldn't be
    // reachable) — never guess, never release.
    console.error(
      "[order/checkout-order] order was neither PAID nor CANCELLED after a failed cancellation attempt during cleanup — compensation is incomplete",
      { orderId: order.id, latestStatus: latest.status, cancelError: cancelResult.error },
    );
    return { order: latest, status: "incomplete", unresolvedProductIds: [] };
  }

  console.error(
    "[order/checkout-order] unexpected changeOrderStatus outcome while attempting to cancel during reservation cleanup",
    { orderId: order.id, error: cancelResult.error },
  );
  return { order, status: "incomplete", unresolvedProductIds: [] };
}

/**
 * IMP-048 Increment 3 (+ CR-2/CR-3 remediation): the one place a resolved
 * Order (freshly created, or found via an idempotency replay) is secured
 * against inventory before `createOrderFromCheckout` hands it back to
 * its caller.
 *
 * - `PENDING`: the normal case — attempt to reserve every item.
 *   - CR-2: if `reserveStockForOrder` itself THROWS (an unexpected fault,
 *     not a normal business outcome), the original error is never
 *     silently lost — cleanup is attempted via
 *     `cleanupReservationsAndReconcileOrder` (logging, never throwing,
 *     itself) and the ORIGINAL error is always re-thrown afterward, so
 *     an unexpected fault still surfaces as one to the caller rather
 *     than being laundered into a normal `INSUFFICIENT_STOCK` result.
 *   - On a clean `{ ok: false }` business-outcome failure, the same
 *     cleanup runs; CR-3: if that cleanup discovers the Order has
 *     actually already reached `PAID` (a concurrent process completed it
 *     before cleanup ran), this reports that real, successful outcome —
 *     never a fabricated `INSUFFICIENT_STOCK` for an Order that actually
 *     succeeded. If cleanup could not be CONFIRMED complete (a release
 *     failed, or the Order's final state couldn't be determined), this
 *     reports `RESERVATION_CLEANUP_INCOMPLETE` instead of
 *     `INSUFFICIENT_STOCK` — never claiming a clean cancellation that
 *     isn't known to be true.
 * - `CANCELLED`: only this function ever cancels a `PENDING` Order today
 *   (no payment integration exists yet in this codebase), and only for
 *   `INSUFFICIENT_STOCK` — but CR-2 (round 4): a `CANCELLED` status
 *   alone does NOT prove every reservation was actually released —
 *   an earlier attempt could have reached `RESERVATION_CLEANUP_INCOMPLETE`
 *   (e.g. a `releaseReservation` call threw) after the Order was already
 *   confirmed cancelled, leaving a reservation dangling. A replay that
 *   finds the Order already `CANCELLED` therefore re-attempts release
 *   for every item (safe and idempotent — see
 *   `releaseEachReservationIndependently`'s own doc comment) and
 *   classifies the actual result before deciding what to report: only
 *   once every item is confirmed-safe does this report
 *   `INSUFFICIENT_STOCK`; otherwise it reports
 *   `RESERVATION_CLEANUP_INCOMPLETE`, exactly like the `PENDING` path
 *   below. This uses only the existing `releaseReservation` repository
 *   capability — no new persistence, schema, or infrastructure.
 * - `PAID`: unreachable until payment integration lands (a separately
 *   approved, later increment) — once it does, this Order's
 *   reservations are already `CONSUMED`, so there is nothing left to
 *   reserve, release, or re-decide; a replay here is a plain success.
 */
async function securePendingReservationsAndFinalize(
  repository: OrderRepository,
  order: Order,
  created: boolean | undefined,
): Promise<CreateOrderFromCheckoutResult> {
  if (order.status === "CANCELLED") {
    const unresolvedProductIds = await releaseEachReservationIndependently(order);
    if (unresolvedProductIds.length > 0) {
      return {
        ok: false,
        error: "RESERVATION_CLEANUP_INCOMPLETE",
        productIds: unresolvedProductIds,
      };
    }
    return { ok: false, error: "INSUFFICIENT_STOCK", productIds: [] };
  }
  if (order.status !== "PENDING") {
    return created === undefined ? { ok: true, order } : { ok: true, order, created };
  }

  let reservation: Awaited<ReturnType<typeof reserveStockForOrder>>;
  try {
    reservation = await reserveStockForOrder(order);
  } catch (reservationError) {
    console.error(
      "[order/checkout-order] reserveStockForOrder threw — attempting compensation before re-raising the original error",
      { orderId: order.id, reservationError },
    );
    const cleanup = await cleanupReservationsAndReconcileOrder(repository, order);
    if (cleanup.status === "incomplete") {
      console.error(
        "[order/checkout-order] compensation after a thrown reservation error was INCOMPLETE — manual reconciliation required",
        { orderId: order.id, unresolvedProductIds: cleanup.unresolvedProductIds, reservationError },
      );
    }
    // CR-2: the original fault must never be laundered into a softer
    // result, regardless of whether compensation itself fully
    // succeeded — a thrown error here is already the strongest, most
    // honest signal this function can give.
    throw reservationError;
  }

  if (reservation.ok) {
    return created === undefined ? { ok: true, order } : { ok: true, order, created };
  }

  const cleanup = await cleanupReservationsAndReconcileOrder(repository, order);

  if (cleanup.status === "incomplete") {
    // CR-2: never claim the Order was successfully cancelled and every
    // reservation released when that isn't known to be true.
    return {
      ok: false,
      error: "RESERVATION_CLEANUP_INCOMPLETE",
      productIds: cleanup.unresolvedProductIds,
    };
  }
  if (cleanup.order.status === "PAID") {
    return { ok: true, order: cleanup.order };
  }
  return { ok: false, error: "INSUFFICIENT_STOCK", productIds: reservation.failedProductIds };
}

/**
 * The one path by which a Checkout submission may become a persisted Order.
 * Trusts only `productId`/`quantity` from the client — every monetary value
 * (unit price, line total, subtotal, total) and every product name/currency
 * is resolved fresh from Catalog's server-side boundary and calculated here,
 * never taken from client input. This is what resolves CR-IMP025-F01: the
 * lower-level `OrderRepository.create`/`NewOrderInput` contract still
 * technically accepts arbitrary totals (a repository has no business
 * rejecting data handed to it), but this function is the only place in the
 * codebase that is allowed to construct that input for a real checkout, and
 * it only ever does so from values it computed itself.
 *
 * Resolves all Cart product IDs in a single batched Catalog call — never
 * one request per product. If any item fails to resolve (nonexistent,
 * DRAFT, ARCHIVED — Catalog's own ACTIVE-only rule applies here exactly as
 * it does everywhere else), the whole Order is rejected; nothing is ever
 * partially persisted.
 */
export async function createOrderFromCheckout(
  repository: OrderRepository,
  rawRequest: CheckoutOrderRequest,
): Promise<CreateOrderFromCheckoutResult> {
  if (rawRequest.items.length === 0) {
    return { ok: false, error: "EMPTY_CART" };
  }

  // CR-1: merge duplicate productId lines before anything else — see
  // `aggregateCheckoutItems`'s own doc comment for why this must happen
  // first, ahead of quantity validation (so the ceiling applies to the
  // real per-product total, not a bypassable per-line value).
  const request: CheckoutOrderRequest = {
    ...rawRequest,
    items: aggregateCheckoutItems(rawRequest.items),
  };

  // Checked before any arithmetic — an out-of-range quantity must never
  // reach `priceAmountMinor * quantity` below.
  for (const item of request.items) {
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > MAX_QUANTITY_PER_ITEM
    ) {
      return { ok: false, error: "INVALID_QUANTITY", productId: item.productId };
    }
  }

  // CR-031-02: the fingerprint depends only on what the client submitted
  // plus the resolved userId/locale — never on Catalog-resolved data — so
  // it can be computed here, before any Catalog call. This lets a replay of
  // an already-claimed key be recognized (and answered) without touching
  // Catalog at all, so a submission that succeeded once keeps replaying
  // successfully even if the product it originally resolved later becomes
  // unavailable. Two concurrent *first* requests for a brand-new key both
  // see no existing record here and both fall through to the normal
  // Catalog-resolution path below, ending at `createIdempotent`'s atomic
  // INSERT — unaffected by this early check.
  if (request.idempotencyKey) {
    const idempotencyRequestHash = computeCheckoutSubmissionFingerprint({
      customer: request.customer,
      items: request.items,
      deliveryAmountMinor: request.deliveryAmountMinor,
      locale: request.locale,
      userId: request.userId ?? null,
    });

    const existing = await repository.findIdempotencyRecord(request.idempotencyKey);
    if (existing) {
      if (existing.idempotencyRequestHash === idempotencyRequestHash) {
        // IMP-048 Increment 3: a replay must still resume/verify stock
        // reservation — see `securePendingReservationsAndFinalize`'s own
        // doc comment for why this is safe to run unconditionally, even
        // though the common case (an attempt that already fully
        // succeeded) does nothing new here.
        return securePendingReservationsAndFinalize(repository, existing.order, false);
      }
      return { ok: false, error: "IDEMPOTENCY_KEY_CONFLICT" };
    }

    return createNewOrder(repository, request, idempotencyRequestHash);
  }

  return createNewOrder(repository, request);
}

async function createNewOrder(
  repository: OrderRepository,
  request: CheckoutOrderRequest,
  idempotencyRequestHash?: string,
): Promise<CreateOrderFromCheckoutResult> {
  const uniqueProductIds = Array.from(new Set(request.items.map((item) => item.productId)));
  const products = await getProductsByIds(uniqueProductIds, request.locale);
  const productsById = new Map(products.map((product) => [product.id, product]));

  const unresolvedProductIds = Array.from(
    new Set(
      request.items
        .map((item) => item.productId)
        .filter((productId) => !productsById.has(productId)),
    ),
  );
  if (unresolvedProductIds.length > 0) {
    return { ok: false, error: "UNRESOLVED_PRODUCTS", productIds: unresolvedProductIds };
  }

  const items = request.items.map((item) => {
    // Non-null: every productId was just confirmed present in productsById above.
    const product = productsById.get(item.productId)!;
    return {
      productId: product.id,
      productName: product.translation.name,
      // IMP-047: `effectivePriceAmountMinor` is the ONE shared
      // server-side price calculation (`resolveEffectivePrice`, resolved
      // inside Catalog) — this is the only place Order creation ever
      // reads a price from, never `priceAmountMinor` directly, and never
      // anything the client submitted. `regularUnitPriceAmountMinor`
      // captures the pre-discount price in the same immutable snapshot,
      // so a later discount/price change never alters this order's
      // own history.
      regularUnitPriceAmountMinor: product.priceAmountMinor,
      unitPriceAmountMinor: product.effectivePriceAmountMinor,
      quantity: item.quantity,
      lineTotalAmountMinor: product.effectivePriceAmountMinor * item.quantity,
      currency: product.currency,
    };
  });

  const currency = items[0]!.currency;
  if (items.some((item) => item.currency !== currency)) {
    // Every seeded product currently shares one currency; this only guards
    // against a future Catalog change silently mixing currencies into one
    // Order rather than pretending a single total is meaningful.
    return { ok: false, error: "INCONSISTENT_CURRENCY" };
  }

  // Defense in depth beyond MAX_QUANTITY_PER_ITEM: guards a single line
  // total against an unexpectedly high Catalog price, independent of
  // whether the quantity itself was in range.
  if (items.some((item) => !isWithinSafeAmountRange(item.lineTotalAmountMinor))) {
    return { ok: false, error: "AMOUNT_OUT_OF_RANGE" };
  }

  const subtotalAmountMinor = items.reduce((sum, item) => sum + item.lineTotalAmountMinor, 0);
  const totalAmountMinor = subtotalAmountMinor + request.deliveryAmountMinor;

  if (!isWithinSafeAmountRange(subtotalAmountMinor) || !isWithinSafeAmountRange(totalAmountMinor)) {
    return { ok: false, error: "AMOUNT_OUT_OF_RANGE" };
  }

  const newOrderInput = {
    status: "PENDING" as const,
    firstName: request.customer.firstName,
    lastName: request.customer.lastName,
    email: request.customer.email,
    phone: request.customer.phone,
    userId: request.userId ?? null,
    subtotalAmountMinor,
    deliveryAmountMinor: request.deliveryAmountMinor,
    totalAmountMinor,
    currency,
    items,
  };

  if (!request.idempotencyKey || !idempotencyRequestHash) {
    const order = await repository.create(newOrderInput);
    return securePendingReservationsAndFinalize(repository, order, undefined);
  }

  const result = await repository.createIdempotent({
    ...newOrderInput,
    idempotencyKey: request.idempotencyKey,
    idempotencyRequestHash,
  });

  if (result.outcome === "conflict") {
    return { ok: false, error: "IDEMPOTENCY_KEY_CONFLICT" };
  }

  return securePendingReservationsAndFinalize(
    repository,
    result.order,
    result.outcome === "created",
  );
}
