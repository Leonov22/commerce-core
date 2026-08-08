import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link } from "@/core/i18n/navigation";
import { Container } from "@/shared/components/layout/container";
import { ProductCard } from "@/shared/components/product-card";

/**
 * Static mock data for visual composition only — not a Product entity.
 * Display strings (name/meta/price) live in the FeaturedProducts.products
 * translation namespace; this only references translation keys.
 * Real catalog data will replace this once the catalog module is implemented.
 */
type MockProductTranslationKey = "studioChair" | "ceramicVase" | "woolThrow" | "tableLamp";

type MockProduct = {
  id: string;
  translationKey: MockProductTranslationKey;
  badge?: "New" | "Limited";
};

const mockProducts: MockProduct[] = [
  { id: "1", translationKey: "studioChair", badge: "New" },
  { id: "2", translationKey: "ceramicVase" },
  { id: "3", translationKey: "woolThrow" },
  { id: "4", translationKey: "tableLamp", badge: "Limited" },
];

export async function FeaturedProductsSection() {
  const t = await getTranslations("FeaturedProducts");

  return (
    <section className="border-t border-border py-16 sm:py-24">
      <Container>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
              {t("eyebrow")}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">{t("title")}</h2>
            <p className="mt-3 max-w-md text-muted-foreground">{t("subtitle")}</p>
          </div>

          <Link
            href="/shop"
            className="inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {t("viewAll")}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4">
          {mockProducts.map((product) => (
            <ProductCard
              key={product.id}
              name={t(`products.${product.translationKey}.name`)}
              meta={t(`products.${product.translationKey}.meta`)}
              price={t(`products.${product.translationKey}.price`)}
              badge={
                product.badge === "New"
                  ? t("newBadge")
                  : product.badge === "Limited"
                    ? t("limitedBadge")
                    : undefined
              }
              imageLabel={t("imagePlaceholder")}
            />
          ))}
        </div>
      </Container>
    </section>
  );
}
