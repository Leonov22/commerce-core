import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CheckoutView } from "@/modules/checkout";
import { getCurrentUser, resolveProtectedPageRedirect } from "@/modules/identity";
import { redirect } from "@/core/i18n/navigation";

type Props = PageProps<"/[locale]/checkout">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Checkout.meta" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

/**
 * Account-first checkout: placing an order now requires an authenticated
 * session, enforced here the same way every other protected page already
 * does (`resolveProtectedPageRedirect`, already used by
 * `account/orders/page.tsx` and `account/orders/[id]/page.tsx`) — no new
 * authorization model. `callbackUrl=/checkout` lets the login/registration
 * forms send the customer straight back here after signing in, rather than
 * to the generic `/account` dashboard. This is a server-side redirect, not
 * merely a UI affordance — `POST /api/orders` independently rejects an
 * unauthenticated request regardless of whether this page was ever reached.
 */
export default async function Checkout({ params }: Props) {
  const { locale } = await params;
  const user = await getCurrentUser();
  const redirectTo = resolveProtectedPageRedirect(user);
  if (redirectTo) {
    redirect({ href: `${redirectTo}?callbackUrl=%2Fcheckout`, locale });
  }

  return <CheckoutView isAuthenticated={Boolean(user)} />;
}
