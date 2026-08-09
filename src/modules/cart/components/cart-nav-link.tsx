"use client";

import { ShoppingBag } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/core/i18n/navigation";
import { useCart } from "@/modules/cart/state/cart-context";

export function CartNavLink() {
  const t = useTranslations("Header");
  const { totalQuantity } = useCart();

  return (
    <Link
      href="/cart"
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span className="sr-only">
        {totalQuantity > 0 ? t("cartWithCount", { count: totalQuantity }) : t("cart")}
      </span>
      <ShoppingBag aria-hidden="true" className="h-5 w-5" />
      {totalQuantity > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none text-primary-foreground"
        >
          {totalQuantity}
        </span>
      ) : null}
    </Link>
  );
}
