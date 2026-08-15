import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/core/i18n/navigation";
import { Container } from "@/shared/components/layout/container";
import { LanguageSwitcher } from "@/shared/components/layout/language-switcher";
import { MobileNav } from "@/shared/components/layout/mobile-nav";
import {
  navItems,
  guestAccountNavItems,
  authenticatedAccountNavItems,
} from "@/shared/components/layout/nav-items";

interface SiteHeaderProps {
  /**
   * The cart entry point is a feature-owned widget (it reads Cart Context),
   * so the layout composes it and passes it in here — this keeps
   * `shared/` free of any dependency on `modules/cart`.
   */
  cartSlot: ReactNode;
  /**
   * IMP-036: the logout action (`AccountLogoutButton`, from
   * `@/modules/identity`) when a session exists, or `null` for a guest —
   * composed in by the layout for the exact same reason as `cartSlot`:
   * `shared/` must not depend on `modules/identity` either. The
   * guest/authenticated NAV LINKS below are plain data (`nav-items.ts`),
   * not a feature-owned widget, so they don't need this treatment.
   */
  accountSlot: ReactNode;
  /** Resolved once, server-side, by the layout via `@/modules/identity`'s `getCurrentUser()` — never read directly in `shared/`. */
  isAuthenticated: boolean;
}

export async function SiteHeader({ cartSlot, accountSlot, isAuthenticated }: SiteHeaderProps) {
  const tHeader = await getTranslations("Header");
  const tNav = await getTranslations("Nav");
  const accountNavItems = isAuthenticated ? authenticatedAccountNavItems : guestAccountNavItems;

  return (
    <header className="relative border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <Container className="flex h-16 items-center justify-between">
        <Link
          href="/"
          className="text-base font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {tHeader("brand")}
        </Link>

        <nav aria-label={tHeader("brand")} className="hidden md:block">
          <ul className="flex items-center gap-8">
            {navItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {tNav(item.labelKey)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-3">
          <nav aria-label={tHeader("accountNav")} className="hidden items-center gap-4 md:flex">
            <ul className="flex items-center gap-4">
              {accountNavItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {tNav(item.labelKey)}
                  </Link>
                </li>
              ))}
            </ul>
            {accountSlot}
          </nav>
          <LanguageSwitcher className="hidden sm:block" />
          {cartSlot}
          <MobileNav isAuthenticated={isAuthenticated} accountSlot={accountSlot} />
        </div>
      </Container>
    </header>
  );
}
