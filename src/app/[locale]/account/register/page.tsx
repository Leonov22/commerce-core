import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
  getCurrentUser,
  resolveGuestOnlyPageRedirect,
  AccountRegisterView,
} from "@/modules/identity";
import { resolveSafeCallbackUrl } from "@/modules/identity/application/callback-url";
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

export default async function AccountRegister({ params, searchParams }: Props) {
  const { locale } = await params;
  const user = await getCurrentUser();

  const query = await searchParams;
  const callbackUrl = resolveSafeCallbackUrl(
    typeof query.callbackUrl === "string" ? query.callbackUrl : undefined,
  );

  // Same reasoning as account/login/page.tsx: WHETHER to redirect away
  // comes from resolveGuestOnlyPageRedirect, WHERE to send them comes from
  // the validated callbackUrl.
  if (resolveGuestOnlyPageRedirect(user)) {
    redirect({ href: callbackUrl, locale });
  }

  return <AccountRegisterView callbackUrl={callbackUrl} />;
}
