import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CatalogView } from "@/modules/catalog/presentation/catalog-view";

type Props = PageProps<"/[locale]/shop">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Catalog.meta" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default function ShopPage() {
  return <CatalogView />;
}
