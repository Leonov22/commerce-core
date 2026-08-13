import { getTranslations, getLocale } from "next-intl/server";
import { Container } from "@/shared/components/layout/container";
import { Link } from "@/core/i18n/navigation";
import { buttonVariants } from "@/shared/components/ui/button";
import { formatProductPrice } from "@/modules/catalog/client";
import { cn } from "@/core/lib/utils";
import type { Order } from "@/modules/order/domain/order";

interface CustomerOrderListViewProps {
  orders: Order[];
  nextCursor: string | null;
}

/**
 * Receives already-resolved data as props rather than fetching it itself —
 * same treatment as `AccountDashboardView` (IMP-028): the page resolves the
 * current user via Identity, then calls `getCustomerOrders()`, and hands
 * the result down. Keeps this view a pure presentational shell.
 */
export async function CustomerOrderListView({ orders, nextCursor }: CustomerOrderListViewProps) {
  const t = await getTranslations("Account.orders");
  const locale = await getLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <section className="py-16 sm:py-24">
      <Container>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1>

        {orders.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <>
            <ul className="mt-10 flex flex-col gap-4">
              {orders.map((order) => (
                <li key={order.id} className="rounded-lg border border-border">
                  <Link
                    href={`/account/orders/${order.id}`}
                    className="flex flex-wrap items-center justify-between gap-4 p-6 text-sm hover:bg-accent"
                  >
                    <div>
                      <p className="font-medium">{t("orderReference", { id: order.id })}</p>
                      <p className="mt-1 text-muted-foreground">
                        {t("placedOn", { date: dateFormatter.format(order.createdAt) })}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {t("itemCount", { count: order.items.length })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-muted-foreground">{t(`status.${order.status}`)}</p>
                      <p className="mt-1 font-medium">
                        {formatProductPrice(order.totalAmountMinor, order.currency, locale)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            {nextCursor ? (
              <div className="mt-8">
                <Link
                  href={{ pathname: "/account/orders", query: { cursor: nextCursor } }}
                  className={cn(buttonVariants({ variant: "outline" }))}
                >
                  {t("loadMore")}
                </Link>
              </div>
            ) : null}
          </>
        )}
      </Container>
    </section>
  );
}
