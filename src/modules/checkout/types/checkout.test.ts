import { describe, expect, it } from "vitest";
import {
  resolveCheckoutSummary,
  validateCustomerInformation,
} from "@/modules/checkout/types/checkout";
import type {
  CheckoutCartItem,
  CheckoutCatalogProduct,
  CustomerInformation,
} from "@/modules/checkout/types/checkout";

function makeCustomerInformation(
  overrides: Partial<CustomerInformation> = {},
): CustomerInformation {
  return {
    firstName: "John",
    lastName: "Smith",
    email: "john.smith@example.com",
    phone: "+421 900 123 456",
    ...overrides,
  };
}

function makeItem(productId: string, quantity: number): CheckoutCartItem {
  return { productId, quantity };
}

function makeProduct(overrides: Partial<CheckoutCatalogProduct> = {}): CheckoutCatalogProduct {
  return {
    id: "1",
    name: "Studio Chair",
    meta: "Oak & linen",
    priceAmountMinor: 24000,
    currency: "USD",
    badge: null,
    ...overrides,
  };
}

describe("resolveCheckoutSummary", () => {
  it("returns a loading state without computing anything when Catalog is still loading", () => {
    const result = resolveCheckoutSummary(
      [makeItem("1", 1)],
      new Map([["1", makeProduct()]]),
      true,
    );
    expect(result).toEqual({ status: "loading" });
  });

  it("returns an empty, ready summary for an empty cart", () => {
    const result = resolveCheckoutSummary([], new Map(), false);
    expect(result).toEqual({
      status: "ready",
      lines: [],
      unresolvedCount: 0,
      subtotalAmountMinor: 0,
      currency: "USD",
    });
  });

  it("resolves a single product with the correct line total", () => {
    const productsById = new Map([["1", makeProduct({ id: "1", priceAmountMinor: 24000 })]]);
    const result = resolveCheckoutSummary([makeItem("1", 1)], productsById, false);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.lineTotalAmountMinor).toBe(24000);
    expect(result.subtotalAmountMinor).toBe(24000);
    expect(result.unresolvedCount).toBe(0);
  });

  it("multiplies unit price by quantity for quantity greater than 1 using integer minor units", () => {
    const productsById = new Map([["1", makeProduct({ id: "1", priceAmountMinor: 24000 })]]);
    const result = resolveCheckoutSummary([makeItem("1", 3)], productsById, false);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.lines[0]?.lineTotalAmountMinor).toBe(72000);
    expect(Number.isInteger(result.lines[0]?.lineTotalAmountMinor)).toBe(true);
    expect(result.subtotalAmountMinor).toBe(72000);
  });

  it("supports multiple products and sums their line totals into the subtotal", () => {
    const productsById = new Map([
      ["1", makeProduct({ id: "1", priceAmountMinor: 24000 })],
      ["2", makeProduct({ id: "2", priceAmountMinor: 31000 })],
      ["3", makeProduct({ id: "3", priceAmountMinor: 9600 })],
    ]);
    const items = [makeItem("1", 1), makeItem("2", 2), makeItem("3", 1)];
    const result = resolveCheckoutSummary(items, productsById, false);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.lines).toHaveLength(3);
    // 24000 + (31000 * 2) + 9600 = 95600
    expect(result.subtotalAmountMinor).toBe(95600);
    expect(result.unresolvedCount).toBe(0);
  });

  it("excludes an unresolved product from lines and subtotal, but counts it", () => {
    const result = resolveCheckoutSummary([makeItem("999", 1)], new Map(), false);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.lines).toHaveLength(0);
    expect(result.subtotalAmountMinor).toBe(0);
    expect(result.unresolvedCount).toBe(1);
  });

  it("handles a mix of resolved and unresolved products correctly", () => {
    const productsById = new Map([["1", makeProduct({ id: "1", priceAmountMinor: 24000 })]]);
    const items = [makeItem("1", 2), makeItem("999", 1)];
    const result = resolveCheckoutSummary(items, productsById, false);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.item.productId).toBe("1");
    expect(result.subtotalAmountMinor).toBe(48000);
    expect(result.unresolvedCount).toBe(1);
  });

  it("takes currency from the resolved products, not a hardcoded default", () => {
    const productsById = new Map([["1", makeProduct({ id: "1", currency: "EUR" })]]);
    const result = resolveCheckoutSummary([makeItem("1", 1)], productsById, false);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.currency).toBe("EUR");
  });
});

describe("validateCustomerInformation", () => {
  it("rejects a completely empty form with a required error on every field", () => {
    const errors = validateCustomerInformation(
      makeCustomerInformation({ firstName: "", lastName: "", email: "", phone: "" }),
    );
    expect(errors).toEqual({
      firstName: "required",
      lastName: "required",
      email: "required",
      phone: "required",
    });
  });

  it("accepts fully valid customer information", () => {
    const errors = validateCustomerInformation(makeCustomerInformation());
    expect(errors).toEqual({});
  });

  it("flags a missing first name only", () => {
    const errors = validateCustomerInformation(makeCustomerInformation({ firstName: "" }));
    expect(errors.firstName).toBe("required");
    expect(errors.lastName).toBeUndefined();
    expect(errors.email).toBeUndefined();
    expect(errors.phone).toBeUndefined();
  });

  it("flags a missing last name only", () => {
    const errors = validateCustomerInformation(makeCustomerInformation({ lastName: "" }));
    expect(errors.lastName).toBe("required");
    expect(errors.firstName).toBeUndefined();
  });

  it("flags a missing email as required", () => {
    const errors = validateCustomerInformation(makeCustomerInformation({ email: "" }));
    expect(errors.email).toBe("required");
  });

  it("flags a malformed email as invalid, not merely missing", () => {
    for (const email of ["john", "john@", "@example.com"]) {
      const errors = validateCustomerInformation(makeCustomerInformation({ email }));
      expect(errors.email).toBe("invalidEmail");
    }
  });

  it("accepts realistic email formats", () => {
    for (const email of ["john@example.com", "john.smith@example.com"]) {
      const errors = validateCustomerInformation(makeCustomerInformation({ email }));
      expect(errors.email).toBeUndefined();
    }
  });

  it("flags a missing phone as required", () => {
    const errors = validateCustomerInformation(makeCustomerInformation({ phone: "" }));
    expect(errors.phone).toBe("required");
  });

  it("accepts valid international phone numbers", () => {
    for (const phone of ["+421 900 123 456", "+33 6 12 34 56 78", "+380 67 123 4567"]) {
      const errors = validateCustomerInformation(makeCustomerInformation({ phone }));
      expect(errors.phone).toBeUndefined();
    }
  });

  it("treats whitespace-only fields as empty, not valid", () => {
    const errors = validateCustomerInformation(
      makeCustomerInformation({ firstName: "   ", lastName: "\t", email: "   ", phone: "  " }),
    );
    expect(errors).toEqual({
      firstName: "required",
      lastName: "required",
      email: "required",
      phone: "required",
    });
  });

  it("trims values before validating — leading/trailing whitespace around an otherwise valid value is not an error", () => {
    const errors = validateCustomerInformation(
      makeCustomerInformation({ firstName: "  John  ", lastName: "  Smith  " }),
    );
    expect(errors.firstName).toBeUndefined();
    expect(errors.lastName).toBeUndefined();
  });

  it("reports field-specific errors when multiple fields are invalid at once", () => {
    const errors = validateCustomerInformation(
      makeCustomerInformation({ firstName: "", email: "not-an-email" }),
    );
    expect(errors).toEqual({ firstName: "required", email: "invalidEmail" });
  });

  it("does not reject names with apostrophes or non-Latin characters", () => {
    for (const name of ["O'Connor", "Марія", "Іван", "Jean"]) {
      const errors = validateCustomerInformation(
        makeCustomerInformation({ firstName: name, lastName: name }),
      );
      expect(errors.firstName).toBeUndefined();
      expect(errors.lastName).toBeUndefined();
    }
  });
});
