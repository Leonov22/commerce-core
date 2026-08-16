import { describe, expect, it } from "vitest";
import {
  navItems,
  guestAccountNavItems,
  authenticatedAccountNavItems,
} from "@/shared/components/layout/nav-items";
import messages from "@/core/i18n/messages/en.json";

/**
 * Pure data, no rendering — this project's Vitest config has no JSX
 * transform (`include: ["src/**\/*.test.ts"]` only), so component-level
 * rendering of `SiteHeader`/`MobileNav` isn't testable here; these tests
 * lock in the one thing that IS testable without rendering: which links
 * `SiteHeader`/`MobileNav` are given to render for each session state
 * (IMP-036). Manual browser verification covers the rest — see the
 * milestone's own final report.
 */
describe("guestAccountNavItems / authenticatedAccountNavItems (IMP-036)", () => {
  it("primary navItems (Shop/About/Contact) are unaffected by this milestone", () => {
    expect(navItems.map((item) => item.href)).toEqual(["/shop", "/about", "/contact"]);
  });

  it("a guest is offered Login and Register, and nothing account-only", () => {
    const hrefs = guestAccountNavItems.map((item) => item.href);
    expect(hrefs).toEqual(["/account/login", "/account/register"]);
  });

  it("an authenticated customer is offered Account and Orders, never Login/Register", () => {
    const hrefs = authenticatedAccountNavItems.map((item) => item.href);
    expect(hrefs).toEqual(["/account", "/account/orders"]);
  });

  it("guest and authenticated link sets never overlap — no state can show a mismatched action", () => {
    const guestHrefs: string[] = guestAccountNavItems.map((item) => item.href);
    const authenticatedHrefs: string[] = authenticatedAccountNavItems.map((item) => item.href);
    const overlap = guestHrefs.filter((href) => authenticatedHrefs.includes(href));
    expect(overlap).toEqual([]);
  });

  it("every account nav item points to an existing app route path (account/login, account/register, account, account/orders)", () => {
    const allHrefs = [...guestAccountNavItems, ...authenticatedAccountNavItems].map(
      (item) => item.href,
    );
    for (const href of allHrefs) {
      expect(href.startsWith("/account")).toBe(true);
    }
  });
});

/**
 * IMP-036-FIX-01: resolves each item's `labelKey` against the actual `en.json`
 * message catalog `SiteHeader`/`MobileNav` render through (`tNav(item.labelKey)`),
 * the closest this project's JSX-transform-free Vitest config can get to
 * asserting on-screen text without rendering anything. Locks in the exact
 * guest/authenticated label sets the ticket's acceptance criteria specify.
 */
describe("resolved navigation labels (IMP-036-FIX-01)", () => {
  const nav: Record<string, string> = messages.Nav;

  it("guest labels resolve to exactly Log in, Register — never My Account/My Orders", () => {
    const labels = guestAccountNavItems.map((item) => nav[item.labelKey]);
    expect(labels).toEqual(["Log in", "Register"]);
  });

  it("authenticated labels resolve to exactly My Account, My Orders — never Log in/Register", () => {
    const labels = authenticatedAccountNavItems.map((item) => nav[item.labelKey]);
    expect(labels).toEqual(["My Account", "My Orders"]);
  });

  it("My Account links to /account, and My Orders links to /account/orders", () => {
    const myAccount = authenticatedAccountNavItems.find(
      (item) => nav[item.labelKey] === "My Account",
    );
    const myOrders = authenticatedAccountNavItems.find(
      (item) => nav[item.labelKey] === "My Orders",
    );
    expect(myAccount?.href).toBe("/account");
    expect(myOrders?.href).toBe("/account/orders");
  });

  it("no guest label text appears among authenticated labels, and vice versa", () => {
    const guestLabels = guestAccountNavItems.map((item) => nav[item.labelKey]);
    const authenticatedLabels = authenticatedAccountNavItems.map((item) => nav[item.labelKey]);
    for (const label of guestLabels) {
      expect(authenticatedLabels).not.toContain(label);
    }
    for (const label of authenticatedLabels) {
      expect(guestLabels).not.toContain(label);
    }
  });
});
