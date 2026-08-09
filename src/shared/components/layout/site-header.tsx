import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/core/i18n/navigation";
import { Container } from "@/shared/components/layout/container";
import { LanguageSwitcher } from "@/shared/components/layout/language-switcher";
import { MobileNav } from "@/shared/components/layout/mobile-nav";
import { navItems } from "@/shared/components/layout/nav-items";

interface SiteHeaderProps {
  /**
   * The cart entry point is a feature-owned widget (it reads Cart Context),
   * so the layout composes it and passes it in here — this keeps
   * `shared/` free of any dependency on `modules/cart`.
   */
  cartSlot: ReactNode;
}

export async function SiteHeader({ cartSlot }: SiteHeaderProps) {
  const tHeader = await getTranslations("Header");
  const tNav = await getTranslations("Nav");

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
          <LanguageSwitcher className="hidden sm:block" />
          {cartSlot}
          <MobileNav />
        </div>
      </Container>
    </header>
  );
}
