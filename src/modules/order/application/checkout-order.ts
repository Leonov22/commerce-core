import "server-only";
import { getProductsByIds } from "@/modules/catalog";
import { computeCheckoutSubmissionFingerprint } from "@/modules/order/application/idempotency";
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
  | { ok: false; error: "IDEMPOTENCY_KEY_CONFLICT" };

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
      unitPriceAmountMinor: product.priceAmountMinor,
      quantity: item.quantity,
      lineTotalAmountMinor: product.priceAmountMinor * item.quantity,
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

  if (!request.idempotencyKey) {
    const order = await repository.create(newOrderInput);
    return { ok: true, order };
  }

  // IMP-031: fingerprint the *client-submitted* request (raw items +
  // customer + delivery amount + resolved userId), not the Catalog-resolved
  // `items` built above — a Catalog price change between two retries of the
  // same cart must never make a genuine retry look like a conflict.
  const idempotencyRequestHash = computeCheckoutSubmissionFingerprint({
    customer: request.customer,
    items: request.items,
    deliveryAmountMinor: request.deliveryAmountMinor,
    userId: request.userId ?? null,
  });

  const result = await repository.createIdempotent({
    ...newOrderInput,
    idempotencyKey: request.idempotencyKey,
    idempotencyRequestHash,
  });

  if (result.outcome === "conflict") {
    return { ok: false, error: "IDEMPOTENCY_KEY_CONFLICT" };
  }

  return { ok: true, order: result.order, created: result.outcome === "created" };
}
