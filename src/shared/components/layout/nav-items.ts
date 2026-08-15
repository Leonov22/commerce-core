export const navItems = [
  { href: "/shop", labelKey: "shop" },
  { href: "/about", labelKey: "about" },
  { href: "/contact", labelKey: "contact" },
] as const;

/**
 * IMP-036: account-area links shown when no session exists. Plain
 * `{href, labelKey}` data, exactly like `navItems` above — these are
 * ordinary links, not a feature-owned widget, so (unlike the Cart entry
 * point or the logout action) they need no slot injection from a layout
 * that imports `@/modules/identity`; `shared/` stays free of any
 * dependency on that module.
 */
export const guestAccountNavItems = [
  { href: "/account/login", labelKey: "login" },
  { href: "/account/register", labelKey: "register" },
] as const;

/** IMP-036: account-area links shown once a session exists. Logout is deliberately not here — it is an action (`signOut()`), not a navigable link, and is composed in separately as `accountSlot`. */
export const authenticatedAccountNavItems = [
  { href: "/account", labelKey: "account" },
  { href: "/account/orders", labelKey: "orders" },
] as const;
