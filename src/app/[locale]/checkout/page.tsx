import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CheckoutView } from "@/modules/checkout";
import { getCurrentUser } from "@/modules/identity";

type Props = PageProps<"/[locale]/checkout">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Checkout.meta" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function Checkout() {
  // IMP-040: resolved once here, server-side, exactly like
  // `[locale]/layout.tsx` already does for the header — Checkout's own
  // presentation layer never imports `@/modules/identity` itself. Decides
  // only whether `CheckoutSuccess` offers a "pay now" link or a "sign in
  // to pay" prompt; the actual payment page independently re-verifies
  // the session and ownership regardless of this value.
  const user = await getCurrentUser();
  return <CheckoutView isAuthenticated={Boolean(user)} />;
}
