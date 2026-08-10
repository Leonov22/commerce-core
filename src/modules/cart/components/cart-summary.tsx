import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/shared/components/ui/button";
import { formatProductPrice } from "@/modules/catalog/client";
import type { StorefrontProductSummary } from "@/modules/catalog/client";
import type { CartItem } from "@/modules/cart/types/cart";

interface CartSummaryProps {
  items: CartItem[];
  productsById: Map<string, StorefrontProductSummary>;
}

export function CartSummary({ items, productsById }: CartSummaryProps) {
  const t = useTranslations("Cart");
  const locale = useLocale();

  // Presentation-only calculation from currently-resolved catalog prices.
  // Checkout must recalculate authoritative prices server-side.
  let subtotalAmountMinor = 0;
  let currency = "USD";
  for (const item of items) {
    const product = productsById.get(item.productId);
    if (product) {
      subtotalAmountMinor += product.priceAmountMinor * item.quantity;
      currency = product.currency;
    }
  }
  const subtotal = formatProductPrice(subtotalAmountMinor, currency, locale);

  return (
    <div className="rounded-lg border border-border p-6">
      <h2 className="text-base font-medium">{t("summaryHeading")}</h2>

      <div className="mt-6 flex items-center justify-between border-t border-border pt-4 text-sm">
        <span className="text-muted-foreground">{t("subtotal")}</span>
        <span className="font-medium">{t("subtotalValue", { amount: subtotal })}</span>
      </div>

      <Button disabled aria-describedby="checkout-note" className="mt-6 w-full">
        {t("checkout")}
      </Button>
      <p id="checkout-note" className="mt-2 text-xs text-muted-foreground">
        {t("checkoutUnavailable")}
      </p>
    </div>
  );
}
