import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CartPage } from "@/modules/cart/components/cart-page";

type Props = PageProps<"/[locale]/cart">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Cart.meta" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default function Cart() {
  return <CartPage />;
}
