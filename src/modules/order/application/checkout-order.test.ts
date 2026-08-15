import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import {
  createOrderFromCheckout,
  MAX_QUANTITY_PER_ITEM,
  MAX_AMOUNT_MINOR,
  isWithinSafeAmountRange,
} from "@/modules/order/application/checkout-order";
import type { CheckoutOrderCustomer } from "@/modules/order/application/checkout-order";
import type { OrderRepository, NewOrderInput } from "@/modules/order/repositories/order-repository";
import type { Order } from "@/modules/order/domain/order";
import type { Product } from "@/modules/catalog/domain/product";

/**
 * `qa-overflow-fixture` is a reserved id intercepted by the `@/modules/catalog`
 * partial mock below — every other id is passed through to the real Catalog
 * boundary unchanged. `vi.hoisted` is required (rather than a plain `const`)
 * because Vitest hoists `vi.mock` factories above all other module code; a
 * factory that closed over an un-hoisted `const` would hit it before
 * initialization.
 */
const { OVERFLOW_PRODUCT_ID } = vi.hoisted(() => ({
  OVERFLOW_PRODUCT_ID: "qa-overflow-fixture",
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
    translation: {
      locale: "en",
      name: "QA Overflow Fixture",
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
      return actual.getProductsByIds(ids, locale);
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

function makeFakeRepository(): { repository: OrderRepository; calls: NewOrderInput[] } {
  const calls: NewOrderInput[] = [];
  const repository: OrderRepository = {
    async create(input) {
      calls.push(input);
      const now = new Date();
      const order: Order = {
        id: "fake-order-id",
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
          id: `fake-item-${index}`,
          orderId: "fake-order-id",
          ...item,
        })),
      };
      return order;
    },
    // Not exercised by this file's tests (IMP-026/026-FIX/026-FIX-TESTS
    // predate customer order history and order lifecycle) — present only
    // to satisfy `OrderRepository`'s shape.
    async findManyByUserId() {
      throw new Error("not used by these tests");
    },
    async findByIdForUser() {
      throw new Error("not used by these tests");
    },
    async findById() {
      throw new Error("not used by these tests");
    },
    async updateStatusIfCurrent() {
      throw new Error("not used by these tests");
    },
  };
  return { repository, calls };
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
