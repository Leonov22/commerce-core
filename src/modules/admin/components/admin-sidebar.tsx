"use client";

import { usePathname, Link } from "@/core/i18n/navigation";
import { cn } from "@/core/lib/utils";

interface AdminNavItem {
  key: string;
  label: string;
  href: string;
  /** Not yet implemented — rendered as a disabled, non-navigable item rather than omitted or linking to a broken page. */
  available: boolean;
}

const NAV_ITEMS: AdminNavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/admin", available: true },
  { key: "products", label: "Products", href: "/admin/products", available: true },
  { key: "categories", label: "Categories", href: "/admin/categories", available: true },
  { key: "discounts", label: "Discounts", href: "/admin/discounts", available: false },
  { key: "orders", label: "Orders", href: "/admin/orders", available: false },
  { key: "inventory", label: "Inventory", href: "/admin/inventory", available: false },
  { key: "customers", label: "Customers", href: "/admin/customers", available: false },
  { key: "analytics", label: "Analytics", href: "/admin/analytics", available: false },
  { key: "settings", label: "Settings", href: "/admin/settings", available: false },
];

/**
 * Sidebar navigation for the Admin Panel (IMP-043). Only Dashboard,
 * Products, and Categories are functional this milestone — every other
 * section is rendered as a visibly disabled item (not a working link, not
 * omitted entirely) so the planned structure is legible without ever
 * routing to a page that doesn't exist. Adding a real page for one of
 * these later is a one-line change (`available: true`), never a layout
 * change.
 */
export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin" className="flex flex-col gap-1 p-4">
      {NAV_ITEMS.map((item) => {
        const isActive =
          item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);

        if (!item.available) {
          return (
            <span
              key={item.key}
              aria-disabled="true"
              className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground/50"
            >
              {item.label}
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/40">
                Soon
              </span>
            </span>
          );
        }

        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
