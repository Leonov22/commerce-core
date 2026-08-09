import { useTranslations } from "next-intl";
import { Button } from "@/shared/components/ui/button";
import { getCatalogProductById } from "@/modules/catalog/presentation/catalog-data";
import type { CartItem } from "@/modules/cart/types/cart";

interface CartSummaryProps {
  items: CartItem[];
}

export function CartSummary({ items }: CartSummaryProps) {
  const t = useTranslations("Cart");

  // Presentation-only calculation from the static catalog's price values.
  // A future backend checkout must recalculate authoritative prices.
  const subtotalAmount = items.reduce((sum, item) => {
    const product = getCatalogProductById(item.productId);
    return product ? sum + product.priceAmount * item.quantity : sum;
  }, 0);

  return (
    <div className="rounded-lg border border-border p-6">
      <h2 className="text-base font-medium">{t("summaryHeading")}</h2>

      <div className="mt-6 flex items-center justify-between border-t border-border pt-4 text-sm">
        <span className="text-muted-foreground">{t("subtotal")}</span>
        <span className="font-medium">{t("subtotalValue", { amount: subtotalAmount })}</span>
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
