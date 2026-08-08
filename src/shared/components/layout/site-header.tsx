import { getTranslations } from "next-intl/server";
import { ShoppingBag } from "lucide-react";
import { Link } from "@/core/i18n/navigation";
import { Container } from "@/shared/components/layout/container";
import { LanguageSwitcher } from "@/shared/components/layout/language-switcher";
import { MobileNav } from "@/shared/components/layout/mobile-nav";
import { navItems } from "@/shared/components/layout/nav-items";

export async function SiteHeader() {
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
          <Link
            href="/cart"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span className="sr-only">{tHeader("cart")}</span>
            <ShoppingBag aria-hidden="true" className="h-5 w-5" />
          </Link>
          <MobileNav />
        </div>
      </Container>
    </header>
  );
}
