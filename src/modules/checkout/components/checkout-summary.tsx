import { useTranslations } from "next-intl";
import { Package } from "lucide-react";
import { getCatalogProductById } from "@/modules/catalog";
import { DELIVERY_OPTIONS } from "@/modules/checkout/types/checkout";
import type {
  CheckoutCartItem,
  CheckoutCatalogProduct,
  DeliveryMethodKey,
} from "@/modules/checkout/types/checkout";

interface CheckoutSummaryProps {
  items: CheckoutCartItem[];
  deliveryMethod: DeliveryMethodKey | null;
}

interface ResolvedLine {
  item: CheckoutCartItem;
  product: CheckoutCatalogProduct;
}

export function CheckoutSummary({ items, deliveryMethod }: CheckoutSummaryProps) {
  const t = useTranslations("Checkout");
  const tCatalog = useTranslations("Catalog");

  // A cart line that no longer resolves through Catalog's public API is
  // skipped rather than guessed at — no replacement data is invented.
  const resolvedLines = items.reduce<ResolvedLine[]>((lines, item) => {
    const product = getCatalogProductById(item.productId);
    return product ? [...lines, { item, product }] : lines;
  }, []);

  const subtotalAmount = resolvedLines.reduce(
    (sum, { item, product }) => sum + product.priceAmount * item.quantity,
    0,
  );
  const deliveryOption = DELIVERY_OPTIONS.find((option) => option.key === deliveryMethod);
  const deliveryAmount = deliveryOption?.priceAmount ?? 0;
  const totalAmount = subtotalAmount + deliveryAmount;

  return (
    <div className="rounded-lg border border-border p-6">
      <h2 className="text-base font-medium">{t("summary.heading")}</h2>

      <ul className="mt-6 flex flex-col gap-4">
        {resolvedLines.map(({ item, product }) => {
          const name = tCatalog(`products.${product.translationKey}.name`);
          const price = tCatalog(`products.${product.translationKey}.price`);

          return (
            <li key={item.productId} className="flex items-start gap-3">
              <div
                role="img"
                aria-label={tCatalog("imagePlaceholder")}
                className="flex h-12 w-12 flex-none items-center justify-center rounded-md border border-border bg-muted"
              >
                <Package
                  aria-hidden="true"
                  className="h-5 w-5 text-muted-foreground"
                  strokeWidth={1.25}
                />
              </div>
              <div className="flex flex-1 items-start justify-between gap-2 text-sm">
                <div>
                  <p className="font-medium">{name}</p>
                  <p className="text-muted-foreground">
                    {t("summary.quantity", { quantity: item.quantity })}
                  </p>
                </div>
                <p className="font-medium">{price}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex flex-col gap-2 border-t border-border pt-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t("summary.subtotal")}</span>
          <span className="font-medium">{t("summary.amount", { amount: subtotalAmount })}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t("summary.delivery")}</span>
          <span className="font-medium">
            {deliveryOption
              ? t("summary.amount", { amount: deliveryAmount })
              : t("summary.deliveryPending")}
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-2 text-base">
          <span className="font-medium">{t("summary.total")}</span>
          <span className="font-semibold">{t("summary.amount", { amount: totalAmount })}</span>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">{t("summary.disclaimer")}</p>
    </div>
  );
}
