import "dotenv/config";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  createOrderFromCheckout,
  MAX_QUANTITY_PER_ITEM,
  MAX_AMOUNT_MINOR,
  isWithinSafeAmountRange,
} from "@/modules/order/application/checkout-order";
import type {
  CheckoutOrderCustomer,
  CheckoutOrderItemRequest,
} from "@/modules/order/application/checkout-order";
import { computeCheckoutSubmissionFingerprint } from "@/modules/order/application/idempotency";
import type {
  OrderRepository,
  NewOrderInput,
  CreateIdempotentOrderInput,
  CreateIdempotentOrderResult,
} from "@/modules/order/repositories/order-repository";
import type { Order } from "@/modules/order/domain/order";
import type { Product } from "@/modules/catalog/domain/product";
import { prismaOrderRepository } from "@/modules/order/infrastructure/prisma-order-repository";
import { prisma } from "@/modules/order/infrastructure/prisma-client";
import { prisma as catalogPrisma } from "@/modules/catalog/infrastructure/prisma-client";

/**
 * `qa-overflow-fixture` is a reserved id intercepted by the `@/modules/catalog`
 * partial mock below — every other id is passed through to the real Catalog
 * boundary unchanged. `vi.hoisted` is required (rather than a plain `const`)
 * because Vitest hoists `vi.mock` factories above all other module code; a
 * factory that closed over an un-hoisted `const` would hit it before
 * initialization.
 */
const {
  OVERFLOW_PRODUCT_ID,
  MIXED_CURRENCY_PRODUCT_ID,
  unavailableProductIds,
  reserveStockThrowForProductIds,
  releaseReservationThrowForProductIds,
} = vi.hoisted(() => ({
  OVERFLOW_PRODUCT_ID: "qa-overflow-fixture",
  // PR2-F02: a reserved id resolving to a different currency ("EUR")
  // than the real seeded products (currently "USD") — lets a test prove
  // the mixed-currency rejection below without depending on the real
  // Catalog ever actually holding products in two currencies at once.
  MIXED_CURRENCY_PRODUCT_ID: "qa-mixed-currency-fixture",
  // CR-031-02: a mutable set of product ids the mock pretends Catalog can no
  // longer resolve — lets a test simulate "this product became unavailable
  // between the original submission and a later retry" without touching
  // real seeded data. Tests that use this must always remove their id(s)
  // afterward (a `finally` block), since this set is shared module state
  // across every test in this file.
  unavailableProductIds: new Set<string>(),
  // CR-2 remediation: mutable sets of product ids for which the mock makes
  // `reserveStock`/`releaseReservation` THROW instead of delegating to the
  // real Catalog inventory repository — lets a test simulate an unexpected
  // infrastructure fault partway through a multi-item checkout without
  // needing to break the real database. Tests that use these must always
  // remove their id(s) afterward (shared module state across this file).
  reserveStockThrowForProductIds: new Set<string>(),
  releaseReservationThrowForProductIds: new Set<string>(),
}));

/**
 * Real seeded Catalog prices ($86-$310) can never drive
 * `createOrderFromCheckout` to overflow PostgreSQL's INTEGER range through
 * the real pipeline, so this partial mock intercepts exactly one reserved
 * product id and returns a fixture priced high enough to overflow when
 * multiplied by an in-range quantity — every other id still resolves
 * against the real seeded Neon data via `importOriginal`, so none of the
 * other tests in this file are affected.
 */
vi.mock("@/modules/catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/catalog")>();
  const overflowFixture: Product = {
    id: "qa-overflow-fixture",
    slug: "qa-overflow-fixture",
    status: "ACTIVE",
    priceAmountMinor: 1_200_000_000,
    currency: "USD",
    categorySlug: "qa",
    badge: null,
    isFeatured: false,
    sortOrder: 0,
    imageUrl: null,
    imageAlt: null,
    effectivePriceAmountMinor: 1_200_000_000,
    activeDiscount: null,
    translation: {
      locale: "en",
      name: "QA Overflow Fixture",
      meta: "",
      description: "",
      material: "",
      dimensions: "",
    },
  };

  const mixedCurrencyFixture: Product = {
    id: "qa-mixed-currency-fixture",
    slug: "qa-mixed-currency-fixture",
    status: "ACTIVE",
    priceAmountMinor: 10000,
    currency: "EUR",
    categorySlug: "qa",
    badge: null,
    isFeatured: false,
    sortOrder: 0,
    imageUrl: null,
    imageAlt: null,
    effectivePriceAmountMinor: 10000,
    activeDiscount: null,
    translation: {
      locale: "en",
      name: "QA Mixed Currency Fixture",
      meta: "",
      description: "",
      material: "",
      dimensions: "",
    },
  };

  return {
    ...actual,
    getProductsByIds: async (ids: string[], locale: string) => {
      if (ids.length === 1 && ids[0] === "qa-overflow-fixture") {
        return [overflowFixture];
      }
      if (ids.includes(MIXED_CURRENCY_PRODUCT_ID)) {
        const otherIds = ids.filter((id) => id !== MIXED_CURRENCY_PRODUCT_ID);
        const resolvedOthers =
          otherIds.length > 0
            ? (await actual.getProductsByIds(otherIds, locale)).filter(
                (product) => !unavailableProductIds.has(product.id),
              )
            : [];
        return [...resolvedOthers, mixedCurrencyFixture];
      }
      const resolved = await actual.getProductsByIds(ids, locale);
      return resolved.filter((product) => !unavailableProductIds.has(product.id));
    },
    reserveStock: async (input: Parameters<typeof actual.reserveStock>[0]) => {
      if (reserveStockThrowForProductIds.has(input.productId)) {
        throw new Error(`QA-injected reserveStock failure for ${input.productId}`);
      }
      return actual.reserveStock(input);
    },
    releaseReservation: async (orderId: string, productId: string) => {
      if (releaseReservationThrowForProductIds.has(productId)) {
        throw new Error(`QA-injected releaseReservation failure for ${productId}`);
      }
      return actual.releaseReservation(orderId, productId);
    },
  };
});

/**
 * Integration-ish tests: `createOrderFromCheckout` resolves products through
 * the real Catalog boundary against the real Neon database (the seeded
 * products "1".."6"), the same way it will at runtime — Catalog resolution
 * isn't dependency-injected (see the architecture note in
 * `checkout-order.ts`), so there is no fake to substitute for it. The
 * `OrderRepository` it also depends on *is* injected, so a fake is used
 * there — nothing is actually persisted by these tests, which is why no
 * cleanup step is needed here (contrast with `prisma-order-repository.test.ts`,
 * which exercises the real repository and does clean up).
 */

function makeFakeRepository(): {
  repository: OrderRepository;
  calls: NewOrderInput[];
  createIdempotentCalls: CreateIdempotentOrderInput[];
} {
  const calls: NewOrderInput[] = [];
  const createIdempotentCalls: CreateIdempotentOrderInput[] = [];
  // IMP-031: mirrors the real Prisma repository's `idempotencyKey` unique
  // constraint semantics — a key maps to at most one persisted Order and
  // its fingerprint, forever; a second `createIdempotent` call under the
  // same key never persists a second Order, it only resolves against
  // whichever one is already in this map.
  const byIdempotencyKey = new Map<string, { order: Order; hash: string }>();
  // IMP-048 Increment 3: backs `findById`/`updateStatusIfCurrent` — every
  // order this fake ever builds (via either `create` or
  // `createIdempotent`) is registered here, so a checkout that goes on to
  // cancel itself (an insufficient-stock reservation failure) can be
  // looked up and conditionally transitioned exactly like the real
  // repository would, rather than throwing on a method no earlier test
  // needed.
  const ordersById = new Map<string, Order>();
  let nextOrderId = 0;

  function buildOrder(input: NewOrderInput, id: string): Order {
    const now = new Date();
    const order: Order = {
      id,
      status: input.status ?? "PENDING",
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      userId: input.userId,
      subtotalAmountMinor: input.subtotalAmountMinor,
      deliveryAmountMinor: input.deliveryAmountMinor,
      totalAmountMinor: input.totalAmountMinor,
      currency: input.currency,
      createdAt: now,
      updatedAt: now,
      items: input.items.map((item, index) => ({
        id: `fake-item-${id}-${index}`,
        orderId: id,
        ...item,
      })),
    };
    ordersById.set(id, order);
    return order;
  }

  const repository: OrderRepository = {
    async create(input) {
      calls.push(input);
      return buildOrder(input, "fake-order-id");
    },
    // Not exercised by this file's tests (IMP-026/026-FIX/026-FIX-TESTS
    // predate customer order history) — present only to satisfy
    // `OrderRepository`'s shape.
    async findManyByUserId() {
      throw new Error("not used by these tests");
    },
    async findByIdForUser() {
      throw new Error("not used by these tests");
    },
    async findById(orderId) {
      return ordersById.get(orderId) ?? null;
    },
    async updateStatusIfCurrent(orderId, expectedStatus, nextStatus) {
      const order = ordersById.get(orderId);
      if (!order || order.status !== expectedStatus) {
        return null;
      }
      const updated: Order = { ...order, status: nextStatus, updatedAt: new Date() };
      ordersById.set(orderId, updated);
      return updated;
    },
    async createIdempotent(input): Promise<CreateIdempotentOrderResult> {
      createIdempotentCalls.push(input);
      const existing = byIdempotencyKey.get(input.idempotencyKey);
      if (existing) {
        if (existing.hash === input.idempotencyRequestHash) {
          // Re-read from `ordersById` rather than the snapshot captured
          // at creation time — `updateStatusIfCurrent` (e.g. this
          // Order's own reservation-failure cancellation) only updates
          // that map, so this must too, or a replay would see a stale
          // status.
          return {
            outcome: "duplicate",
            order: ordersById.get(existing.order.id) ?? existing.order,
          };
        }
        return { outcome: "conflict" };
      }
      nextOrderId += 1;
      const order = buildOrder(input, `fake-order-id-${nextOrderId}`);
      byIdempotencyKey.set(input.idempotencyKey, { order, hash: input.idempotencyRequestHash });
      return { outcome: "created", order };
    },
    async findIdempotencyRecord(idempotencyKey: string) {
      const existing = byIdempotencyKey.get(idempotencyKey);
      if (!existing) {
        return null;
      }
      const order = ordersById.get(existing.order.id) ?? existing.order;
      return { order, idempotencyRequestHash: existing.hash };
    },
  };
  return { repository, calls, createIdempotentCalls };
}

const validCustomer: CheckoutOrderCustomer = {
  firstName: "John",
  lastName: "Smith",
  email: "john.smith@example.com",
  phone: "+421 900 123 456",
};

describe("createOrderFromCheckout", () => {
  it("creates a PENDING order from a single resolved product with authoritative name/price", async () => {
    const { repository, calls } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.status).toBe("PENDING");
    expect(calls).toHaveLength(1);
    // Authoritative — from Catalog, never from client input (which never
    // supplied a name or price at all here).
    expect(calls[0]?.items[0]?.productName).toBe("Studio Chair");
    expect(calls[0]?.items[0]?.unitPriceAmountMinor).toBe(24000);
  });

  it("calculates line totals, subtotal, and total server-side", async () => {
    const { repository } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 2 }], // 24000 * 2
      deliveryAmountMinor: 800,
      locale: "en",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.items[0]?.lineTotalAmountMinor).toBe(48000);
    expect(result.order.subtotalAmountMinor).toBe(48000);
    expect(result.order.deliveryAmountMinor).toBe(800);
    expect(result.order.totalAmountMinor).toBe(48800);
  });

  it("supports multiple products in one order", async () => {
    const { repository } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [
        { productId: "1", quantity: 1 },
        { productId: "3", quantity: 2 },
      ],
      deliveryAmountMinor: 800,
      locale: "en",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.items).toHaveLength(2);
    // 24000 + (9600 * 2 = 19200) = 43200
    expect(result.order.subtotalAmountMinor).toBe(43200);
  });

  it("persists the customer snapshot fields exactly as submitted", async () => {
    const { repository } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: {
        firstName: "Jean",
        lastName: "Dupont",
        email: "jean@example.com",
        phone: "+33 6 12 34 56 78",
      },
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 1800,
      locale: "en",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.firstName).toBe("Jean");
    expect(result.order.lastName).toBe("Dupont");
    expect(result.order.email).toBe("jean@example.com");
    expect(result.order.phone).toBe("+33 6 12 34 56 78");
  });

  it("takes currency from Catalog, never from client input", async () => {
    const { repository } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.currency).toBe("USD");
    expect(result.order.items[0]?.currency).toBe("USD");
  });

  it("uses the server-supplied delivery amount as the authoritative one", async () => {
    const { repository } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 1800, // "express"
      locale: "en",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.deliveryAmountMinor).toBe(1800);
    expect(result.order.totalAmountMinor).toBe(24000 + 1800);
  });

  it("fails with EMPTY_CART for an empty items array, and never calls the repository", async () => {
    const { repository, calls } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [],
      deliveryAmountMinor: 800,
      locale: "en",
    });

    expect(result).toEqual({ ok: false, error: "EMPTY_CART" });
    expect(calls).toHaveLength(0);
  });

  it("fails with INVALID_QUANTITY for a zero quantity, and never calls the repository", async () => {
    const { repository, calls } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 0 }],
      deliveryAmountMinor: 800,
      locale: "en",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("INVALID_QUANTITY");
    expect(calls).toHaveLength(0);
  });

  it("fails with INVALID_QUANTITY for a negative quantity", async () => {
    const { repository } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: -1 }],
      deliveryAmountMinor: 800,
      locale: "en",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("INVALID_QUANTITY");
  });

  it("fails with INVALID_QUANTITY for a fractional quantity, and never calls the repository", async () => {
    const { repository, calls } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 1.5 }],
      deliveryAmountMinor: 800,
      locale: "en",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("INVALID_QUANTITY");
    expect(calls).toHaveLength(0);
  });

  it("accepts a quantity of exactly 1", async () => {
    const { repository, calls } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("accepts a quantity of exactly MAX_QUANTITY_PER_ITEM", async () => {
    const { repository, calls } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: MAX_QUANTITY_PER_ITEM }],
      deliveryAmountMinor: 800,
      locale: "en",
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("fails with INVALID_QUANTITY for MAX_QUANTITY_PER_ITEM + 1, and never calls the repository", async () => {
    const { repository, calls } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: MAX_QUANTITY_PER_ITEM + 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("INVALID_QUANTITY");
    expect(calls).toHaveLength(0);
  });

  it("fails with INVALID_QUANTITY for an absurdly large quantity, and never calls the repository", async () => {
    const { repository, calls } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 9_999_999_999 }],
      deliveryAmountMinor: 800,
      locale: "en",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("INVALID_QUANTITY");
    expect(calls).toHaveLength(0);
  });

  it("fails with UNRESOLVED_PRODUCTS for a nonexistent product and creates no order at all", async () => {
    const { repository, calls } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [
        { productId: "1", quantity: 1 },
        { productId: "999", quantity: 1 },
      ],
      deliveryAmountMinor: 800,
      locale: "en",
    });

    expect(result.ok).toBe(false);
    if (result.ok || result.error !== "UNRESOLVED_PRODUCTS") {
      throw new Error("expected UNRESOLVED_PRODUCTS");
    }
    expect(result.productIds).toEqual(["999"]);
    // No partial order — the repository was never even called.
    expect(calls).toHaveLength(0);
  });

  it("does not silently drop the unresolved item and price only the resolvable ones", async () => {
    const { repository, calls } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "999", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
    });

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

/**
 * Customer ownership association (IMP-029): `userId` is trusted exactly as
 * given by the caller (the API route, which derives it server-side via
 * Identity's `getCurrentUser()`) — this function never re-derives it, and
 * never reads it from anywhere but this explicit request field.
 */
describe("createOrderFromCheckout — customer ownership (IMP-029)", () => {
  it("assigns the given userId to the created order for an authenticated checkout", async () => {
    const { repository, calls } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
      userId: "user-123",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.userId).toBe("user-123");
    expect(calls[0]?.userId).toBe("user-123");
  });

  it("assigns null for a guest checkout when userId is explicitly null", async () => {
    const { repository, calls } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
      userId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.userId).toBeNull();
    expect(calls[0]?.userId).toBeNull();
  });

  it("defaults to null for a guest checkout when userId is omitted entirely", async () => {
    const { repository, calls } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.userId).toBeNull();
    expect(calls[0]?.userId).toBeNull();
  });
});

/**
 * Closes QA-02: proves the monetary-range guard is actually wired into the
 * real `createOrderFromCheckout` pipeline — Catalog price resolution,
 * quantity multiplication, and the guard itself, in that order — not just
 * that `isWithinSafeAmountRange` is correct in isolation. Regression
 * protection against a future change that moves or removes the guard
 * relative to `repository.create()`.
 */
describe("createOrderFromCheckout — monetary overflow (application path)", () => {
  it("rejects a Catalog-price-derived line total exceeding MAX_AMOUNT_MINOR with AMOUNT_OUT_OF_RANGE, and never calls the repository", async () => {
    const { repository, calls } = makeFakeRepository();
    // 1_200_000_000 * 2 = 2_400_000_000, which exceeds MAX_AMOUNT_MINOR
    // (2_147_483_647) — the price comes from the mocked Catalog boundary
    // above, exercised through the real function, not asserted directly.
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: OVERFLOW_PRODUCT_ID, quantity: 2 }],
      deliveryAmountMinor: 800,
      locale: "en",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("AMOUNT_OUT_OF_RANGE");
    expect(calls).toHaveLength(0);
  });
});

/**
 * PR2-F02 (independent Code Review of PR #2): demonstrates that
 * `createOrderFromCheckout` already enforces a single-currency invariant
 * across resolved cart lines, independent of and in addition to the
 * client-side presentation fix in `resolveCheckoutSummary`
 * (`checkout.ts`/`checkout.test.ts`). This is the authoritative
 * server-side path — client-only validation would be insufficient, since
 * a request can reach `POST /api/orders` without having gone through the
 * checkout UI at all.
 */
describe("createOrderFromCheckout — single-currency invariant (PR2-F02)", () => {
  it("rejects a cart whose resolved lines span more than one currency with INCONSISTENT_CURRENCY, and never calls the repository", async () => {
    const { repository, calls } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [
        { productId: "1", quantity: 1 }, // real seeded product, currency "USD"
        { productId: MIXED_CURRENCY_PRODUCT_ID, quantity: 1 }, // fixture, currency "EUR"
      ],
      deliveryAmountMinor: 800,
      locale: "en",
    });

    expect(result).toEqual({ ok: false, error: "INCONSISTENT_CURRENCY" });
    expect(calls).toHaveLength(0);
  });
});

/**
 * IMP-031 checkout submission idempotency, at the application layer. The
 * `OrderRepository` here is a fake that genuinely implements
 * `createIdempotent`'s conditional semantics (see `makeFakeRepository`
 * above) — real database-enforced atomicity under actual concurrency is
 * covered separately in `prisma-order-repository.test.ts`, against the real
 * repository and a real Postgres unique constraint.
 */
describe("createOrderFromCheckout — idempotency (IMP-031)", () => {
  it("Case 1: a new idempotency key creates exactly one Order and reports created: true", async () => {
    const { repository, createIdempotentCalls } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
      idempotencyKey: "key-case-1-aaaaaaaaaaaa",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(createIdempotentCalls).toHaveLength(1);
    expect(createIdempotentCalls[0]?.idempotencyKey).toBe("key-case-1-aaaaaaaaaaaa");
  });

  it("Case 2: replaying the same key with the same logical request returns the same Order and reports created: false, without a second repository create", async () => {
    const { repository } = makeFakeRepository();
    const submit = () =>
      createOrderFromCheckout(repository, {
        customer: validCustomer,
        items: [{ productId: "1", quantity: 1 }],
        deliveryAmountMinor: 800,
        locale: "en",
        idempotencyKey: "key-case-2-aaaaaaaaaaaa",
      });

    const first = await submit();
    const second = await submit();

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.order.id).toBe(first.order.id);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });

  it("Case 4: different keys for otherwise-identical requests create independent Orders", async () => {
    const { repository } = makeFakeRepository();
    const first = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
      idempotencyKey: "key-case-4-a-aaaaaaaaaaaa",
    });
    const second = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
      idempotencyKey: "key-case-4-b-aaaaaaaaaaaa",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.order.id).not.toBe(second.order.id);
    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
  });

  it("Case 5: the same key with a different cart is rejected with IDEMPOTENCY_KEY_CONFLICT, and the original Order is not returned", async () => {
    const { repository } = makeFakeRepository();
    const key = "key-case-5-aaaaaaaaaaaaaa";
    const first = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
      idempotencyKey: key,
    });
    expect(first.ok).toBe(true);

    const second = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 2 }], // different cart, same key
      deliveryAmountMinor: 800,
      locale: "en",
      idempotencyKey: key,
    });

    expect(second).toEqual({ ok: false, error: "IDEMPOTENCY_KEY_CONFLICT" });
  });

  it("Case 5: the same key with different customer info is rejected with IDEMPOTENCY_KEY_CONFLICT", async () => {
    const { repository } = makeFakeRepository();
    const key = "key-case-5b-aaaaaaaaaaaaa";
    const first = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
      idempotencyKey: key,
    });
    expect(first.ok).toBe(true);

    const second = await createOrderFromCheckout(repository, {
      customer: { ...validCustomer, email: "someone-else@example.com" },
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
      idempotencyKey: key,
    });

    expect(second).toEqual({ ok: false, error: "IDEMPOTENCY_KEY_CONFLICT" });
  });

  it("Case 6/9: a guest reusing an authenticated user's key gets a conflict, never that user's Order (ownership isolation)", async () => {
    const { repository } = makeFakeRepository();
    const key = "key-case-9-aaaaaaaaaaaaaa";
    const authenticated = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
      userId: "user-a",
      idempotencyKey: key,
    });
    expect(authenticated.ok).toBe(true);

    // Same cart, same customer info, same key — the ONLY difference is the
    // resolved userId (guest vs. the original authenticated user). Must
    // not resolve as a "duplicate" and hand back user-a's Order.
    const guestReplay = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
      userId: null,
      idempotencyKey: key,
    });

    expect(guestReplay).toEqual({ ok: false, error: "IDEMPOTENCY_KEY_CONFLICT" });
  });

  it("Case 6: guest idempotency — a retry by the same guest (no session) returns the same Order and userId stays null", async () => {
    const { repository } = makeFakeRepository();
    const submit = () =>
      createOrderFromCheckout(repository, {
        customer: validCustomer,
        items: [{ productId: "1", quantity: 1 }],
        deliveryAmountMinor: 800,
        locale: "en",
        userId: null,
        idempotencyKey: "key-case-6-aaaaaaaaaaaaa",
      });

    const first = await submit();
    const second = await submit();

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.order.id).toBe(first.order.id);
    expect(second.order.userId).toBeNull();
    expect(second.created).toBe(false);
  });

  it("Case 7: authenticated idempotency — a retry by the same user returns the same Order and preserves userId", async () => {
    const { repository } = makeFakeRepository();
    const submit = () =>
      createOrderFromCheckout(repository, {
        customer: validCustomer,
        items: [{ productId: "1", quantity: 1 }],
        deliveryAmountMinor: 800,
        locale: "en",
        userId: "user-a",
        idempotencyKey: "key-case-7-aaaaaaaaaaaaa",
      });

    const first = await submit();
    const second = await submit();

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.order.id).toBe(first.order.id);
    expect(second.order.userId).toBe("user-a");
  });

  it("Case 10 (backward compatibility): omitting the idempotency key entirely falls back to the plain, unconditional create path", async () => {
    const { repository, calls, createIdempotentCalls } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(createIdempotentCalls).toHaveLength(0);
  });

  it("existing validation (EMPTY_CART) still runs before any repository call, even with an idempotency key present", async () => {
    const { repository, createIdempotentCalls } = makeFakeRepository();
    const result = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [],
      deliveryAmountMinor: 800,
      locale: "en",
      idempotencyKey: "key-case-10-aaaaaaaaaaaa",
    });

    expect(result).toEqual({ ok: false, error: "EMPTY_CART" });
    expect(createIdempotentCalls).toHaveLength(0);
  });
});

/**
 * CR-031-01 / CR-031-02 regression coverage (Code Review of IMP-031).
 */
describe("createOrderFromCheckout — CR-031 fixes", () => {
  it("CR-031-01: same key, same cart/customer, but a different locale is rejected with IDEMPOTENCY_KEY_CONFLICT (not replayed as a duplicate)", async () => {
    const { repository } = makeFakeRepository();
    const key = "key-cr031-01-aaaaaaaaaaaaa";

    const first = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
      idempotencyKey: key,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.created).toBe(true);

    const second = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "fr", // only the locale differs
      idempotencyKey: key,
    });

    expect(second).toEqual({ ok: false, error: "IDEMPOTENCY_KEY_CONFLICT" });
  });

  it("CR-031-01: same key, same cart/customer, same locale replays normally (200-equivalent, created: false)", async () => {
    const { repository } = makeFakeRepository();
    const key = "key-cr031-01b-aaaaaaaaaaaa";
    const submit = () =>
      createOrderFromCheckout(repository, {
        customer: validCustomer,
        items: [{ productId: "1", quantity: 1 }],
        deliveryAmountMinor: 800,
        locale: "en",
        idempotencyKey: key,
      });

    const first = await submit();
    const second = await submit();

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.order.id).toBe(first.order.id);
    expect(second.created).toBe(false);
  });

  it("CR-031-02: replaying a key after the original product becomes unresolvable returns the original Order, not UNRESOLVED_PRODUCTS", async () => {
    const { repository } = makeFakeRepository();
    const key = "key-cr031-02-aaaaaaaaaaaaa";

    const first = await createOrderFromCheckout(repository, {
      customer: validCustomer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
      idempotencyKey: key,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    unavailableProductIds.add("1");
    try {
      // If Catalog were consulted at all here, this would fail with
      // UNRESOLVED_PRODUCTS — the fix must recognize the replay from the
      // idempotency key alone and never call Catalog for this request.
      const second = await createOrderFromCheckout(repository, {
        customer: validCustomer,
        items: [{ productId: "1", quantity: 1 }],
        deliveryAmountMinor: 800,
        locale: "en",
        idempotencyKey: key,
      });

      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.order.id).toBe(first.order.id);
      expect(second.created).toBe(false);
    } finally {
      unavailableProductIds.delete("1");
    }
  });

  it("CR-031-02: a genuinely new key still fails with UNRESOLVED_PRODUCTS when its product is unavailable — the fix only affects replays of an already-claimed key", async () => {
    const { repository } = makeFakeRepository();
    unavailableProductIds.add("1");
    try {
      const result = await createOrderFromCheckout(repository, {
        customer: validCustomer,
        items: [{ productId: "1", quantity: 1 }],
        deliveryAmountMinor: 800,
        locale: "en",
        idempotencyKey: "key-cr031-02b-aaaaaaaaaaaa",
      });
      expect(result).toEqual({ ok: false, error: "UNRESOLVED_PRODUCTS", productIds: ["1"] });
    } finally {
      unavailableProductIds.delete("1");
    }
  });
});

/**
 * IMP-031 idempotency, full pipeline: real Catalog resolution (as above)
 * AND the real `prismaOrderRepository` (unlike every other test in this
 * file, which injects a fake) against the real Neon database — the
 * strongest available proof that `createOrderFromCheckout` itself, not
 * just the repository in isolation, is safe under genuine concurrency.
 */
describe("createOrderFromCheckout — idempotency (IMP-031), real repository + real Catalog + real concurrency", () => {
  const createdOrderIds: string[] = [];

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    await prisma.$disconnect();
  });

  it("a full-pipeline retry (real Catalog + real repository) returns the same Order and creates nothing new", async () => {
    const key = `idem-full-pipeline-${Date.now()}`;
    const submit = () =>
      createOrderFromCheckout(prismaOrderRepository, {
        customer: validCustomer,
        items: [{ productId: "1", quantity: 1 }],
        deliveryAmountMinor: 800,
        locale: "en",
        idempotencyKey: key,
      });

    const first = await submit();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    createdOrderIds.push(first.order.id);
    expect(first.created).toBe(true);

    const second = await submit();
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.order.id).toBe(first.order.id);
    expect(second.created).toBe(false);

    const matching = await prisma.order.findMany({ where: { idempotencyKey: key } });
    expect(matching).toHaveLength(1);
  });

  it("IMP-031/Case 3, full pipeline: genuine concurrent duplicate checkout submissions (real Catalog + real repository) create exactly one Order", async () => {
    const key = `idem-full-pipeline-race-${Date.now()}`;
    const submit = () =>
      createOrderFromCheckout(prismaOrderRepository, {
        customer: validCustomer,
        items: [{ productId: "1", quantity: 1 }],
        deliveryAmountMinor: 800,
        locale: "en",
        idempotencyKey: key,
      });

    const [a, b] = await Promise.all([submit(), submit()]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.order.id).toBe(b.order.id);
    createdOrderIds.push(a.order.id);

    // Exactly one of the two calls reports having actually created it.
    const createdFlags = [a.created, b.created];
    expect(createdFlags.filter((flag) => flag === true)).toHaveLength(1);
    expect(createdFlags.filter((flag) => flag === false)).toHaveLength(1);

    const matching = await prisma.order.findMany({ where: { idempotencyKey: key } });
    expect(matching).toHaveLength(1);
  });
});

/**
 * IMP-048 Increment 3 — stock reservation integration. Real
 * `prismaOrderRepository` + real Catalog inventory, exactly like the
 * "real repository + real Catalog + real concurrency" block above: this
 * is a genuine cross-module integration (Order's own atomic
 * `changeOrderStatus` lifecycle primitive, Catalog's own reservation
 * rows), not something a fake on either side could prove.
 */
describe("createOrderFromCheckout — stock reservation integration (IMP-048 Increment 3)", () => {
  const createdOrderIds: string[] = [];
  const createdProductIds: string[] = [];

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdProductIds.length > 0) {
      await catalogPrisma.stockReservation.deleteMany({
        where: { productId: { in: createdProductIds } },
      });
      await catalogPrisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    }
    await catalogPrisma.$disconnect();
  });

  async function createTrackedTestProduct(stockQuantity: number) {
    const category = await catalogPrisma.category.findFirstOrThrow();
    const product = await catalogPrisma.product.create({
      data: {
        slug: `test-checkout-inventory-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        status: "ACTIVE",
        priceAmountMinor: 5000,
        currency: "USD",
        categoryId: category.id,
        trackInventory: true,
        stockQuantity,
        translations: {
          create: {
            locale: "en",
            name: "Checkout Inventory Test Product",
            meta: "test",
            description: "test",
            material: "test",
            dimensions: "test",
          },
        },
      },
    });
    createdProductIds.push(product.id);
    return product;
  }

  function testOrderPayload(items: CheckoutOrderItemRequest[], idempotencyKey?: string) {
    return {
      customer: validCustomer,
      items,
      deliveryAmountMinor: 800,
      locale: "en",
      idempotencyKey,
    };
  }

  it("reserves stock for a tracked product, keyed to the persisted order id", async () => {
    const product = await createTrackedTestProduct(5);
    const result = await createOrderFromCheckout(
      prismaOrderRepository,
      testOrderPayload([{ productId: product.id, quantity: 2 }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdOrderIds.push(result.order.id);

    const reservation = await catalogPrisma.stockReservation.findUniqueOrThrow({
      where: { orderId_productId: { orderId: result.order.id, productId: product.id } },
    });
    expect(reservation.status).toBe("ACTIVE");
    expect(reservation.quantity).toBe(2);
  });

  it("an untracked product's checkout is unaffected — no reservation row is created", async () => {
    const category = await catalogPrisma.category.findFirstOrThrow();
    const product = await catalogPrisma.product.create({
      data: {
        slug: `test-checkout-untracked-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        status: "ACTIVE",
        priceAmountMinor: 5000,
        currency: "USD",
        categoryId: category.id,
        trackInventory: false,
        translations: {
          create: {
            locale: "en",
            name: "Checkout Untracked Test Product",
            meta: "test",
            description: "test",
            material: "test",
            dimensions: "test",
          },
        },
      },
    });
    createdProductIds.push(product.id);

    const result = await createOrderFromCheckout(
      prismaOrderRepository,
      testOrderPayload([{ productId: product.id, quantity: 1 }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdOrderIds.push(result.order.id);

    const count = await catalogPrisma.stockReservation.count({
      where: { orderId: result.order.id, productId: product.id },
    });
    expect(count).toBe(0);
  });

  it("insufficient stock on one item cancels the order and releases the reservation already created for a sibling item", async () => {
    const sufficientProduct = await createTrackedTestProduct(5);
    const insufficientProduct = await createTrackedTestProduct(0);

    const result = await createOrderFromCheckout(
      prismaOrderRepository,
      testOrderPayload([
        { productId: sufficientProduct.id, quantity: 2 },
        { productId: insufficientProduct.id, quantity: 1 },
      ]),
    );
    expect(result).toEqual({
      ok: false,
      error: "INSUFFICIENT_STOCK",
      productIds: [insufficientProduct.id],
    });

    // The order was persisted (so it has an id to clean up) but must now
    // be CANCELLED, never left PENDING.
    const orders = await prisma.order.findMany({
      where: { items: { some: { productId: sufficientProduct.id } } },
    });
    expect(orders).toHaveLength(1);
    createdOrderIds.push(orders[0]!.id);
    expect(orders[0]!.status).toBe("CANCELLED");

    const sufficientReservation = await catalogPrisma.stockReservation.findUniqueOrThrow({
      where: {
        orderId_productId: { orderId: orders[0]!.id, productId: sufficientProduct.id },
      },
    });
    expect(sufficientReservation.status).toBe("RELEASED");

    const insufficientReservationCount = await catalogPrisma.stockReservation.count({
      where: { orderId: orders[0]!.id, productId: insufficientProduct.id },
    });
    expect(insufficientReservationCount).toBe(0);
  });

  it("an idempotent replay after an insufficient-stock cancellation consistently reports INSUFFICIENT_STOCK without reviving the released reservation", async () => {
    const sufficientProduct = await createTrackedTestProduct(5);
    const insufficientProduct = await createTrackedTestProduct(0);
    const key = `idem-insufficient-stock-${Date.now()}`;
    const payload = testOrderPayload(
      [
        { productId: sufficientProduct.id, quantity: 1 },
        { productId: insufficientProduct.id, quantity: 1 },
      ],
      key,
    );

    const first = await createOrderFromCheckout(prismaOrderRepository, payload);
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.error).toBe("INSUFFICIENT_STOCK");

    const order = await prisma.order.findFirstOrThrow({ where: { idempotencyKey: key } });
    createdOrderIds.push(order.id);
    expect(order.status).toBe("CANCELLED");

    const second = await createOrderFromCheckout(prismaOrderRepository, payload);
    // Consistently re-reports the same original failure — never a
    // fabricated success, and never a second attempt to reserve/release
    // the already-terminal sibling reservation.
    expect(second).toEqual({ ok: false, error: "INSUFFICIENT_STOCK", productIds: [] });

    const sufficientReservation = await catalogPrisma.stockReservation.findUniqueOrThrow({
      where: {
        orderId_productId: { orderId: order.id, productId: sufficientProduct.id },
      },
    });
    expect(sufficientReservation.status).toBe("RELEASED");
  });

  it("resumes an interrupted reservation process: a replay completes a reservation an earlier attempt never got to create", async () => {
    const product = await createTrackedTestProduct(5);
    const key = `idem-resume-${Date.now()}`;
    const items: CheckoutOrderItemRequest[] = [{ productId: product.id, quantity: 2 }];

    // Simulates a crash between order persistence and stock reservation:
    // the order (and its idempotency claim) is created directly through
    // the repository, exactly as `createOrderFromCheckout` itself would,
    // but deliberately skipping the reservation step entirely.
    const idempotencyRequestHash = computeCheckoutSubmissionFingerprint({
      customer: validCustomer,
      items,
      deliveryAmountMinor: 800,
      locale: "en",
      userId: null,
    });
    const createResult = await prismaOrderRepository.createIdempotent({
      status: "PENDING",
      firstName: validCustomer.firstName,
      lastName: validCustomer.lastName,
      email: validCustomer.email,
      phone: validCustomer.phone,
      userId: null,
      subtotalAmountMinor: 10000,
      deliveryAmountMinor: 800,
      totalAmountMinor: 10800,
      currency: "USD",
      items: [
        {
          productId: product.id,
          productName: product.slug,
          regularUnitPriceAmountMinor: 5000,
          unitPriceAmountMinor: 5000,
          quantity: 2,
          lineTotalAmountMinor: 10000,
          currency: "USD",
        },
      ],
      idempotencyKey: key,
      idempotencyRequestHash,
    });
    expect(createResult.outcome).toBe("created");
    if (createResult.outcome !== "created") return;
    createdOrderIds.push(createResult.order.id);

    const beforeResume = await catalogPrisma.stockReservation.count({
      where: { orderId: createResult.order.id, productId: product.id },
    });
    expect(beforeResume).toBe(0);

    const resumed = await createOrderFromCheckout(
      prismaOrderRepository,
      testOrderPayload(items, key),
    );
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.order.id).toBe(createResult.order.id);
    expect(resumed.created).toBe(false);

    const reservation = await catalogPrisma.stockReservation.findUniqueOrThrow({
      where: { orderId_productId: { orderId: createResult.order.id, productId: product.id } },
    });
    expect(reservation.status).toBe("ACTIVE");
    expect(reservation.quantity).toBe(2);
  });

  it("CR-1: aggregates duplicate product IDs into one reservation and refuses checkout when the combined quantity exceeds available stock", async () => {
    const product = await createTrackedTestProduct(3);
    const result = await createOrderFromCheckout(
      prismaOrderRepository,
      testOrderPayload([
        { productId: product.id, quantity: 2 },
        { productId: product.id, quantity: 2 },
      ]),
    );
    // Combined requested quantity is 4; stock is only 3 — must not
    // succeed with an under-reserved order.
    expect(result).toEqual({
      ok: false,
      error: "INSUFFICIENT_STOCK",
      productIds: [product.id],
    });

    const reservationCount = await catalogPrisma.stockReservation.count({
      where: { productId: product.id },
    });
    expect(reservationCount).toBe(0);
  });

  it("CR-1: aggregates duplicate product IDs into a single OrderItem whose quantity is charged, ordered, and reserved identically", async () => {
    const product = await createTrackedTestProduct(10);
    const result = await createOrderFromCheckout(
      prismaOrderRepository,
      testOrderPayload([
        { productId: product.id, quantity: 2 },
        { productId: product.id, quantity: 3 },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdOrderIds.push(result.order.id);

    const itemsForProduct = result.order.items.filter((item) => item.productId === product.id);
    expect(itemsForProduct).toHaveLength(1);
    expect(itemsForProduct[0]?.quantity).toBe(5);
    expect(itemsForProduct[0]?.lineTotalAmountMinor).toBe(5 * product.priceAmountMinor);

    const reservation = await catalogPrisma.stockReservation.findUniqueOrThrow({
      where: { orderId_productId: { orderId: result.order.id, productId: product.id } },
    });
    expect(reservation.quantity).toBe(5);
  });

  it("CR-2: a reservation operation that throws after an earlier item was already reserved is compensated, and the original error is preserved", async () => {
    const succeedsProduct = await createTrackedTestProduct(5);
    const throwsProduct = await createTrackedTestProduct(5);
    reserveStockThrowForProductIds.add(throwsProduct.id);
    try {
      await expect(
        createOrderFromCheckout(
          prismaOrderRepository,
          testOrderPayload([
            { productId: succeedsProduct.id, quantity: 1 },
            { productId: throwsProduct.id, quantity: 1 },
          ]),
        ),
      ).rejects.toThrow(/QA-injected reserveStock failure/);
    } finally {
      reserveStockThrowForProductIds.delete(throwsProduct.id);
    }

    const order = await prisma.order.findFirstOrThrow({
      where: { items: { some: { productId: succeedsProduct.id } } },
      orderBy: { createdAt: "desc" },
    });
    createdOrderIds.push(order.id);
    // Compensation still ran despite the throw: the order was cancelled
    // and the earlier successful reservation was released.
    expect(order.status).toBe("CANCELLED");

    const reservation = await catalogPrisma.stockReservation.findUniqueOrThrow({
      where: { orderId_productId: { orderId: order.id, productId: succeedsProduct.id } },
    });
    expect(reservation.status).toBe("RELEASED");
  });

  it("CR-2: a release operation that throws during compensation does not crash checkout — it still reports INSUFFICIENT_STOCK and still attempts to cancel the order", async () => {
    const succeedsProduct = await createTrackedTestProduct(5);
    const insufficientProduct = await createTrackedTestProduct(0);
    releaseReservationThrowForProductIds.add(succeedsProduct.id);
    try {
      const result = await createOrderFromCheckout(
        prismaOrderRepository,
        testOrderPayload([
          { productId: succeedsProduct.id, quantity: 1 },
          { productId: insufficientProduct.id, quantity: 1 },
        ]),
      );
      expect(result).toEqual({
        ok: false,
        error: "INSUFFICIENT_STOCK",
        productIds: [insufficientProduct.id],
      });
    } finally {
      releaseReservationThrowForProductIds.delete(succeedsProduct.id);
    }

    const order = await prisma.order.findFirstOrThrow({
      where: { items: { some: { productId: succeedsProduct.id } } },
      orderBy: { createdAt: "desc" },
    });
    createdOrderIds.push(order.id);
    // Best-effort cancellation still happens even though releasing the
    // sibling reservation threw.
    expect(order.status).toBe("CANCELLED");

    // The reservation itself is left ACTIVE (release failed) — this is
    // the "observable, not silently lost" unresolved state CR-2 calls
    // for; it is surfaced via the logged error, never hidden behind a
    // fabricated success.
    const reservation = await catalogPrisma.stockReservation.findUniqueOrThrow({
      where: { orderId_productId: { orderId: order.id, productId: succeedsProduct.id } },
    });
    expect(reservation.status).toBe("ACTIVE");
  });

  it("CR-3: a concurrent transition to PAID while checkout is handling a reservation failure is reported as success, never a fabricated INSUFFICIENT_STOCK, and its reservation is not released", async () => {
    const paidRaceProduct = await createTrackedTestProduct(5);
    const insufficientProduct = await createTrackedTestProduct(0);

    let flipped = false;
    const racingRepository: OrderRepository = {
      ...prismaOrderRepository,
      findById: async (orderId: string) => {
        if (!flipped) {
          flipped = true;
          // Simulate a concurrent process (e.g. a future payment flow)
          // completing this Order's payment exactly as cleanup's own
          // re-read runs.
          await prisma.order.update({ where: { id: orderId }, data: { status: "PAID" } });
        }
        return prismaOrderRepository.findById(orderId);
      },
    };

    const result = await createOrderFromCheckout(
      racingRepository,
      testOrderPayload([
        { productId: paidRaceProduct.id, quantity: 1 },
        { productId: insufficientProduct.id, quantity: 1 },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdOrderIds.push(result.order.id);
    expect(result.order.status).toBe("PAID");

    // The already-successful reservation must NOT have been released —
    // it belongs to whatever process moved the Order to PAID, not to
    // this cleanup.
    const reservation = await catalogPrisma.stockReservation.findUniqueOrThrow({
      where: { orderId_productId: { orderId: result.order.id, productId: paidRaceProduct.id } },
    });
    expect(reservation.status).toBe("ACTIVE");
  });
});

/**
 * Real seeded Catalog prices ($86-$310) can never actually drive
 * `createOrderFromCheckout` to the point of overflowing PostgreSQL's
 * INTEGER range through the full pipeline, so this boundary is verified
 * directly instead — see the doc comment on `isWithinSafeAmountRange`.
 */
describe("isWithinSafeAmountRange", () => {
  it("accepts zero", () => {
    expect(isWithinSafeAmountRange(0)).toBe(true);
  });

  it("accepts an ordinary amount", () => {
    expect(isWithinSafeAmountRange(48_800)).toBe(true);
  });

  it("accepts exactly MAX_AMOUNT_MINOR", () => {
    expect(isWithinSafeAmountRange(MAX_AMOUNT_MINOR)).toBe(true);
  });

  it("rejects MAX_AMOUNT_MINOR + 1", () => {
    expect(isWithinSafeAmountRange(MAX_AMOUNT_MINOR + 1)).toBe(false);
  });

  it("rejects a value well beyond MAX_AMOUNT_MINOR", () => {
    expect(isWithinSafeAmountRange(2_200_000_000)).toBe(false);
  });

  it("rejects a negative amount", () => {
    expect(isWithinSafeAmountRange(-1)).toBe(false);
  });

  it("rejects a non-integer amount", () => {
    expect(isWithinSafeAmountRange(100.5)).toBe(false);
  });
});
