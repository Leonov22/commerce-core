import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link } from "@/core/i18n/navigation";
import { Container } from "@/shared/components/layout/container";
import { ProductCard } from "@/shared/components/product-card";
import { listProducts } from "@/modules/catalog";
import { formatProductPrice, productDetailsHref } from "@/modules/catalog/client";

/**
 * IMP-037: previously rendered static mock data with no link — clicking a
 * card did nothing. Now backed by the real Catalog (`Product.isFeatured`,
 * already a domain field with its own index, just never queried before
 * this milestone) and linked to the existing product details route
 * (`/shop/${product.id}`) — the exact convention `catalog-grid.tsx` already
 * established for the Shop listing, reused here rather than invented.
 * Fetched server-side, same as `CatalogView`/`ProductDetailsView` — no
 * client-side round trip for data the server already has at render time.
 */
export async function FeaturedProductsSection() {
  const locale = await getLocale();
  const t = await getTranslations("FeaturedProducts");
  const products = await listProducts(locale, { featuredOnly: true });

  // Nothing curated yet — the section has nothing honest to show, so it
  // simply doesn't render rather than displaying an empty grid under a
  // heading (this is a homepage teaser, not the full Catalog page, which
  // already has its own empty-state message for a genuinely empty result).
  if (products.length === 0) {
    return null;
  }

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
          {products.map((product) => (
            <ProductCard
              key={product.id}
              name={product.translation.name}
              meta={product.translation.meta}
              price={formatProductPrice(product.priceAmountMinor, product.currency, locale)}
              badge={
                product.badge === "NEW"
                  ? t("newBadge")
                  : product.badge === "LIMITED"
                    ? t("limitedBadge")
                    : undefined
              }
              imageLabel={t("imagePlaceholder")}
              href={productDetailsHref(product.id)}
            />
          ))}
        </div>
      </Container>
    </section>
  );
}
