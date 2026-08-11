/**
 * Public entry point for the checkout module. The app router (and any
 * future module, such as Order) must import checkout functionality through
 * here rather than reaching into checkout-internal files.
 */
export { CheckoutView } from "@/modules/checkout/presentation/checkout-view";

export {
  validateCustomerInformation,
  getDeliveryAmountMinor,
} from "@/modules/checkout/types/checkout";
export type { CustomerInformation, DeliveryMethodKey } from "@/modules/checkout/types/checkout";
