import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HeroSection } from "@/app/[locale]/_components/hero-section";
import { FeaturedProductsSection } from "@/app/[locale]/_components/featured-products-section";
import { BrandValuesSection } from "@/app/[locale]/_components/brand-values-section";
import { CtaSection } from "@/app/[locale]/_components/cta-section";

type Props = PageProps<"/[locale]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta.home" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default function HomePage() {
  return (
    <>
      <HeroSection />
      <FeaturedProductsSection />
      <BrandValuesSection />
      <CtaSection />
    </>
  );
}
