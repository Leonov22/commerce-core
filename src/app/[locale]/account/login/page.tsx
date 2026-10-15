import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getCurrentUser, resolveGuestOnlyPageRedirect, AccountLoginView } from "@/modules/identity";
import { resolveSafeCallbackUrl } from "@/modules/identity/application/callback-url";
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

export default async function AccountLogin({ params, searchParams }: Props) {
  const { locale } = await params;
  const user = await getCurrentUser();

  const query = await searchParams;
  const callbackUrl = resolveSafeCallbackUrl(
    typeof query.callbackUrl === "string" ? query.callbackUrl : undefined,
  );

  // An already-authenticated visitor is sent straight to their intended
  // destination (e.g. back to /checkout) rather than unconditionally to
  // /account — `resolveGuestOnlyPageRedirect` only decides WHETHER to
  // redirect away from this guest-only page; `callbackUrl` (validated
  // above, defaulting to /account when absent) decides WHERE.
  if (resolveGuestOnlyPageRedirect(user)) {
    redirect({ href: callbackUrl, locale });
  }

  return <AccountLoginView callbackUrl={callbackUrl} />;
}
