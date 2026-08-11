import "dotenv/config";
import { describe, expect, it } from "vitest";
import { createOrderFromCheckout } from "@/modules/order/application/checkout-order";
import type { CheckoutOrderCustomer } from "@/modules/order/application/checkout-order";
import type { OrderRepository, NewOrderInput } from "@/modules/order/repositories/order-repository";
import type { Order } from "@/modules/order/domain/order";

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
