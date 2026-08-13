import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
  getCurrentUser,
  resolveProtectedPageRedirect,
  AccountDashboardView,
} from "@/modules/identity";
import { redirect } from "@/core/i18n/navigation";

type Props = PageProps<"/[locale]/account">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Account.dashboard.meta" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function Account({ params }: Props) {
  const { locale } = await params;
  const user = await getCurrentUser();
  const redirectTo = resolveProtectedPageRedirect(user);
  if (redirectTo) {
    redirect({ href: redirectTo, locale });
  }

  // Non-null: `resolveProtectedPageRedirect` already returned above for a
  // null user — by this point `user` is guaranteed authenticated.
  return <AccountDashboardView user={user!} />;
}
