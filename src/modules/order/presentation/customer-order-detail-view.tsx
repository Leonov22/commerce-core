import { getTranslations, getLocale } from "next-intl/server";
import { Package } from "lucide-react";
import { Container } from "@/shared/components/layout/container";
import { Link } from "@/core/i18n/navigation";
import { formatProductPrice } from "@/shared/utils/format-price";
import type { Order } from "@/modules/order/domain/order";

interface CustomerOrderDetailViewProps {
  order: Order;
}

/**
 * Renders exclusively from the Order's own stored snapshot — never
 * re-fetches or re-derives pricing from Catalog. A historical order must
 * display exactly what was true at checkout time, even if the underlying
 * Product's price or name has since changed or the Product no longer
 * exists (see `checkout-order.ts`'s own doc comment on why the snapshot is
 * captured this way).
 *
 * No delivery-method label is shown: the Order snapshot only ever captured
 * the resolved `deliveryAmountMinor`, never which delivery method key was
 * chosen — adding that would be a new Order field, outside this
 * milestone's minimal, ownership-only schema change.
 */
export async function CustomerOrderDetailView({ order }: CustomerOrderDetailViewProps) {
  const t = await getTranslations("Account.orders");
  const locale = await getLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <section className="py-16 sm:py-24">
      <Container>
        <Link href="/account/orders" className="text-sm text-muted-foreground underline">
          {t("backToOrders")}
        </Link>

        <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          {t("orderReference", { id: order.id })}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("placedOn", { date: dateFormatter.format(order.createdAt) })}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{t(`status.${order.status}`)}</p>

        <div className="mt-10 rounded-lg border border-border p-6">
          <ul className="flex flex-col gap-4">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-start gap-3">
                <div
                  role="img"
                  aria-label=""
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
                    <p className="font-medium">{item.productName}</p>
                    <p className="text-muted-foreground">
                      {t("quantity", { quantity: item.quantity })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">
                      {formatProductPrice(item.lineTotalAmountMinor, item.currency, locale)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("unitPrice", {
                        amount: formatProductPrice(
                          item.unitPriceAmountMinor,
                          item.currency,
                          locale,
                        ),
                      })}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-col gap-2 border-t border-border pt-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("subtotal")}</span>
              <span className="font-medium">
                {formatProductPrice(order.subtotalAmountMinor, order.currency, locale)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("delivery")}</span>
              <span className="font-medium">
                {formatProductPrice(order.deliveryAmountMinor, order.currency, locale)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2 text-base">
              <span className="font-medium">{t("total")}</span>
              <span className="font-semibold">
                {formatProductPrice(order.totalAmountMinor, order.currency, locale)}
              </span>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
