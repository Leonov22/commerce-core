import type { useCart } from "@/modules/cart";
import type { getCatalogProductById } from "@/modules/catalog";

/**
 * Derived from Cart's own public shape rather than duplicated here —
 * Checkout never redefines what a cart line item is, it only reads through
 * Cart's public API (`@/modules/cart`).
 */
export type CheckoutCartItem = ReturnType<typeof useCart>["items"][number];

/**
 * Derived from Catalog's own public shape rather than duplicated here —
 * Checkout only reads product data through Catalog's public API
 * (`@/modules/catalog`).
 */
export type CheckoutCatalogProduct = NonNullable<ReturnType<typeof getCatalogProductById>>;

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
 * integration. `priceAmount` backs the same kind of display-only
 * calculation already used by Cart's subtotal.
 */
export interface DeliveryOption {
  key: DeliveryMethodKey;
  priceAmount: number;
}

export const DELIVERY_OPTIONS: DeliveryOption[] = [
  { key: "standard", priceAmount: 8 },
  { key: "express", priceAmount: 18 },
];
