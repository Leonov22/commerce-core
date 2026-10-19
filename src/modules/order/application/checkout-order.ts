import "server-only";
import { getProductsByIds, reserveStock, releaseReservation } from "@/modules/catalog";
import { computeCheckoutSubmissionFingerprint } from "@/modules/order/application/idempotency";
import { changeOrderStatus } from "@/modules/order/application/order-status";
import type { OrderRepository } from "@/modules/order/repositories/order-repository";
import type { Order } from "@/modules/order/domain/order";

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
  | { ok: false; error: "INSUFFICIENT_STOCK"; productIds: string[] };

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
 * Releases every item of an Order's reservations unconditionally — safe
 * and idempotent to call for an item that was never reserved at all
 * (untracked, or never reached by `reserveStockForOrder`'s early stop:
 * `releaseReservation` simply reports `"notFound"`, a no-op) and for one
 * already released by an earlier attempt (`"alreadyReleased"`, also a
 * no-op). This is deliberately not told which items `reserveStockForOrder`
 * actually created this call — looping over every item and letting each
 * release be a safe no-op is simpler and more robust than tracking it.
 */
async function releaseAllReservationsForOrder(order: Order): Promise<void> {
  for (const item of order.items) {
    await releaseReservation(order.id, item.productId);
  }
}

/**
 * CR-2 / CR-3: the one place reservation cleanup (release + cancel)
 * actually happens — used both when `reserveStockForOrder` cleanly
 * reports a business-outcome failure and when it THROWS (an unexpected
 * fault, e.g. a transient database error). Never throws itself: every
 * internal failure is logged loudly (`console.error`, matching this
 * codebase's existing convention — see `stripe-webhook.ts`/
 * `process-stripe-webhook-event.ts`) rather than silently swallowed, so
 * cleanup failures are observable instead of disappearing. The caller
 * always gets back the best currently-known Order state and decides what
 * to report from that, never from a stale assumption.
 *
 * CR-3: re-reads the Order's authoritative state FIRST and never
 * releases or cancels an Order that has already moved away from
 * `PENDING` (e.g. a concurrent payment success/failure elsewhere) — that
 * Order's reservations belong to whichever process moved it, not to this
 * cleanup. If `changeOrderStatus` itself reports the narrower race
 * (`ORDER_STATUS_CHANGED` — the Order moved on between this function's
 * own re-read and its cancel attempt), it resolves by reading once more
 * rather than looping indefinitely: the lifecycle only ever moves
 * forward once (CR-030), so a second read is sufficient in practice.
 *
 * Deliberately does not introduce a cross-module transaction or any ad
 * hoc status write — reconciliation uses only the existing, atomic
 * `changeOrderStatus`/`OrderRepository.findById` primitives already
 * established by CR-030. If those primitives ever report something this
 * function doesn't recognize, it logs loudly and returns the
 * last-known Order rather than inventing a new mechanism.
 */
async function cleanupReservationsAndReconcileOrder(
  repository: OrderRepository,
  order: Order,
): Promise<Order> {
  let current: Order | null = order;
  try {
    current = await repository.findById(order.id);
  } catch (readError) {
    console.error(
      "[order/checkout-order] could not re-read order before reservation cleanup — proceeding with the last-known state",
      { orderId: order.id, readError },
    );
  }
  if (!current) {
    console.error(
      "[order/checkout-order] order not found during reservation cleanup — nothing to reconcile",
      { orderId: order.id },
    );
    return order;
  }
  if (current.status !== "PENDING") {
    // Already moved on (e.g. a concurrent payment success/failure) —
    // never release or cancel; its reservations belong to whichever
    // process moved it, not to this cleanup.
    return current;
  }

  try {
    await releaseAllReservationsForOrder(current);
  } catch (releaseError) {
    console.error(
      "[order/checkout-order] failed to release one or more reservations during cleanup — manual reconciliation required",
      { orderId: current.id, releaseError },
    );
  }

  let cancelResult;
  try {
    cancelResult = await changeOrderStatus(repository, current.id, "CANCELLED");
  } catch (cancelThrow) {
    console.error(
      "[order/checkout-order] changeOrderStatus itself threw during reservation cleanup — manual reconciliation required",
      { orderId: current.id, cancelThrow },
    );
    return current;
  }

  if (cancelResult.ok) {
    return cancelResult.order;
  }

  if (cancelResult.error === "ORDER_STATUS_CHANGED") {
    try {
      const latest = await repository.findById(current.id);
      if (latest) {
        return latest;
      }
    } catch (rereadError) {
      console.error(
        "[order/checkout-order] could not re-read order after a status-change race during cleanup",
        { orderId: current.id, rereadError },
      );
    }
    return current;
  }

  console.error(
    "[order/checkout-order] unexpected changeOrderStatus outcome during reservation cleanup",
    { orderId: current.id, error: cancelResult.error },
  );
  return current;
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
 *     succeeded.
 * - `CANCELLED`: only this function ever cancels a `PENDING` Order
 *   today (no payment integration exists yet in this codebase), and
 *   only for `INSUFFICIENT_STOCK` — so a replay that resolves to an
 *   already-`CANCELLED` Order is consistently re-reporting that same
 *   original failure, never fabricating a success. This inference would
 *   need revisiting if a future increment introduces another path to
 *   `CANCELLED`. `productIds` is empty here — this function doesn't
 *   re-derive which item originally failed, only that this submission
 *   did.
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
      "[order/checkout-order] reserveStockForOrder threw — attempting compensation before re-raising",
      { orderId: order.id, reservationError },
    );
    await cleanupReservationsAndReconcileOrder(repository, order);
    throw reservationError;
  }

  if (reservation.ok) {
    return created === undefined ? { ok: true, order } : { ok: true, order, created };
  }

  const finalOrder = await cleanupReservationsAndReconcileOrder(repository, order);
  if (finalOrder.status === "PAID") {
    return { ok: true, order: finalOrder };
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
