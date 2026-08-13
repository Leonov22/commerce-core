import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
  getCurrentUser,
  resolveGuestOnlyPageRedirect,
  AccountRegisterView,
} from "@/modules/identity";
import { redirect } from "@/core/i18n/navigation";

type Props = PageProps<"/[locale]/account/register">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Account.register.meta" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function AccountRegister({ params }: Props) {
  const { locale } = await params;
  const user = await getCurrentUser();
  const redirectTo = resolveGuestOnlyPageRedirect(user);
  if (redirectTo) {
    redirect({ href: redirectTo, locale });
  }

  return <AccountRegisterView />;
}
