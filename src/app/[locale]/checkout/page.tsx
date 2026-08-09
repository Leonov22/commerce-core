import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CheckoutView } from "@/modules/checkout";

type Props = PageProps<"/[locale]/checkout">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Checkout.meta" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default function Checkout() {
  return <CheckoutView />;
}
