import type { useCart } from "@/modules/cart";
import type { StorefrontProductSummary } from "@/modules/catalog/client";

/**
 * Derived from Cart's own public shape rather than duplicated here —
 * Checkout never redefines what a cart line item is, it only reads through
 * Cart's public API (`@/modules/cart`).
 */
export type CheckoutCartItem = ReturnType<typeof useCart>["items"][number];

/**
 * Checkout only reads product data through Catalog's client-safe transport
 * (`@/modules/catalog/client`), the same read-only DTO Cart uses — Checkout
 * runs entirely client-side and can never import the Prisma-backed
 * `@/modules/catalog` entry point.
 */
export type CheckoutCatalogProduct = StorefrontProductSummary;

export interface CheckoutContactValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

/**
 * The customer-information Checkout will eventually hand to Order creation.
 * Same shape as `CheckoutContactValues` — this alias just names it the way
 * the rest of the domain will refer to it once an Order step exists.
 */
export type CustomerInformation = CheckoutContactValues;

export interface CheckoutDeliveryAddressValues {
  address: string;
  city: string;
  postalCode: string;
}

export type DeliveryMethodKey = "standard" | "express";

export interface CheckoutFormValues {
  contact: CheckoutContactValues;
  deliveryAddress: CheckoutDeliveryAddressValues;
  deliveryMethod: DeliveryMethodKey | null;
}

export type CheckoutFormErrors = Partial<
  Record<
    keyof CheckoutContactValues | keyof CheckoutDeliveryAddressValues | "deliveryMethod",
    string
  >
>;

/**
 * Presentation-level delivery options only — no real shipping provider
 * integration. `priceAmountMinor` uses the same integer minor-unit
 * convention as Catalog pricing so it can be combined with the product
 * subtotal and formatted through a single `formatProductPrice` call.
 */
export interface DeliveryOption {
  key: DeliveryMethodKey;
  priceAmountMinor: number;
}

export const DELIVERY_OPTIONS: DeliveryOption[] = [
  { key: "standard", priceAmountMinor: 800 },
  { key: "express", priceAmountMinor: 1800 },
];

/**
 * Resolves a submitted delivery method to its authoritative price. Returns
 * `null` for anything that isn't one of `DELIVERY_OPTIONS`'s keys — callers
 * must treat that as a validation failure, never default it to 0 or guess.
 */
export function getDeliveryAmountMinor(method: string): number | null {
  const option = DELIVERY_OPTIONS.find((candidate) => candidate.key === method);
  return option ? option.priceAmountMinor : null;
}

export interface CheckoutLine {
  item: CheckoutCartItem;
  product: CheckoutCatalogProduct;
  /** Integer minor units: `product.priceAmountMinor * item.quantity`. Never a float. */
  lineTotalAmountMinor: number;
}

/**
 * Result of resolving a Cart against currently-known Catalog data. `loading`
 * is its own explicit state (not just an empty `ready` result) so a cart
 * whose Catalog resolution hasn't finished yet can never be mistaken for a
 * cart with a genuinely zero/partial subtotal.
 */
export type CheckoutSummaryState =
  | { status: "loading" }
  | {
      status: "ready";
      lines: CheckoutLine[];
      /** Cart items whose productId Catalog did not return — unresolved, unavailable, or non-ACTIVE. */
      unresolvedCount: number;
      subtotalAmountMinor: number;
      currency: string;
    };

/**
 * Pure Checkout summary logic — no Prisma, no React, no fetch. Given a Cart
 * and whatever the Catalog transport has resolved so far, produces exactly
 * what the Checkout summary needs to render: per-line totals, a subtotal,
 * and how many cart items (if any) Catalog couldn't confirm. A cart item
 * with no matching resolved product is excluded from the total rather than
 * priced at zero or guessed at — it is only counted.
 */
export function resolveCheckoutSummary(
  items: CheckoutCartItem[],
  productsById: ReadonlyMap<string, CheckoutCatalogProduct>,
  isCatalogLoading: boolean,
): CheckoutSummaryState {
  if (isCatalogLoading) {
    return { status: "loading" };
  }

  const lines: CheckoutLine[] = [];
  let unresolvedCount = 0;

  for (const item of items) {
    const product = productsById.get(item.productId);
    if (!product) {
      unresolvedCount += 1;
      continue;
    }
    lines.push({ item, product, lineTotalAmountMinor: product.priceAmountMinor * item.quantity });
  }

  const subtotalAmountMinor = lines.reduce((sum, line) => sum + line.lineTotalAmountMinor, 0);
  const currency = lines[0]?.product.currency ?? "USD";

  return { status: "ready", lines, unresolvedCount, subtotalAmountMinor, currency };
}

/**
 * Error *codes*, not localized strings — the presentation layer maps these
 * to `Checkout.errors.*` translations. Keeping the code here instead of a
 * ready-made message is what lets this function stay free of next-intl/React
 * and be tested directly.
 */
export type CustomerInformationErrorCode = "required" | "invalidEmail" | "invalidPhone";

export type CustomerInformationErrors = Partial<
  Record<keyof CustomerInformation, CustomerInformationErrorCode>
>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Deliberately lenient: accepts an optional leading `+` and any mix of
 * digits/spaces/hyphens/parentheses, as long as there are enough digits to
 * plausibly be a phone number. Not a telecom-grade parser — this project
 * has no such requirement, and international formats vary too much for a
 * single strict pattern to be correct.
 */
function isPlausiblePhone(value: string): boolean {
  const digitCount = (value.match(/\d/g) ?? []).length;
  return digitCount >= 7 && /^\+?[\d\s()-]+$/.test(value);
}

/**
 * Pure validation for Checkout's customer-information fields — no Prisma,
 * no fetch, no React hooks, no browser APIs. Operates on trimmed copies of
 * the input without mutating it; the caller decides whether/when to store a
 * trimmed value. Returns one error code per invalid field, or an empty
 * object when everything is valid.
 */
export function validateCustomerInformation(value: CustomerInformation): CustomerInformationErrors {
  const errors: CustomerInformationErrors = {};

  if (!value.firstName.trim()) {
    errors.firstName = "required";
  }

  if (!value.lastName.trim()) {
    errors.lastName = "required";
  }

  const email = value.email.trim();
  if (!email) {
    errors.email = "required";
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = "invalidEmail";
  }

  const phone = value.phone.trim();
  if (!phone) {
    errors.phone = "required";
  } else if (!isPlausiblePhone(phone)) {
    errors.phone = "invalidPhone";
  }

  return errors;
}
