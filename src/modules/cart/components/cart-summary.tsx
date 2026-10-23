import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/core/i18n/navigation";
import { Button, buttonVariants } from "@/shared/components/ui/button";
import { cn } from "@/core/lib/utils";
import { formatProductPrice } from "@/modules/catalog/client";
import type { StorefrontProductSummary } from "@/modules/catalog/client";
import { canCheckout, calculateCartSubtotal } from "@/modules/cart/types/cart";
import type { CartItem } from "@/modules/cart/types/cart";

interface CartSummaryProps {
  items: CartItem[];
  productsById: Map<string, StorefrontProductSummary>;
  isLoading: boolean;
}

export function CartSummary({ items, productsById, isLoading }: CartSummaryProps) {
  const t = useTranslations("Cart");
  const locale = useLocale();

  // Presentation-only calculation from currently-resolved catalog prices.
  // Checkout must recalculate authoritative prices server-side. See
  // `calculateCartSubtotal`'s own doc comment for the bug this used to
  // have (summing the pre-discount `priceAmountMinor` instead of
  // `effectivePriceAmountMinor`) and why the logic now lives there,
  // directly unit-tested, instead of inline here.
  const { amountMinor: subtotalAmountMinor, currency } = calculateCartSubtotal(items, productsById);
  const subtotal = formatProductPrice(subtotalAmountMinor, currency, locale);

  const ready = canCheckout(items, productsById, isLoading);

  return (
    <div className="rounded-lg border border-border p-6">
      <h2 className="text-base font-medium">{t("summaryHeading")}</h2>

      <div className="mt-6 flex items-center justify-between border-t border-border pt-4 text-sm">
        <span className="text-muted-foreground">{t("subtotal")}</span>
        <span className="font-medium">{t("subtotalValue", { amount: subtotal })}</span>
      </div>

      {ready ? (
        <Link href="/checkout" className={cn(buttonVariants(), "mt-6 w-full")}>
          {t("checkout")}
        </Link>
      ) : (
        <>
          <Button disabled aria-describedby="checkout-note" className="mt-6 w-full">
            {t("checkout")}
          </Button>
          <p id="checkout-note" className="mt-2 text-xs text-muted-foreground">
            {t("checkoutUnavailable")}
          </p>
        </>
      )}
    </div>
  );
}
