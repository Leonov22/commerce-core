import { getTranslations } from "next-intl/server";
import { Link } from "@/core/i18n/navigation";
import { Container } from "@/shared/components/layout/container";
import { LanguageSwitcher } from "@/shared/components/layout/language-switcher";
import { navItems } from "@/shared/components/layout/nav-items";

export async function SiteFooter() {
  const tFooter = await getTranslations("Footer");
  const tNav = await getTranslations("Nav");
  const year = new Date().getFullYear();

  const legalItems = [
    { href: "/privacy", label: tFooter("legal.privacy") },
    { href: "/terms", label: tFooter("legal.terms") },
  ];

  const socialLabels = [
    tFooter("social.instagram"),
    tFooter("social.x"),
    tFooter("social.pinterest"),
  ];

  return (
    <footer className="border-t border-border">
      <Container className="grid gap-10 py-16 sm:grid-cols-2 sm:gap-x-8 lg:grid-cols-12">
        <div className="sm:col-span-2 lg:col-span-4">
          <p className="text-base font-semibold tracking-tight">{tFooter("brand")}</p>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">{tFooter("tagline")}</p>
        </div>

        <nav aria-label={tFooter("navHeading")} className="lg:col-span-2">
          <h2 className="text-sm font-medium">{tFooter("navHeading")}</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {navItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {tNav(item.labelKey)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label={tFooter("legalHeading")} className="lg:col-span-2">
          <h2 className="text-sm font-medium">{tFooter("legalHeading")}</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {legalItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="lg:col-span-2">
          <h2 className="text-sm font-medium">{tFooter("socialHeading")}</h2>
          <p className="mt-4 text-sm text-muted-foreground">{socialLabels.join(" · ")}</p>
        </div>

        <div className="lg:col-span-2">
          <h2 className="text-sm font-medium">{tFooter("language")}</h2>
          <LanguageSwitcher className="mt-4 block" />
        </div>
      </Container>

      <div className="border-t border-border">
        <Container className="py-6">
          <p className="text-xs text-muted-foreground">{tFooter("rights", { year })}</p>
        </Container>
      </div>
    </footer>
  );
}
