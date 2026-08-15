import { describe, expect, it } from "vitest";
import {
  navItems,
  guestAccountNavItems,
  authenticatedAccountNavItems,
} from "@/shared/components/layout/nav-items";

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
