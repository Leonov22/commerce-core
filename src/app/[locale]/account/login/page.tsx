import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getCurrentUser, resolveGuestOnlyPageRedirect, AccountLoginView } from "@/modules/identity";
import { redirect } from "@/core/i18n/navigation";

type Props = PageProps<"/[locale]/account/login">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Account.login.meta" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function AccountLogin({ params }: Props) {
  const { locale } = await params;
  const user = await getCurrentUser();
  const redirectTo = resolveGuestOnlyPageRedirect(user);
  if (redirectTo) {
    redirect({ href: redirectTo, locale });
  }

  return <AccountLoginView />;
}
