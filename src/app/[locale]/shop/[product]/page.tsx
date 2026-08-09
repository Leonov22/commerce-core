import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ProductDetailsView } from "@/modules/catalog/presentation/product-details-view";
import {
  getCatalogProductById,
  getCatalogProducts,
} from "@/modules/catalog/presentation/catalog-data";

type Props = PageProps<"/[locale]/shop/[product]">;

export function generateStaticParams() {
  return getCatalogProducts().map((product) => ({ product: product.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, product: productId } = await params;
  const product = getCatalogProductById(productId);

  if (!product) {
    notFound();
  }

  const tCatalog = await getTranslations({ locale, namespace: "Catalog" });
  const tDetails = await getTranslations({ locale, namespace: "ProductDetails" });
  const name = tCatalog(`products.${product.translationKey}.name`);

  return {
    title: `${name} — ${tDetails("meta.titleSuffix")}`,
    description: tDetails(`products.${product.translationKey}.description`),
  };
}

export default async function ProductDetailsPage({ params }: Props) {
  const { product: productId } = await params;
  const product = getCatalogProductById(productId);

  if (!product) {
    notFound();
  }

  return <ProductDetailsView product={product} />;
}
