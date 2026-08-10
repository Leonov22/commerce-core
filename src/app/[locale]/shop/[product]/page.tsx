import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ProductDetailsView } from "@/modules/catalog/presentation/product-details-view";
import { getProductById, listProducts, listCategories } from "@/modules/catalog";
import { routing } from "@/core/i18n/routing";

type Props = PageProps<"/[locale]/shop/[product]">;

export async function generateStaticParams() {
  const products = await listProducts(routing.defaultLocale);
  return products.map((product) => ({ product: product.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, product: productId } = await params;
  const product = await getProductById(productId, locale);

  if (!product) {
    notFound();
  }

  const tDetails = await getTranslations({ locale, namespace: "ProductDetails" });

  return {
    title: `${product.translation.name} — ${tDetails("meta.titleSuffix")}`,
    description: product.translation.description,
  };
}

export default async function ProductDetailsPage({ params }: Props) {
  const { locale, product: productId } = await params;
  const product = await getProductById(productId, locale);

  if (!product) {
    notFound();
  }

  const categories = await listCategories(locale);
  const categoryName = categories.find((category) => category.slug === product.categorySlug)
    ?.translation.name;

  return <ProductDetailsView product={product} categoryName={categoryName} />;
}
