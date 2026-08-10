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
  fullName: string;
  email: string;
  phone: string;
}

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
