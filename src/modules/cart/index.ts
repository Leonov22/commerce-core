/**
 * Public entry point for the cart module. Other modules and the app shell
 * must import cart functionality through here rather than reaching into
 * cart-internal files, per the project's module boundary rules.
 */
export { CartProvider, useCart } from "@/modules/cart/state/cart-context";
export { CartNavLink } from "@/modules/cart/components/cart-nav-link";
export { AddToCartButton } from "@/modules/cart/components/add-to-cart-button";
