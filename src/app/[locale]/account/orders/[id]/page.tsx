import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser, resolveProtectedPageRedirect } from "@/modules/identity";
import { getCustomerOrder, CustomerOrderDetailView } from "@/modules/order";
import { redirect } from "@/core/i18n/navigation";

type Props = PageProps<"/[locale]/account/orders/[id]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Account.orders.detailMeta" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function AccountOrderDetail({ params }: Props) {
  const { locale, id } = await params;
  const user = await getCurrentUser();
  const redirectTo = resolveProtectedPageRedirect(user);
  if (redirectTo) {
    redirect({ href: redirectTo, locale });
  }

  // Non-null: `resolveProtectedPageRedirect` already returned above for a
  // null user — by this point `user` is guaranteed authenticated.
  const order = await getCustomerOrder(user!.id, id);
  if (!order) {
    // Deliberately identical whether the order doesn't exist or belongs to
    // another customer — never reveals which case it is.
    notFound();
  }

  return <CustomerOrderDetailView order={order} />;
}
