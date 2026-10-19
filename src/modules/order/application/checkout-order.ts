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
 * IMP-048 Increment 3: the one place a resolved Order (freshly created,
 * or found via an idempotency replay) is secured against inventory
 * before `createOrderFromCheckout` hands it back to its caller.
 *
 * - `PENDING`: the normal case — attempt to reserve every item. On
 *   failure, release whatever this attempt reserved and cancel the
 *   Order via the existing, atomic `changeOrderStatus` lifecycle
 *   primitive (never an ad hoc status write) — which itself safely
 *   no-ops if some other concurrent call already moved the Order away
 *   from `PENDING` by the time this runs, satisfying "never cancel an
 *   Order that already progressed to a non-pending state" without this
 *   function needing its own extra guard for that race.
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
  if (order.status === "PENDING") {
    const reservation = await reserveStockForOrder(order);
    if (!reservation.ok) {
      await releaseAllReservationsForOrder(order);
      await changeOrderStatus(repository, order.id, "CANCELLED");
      return { ok: false, error: "INSUFFICIENT_STOCK", productIds: reservation.failedProductIds };
    }
  }
  return created === undefined ? { ok: true, order } : { ok: true, order, created };
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
  request: CheckoutOrderRequest,
): Promise<CreateOrderFromCheckoutResult> {
  if (request.items.length === 0) {
    return { ok: false, error: "EMPTY_CART" };
  }

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
