"use client";

import { useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/core/i18n/navigation";
import {
  navItems,
  guestAccountNavItems,
  authenticatedAccountNavItems,
} from "@/shared/components/layout/nav-items";

interface MobileNavProps {
  /** Same meaning as `SiteHeader`'s prop of the same name — see its doc comment. */
  isAuthenticated: boolean;
  accountSlot: ReactNode;
}

export function MobileNav({ isAuthenticated, accountSlot }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const tHeader = useTranslations("Header");
  const tNav = useTranslations("Nav");
  const accountNavItems = isAuthenticated ? authenticatedAccountNavItems : guestAccountNavItems;

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        aria-label={open ? tHeader("closeMenu") : tHeader("openMenu")}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {open ? (
          <X aria-hidden="true" className="h-5 w-5" />
        ) : (
          <Menu aria-hidden="true" className="h-5 w-5" />
        )}
      </button>

      {open ? (
        <nav
          id="mobile-nav-panel"
          aria-label={tHeader("brand")}
          className="absolute inset-x-0 top-16 border-b border-border bg-background px-4 pb-6 pt-2 sm:px-6"
        >
          <ul className="flex flex-col gap-1">
            {navItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-3 py-3 text-base font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {tNav(item.labelKey)}
                </Link>
              </li>
            ))}
          </ul>

          <hr className="my-3 border-border" />

          <ul className="flex flex-col gap-1" aria-label={tHeader("accountNav")}>
            {accountNavItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-3 py-3 text-base font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {tNav(item.labelKey)}
                </Link>
              </li>
            ))}
            {accountSlot ? <li className="px-3 pt-2">{accountSlot}</li> : null}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
