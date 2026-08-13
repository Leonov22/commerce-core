import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getCurrentUser, resolveProtectedPageRedirect } from "@/modules/identity";
import { getCustomerOrders, CustomerOrderListView } from "@/modules/order";
import { redirect } from "@/core/i18n/navigation";

type Props = PageProps<"/[locale]/account/orders">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Account.orders.meta" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function AccountOrders({ params, searchParams }: Props) {
  const { locale } = await params;
  const user = await getCurrentUser();
  const redirectTo = resolveProtectedPageRedirect(user);
  if (redirectTo) {
    redirect({ href: redirectTo, locale });
  }

  const query = await searchParams;
  const cursor = typeof query.cursor === "string" ? query.cursor : undefined;

  // Non-null: `resolveProtectedPageRedirect` already returned above for a
  // null user — by this point `user` is guaranteed authenticated.
  const { orders, nextCursor } = await getCustomerOrders(user!.id, cursor);

  return <CustomerOrderListView orders={orders} nextCursor={nextCursor} />;
}
