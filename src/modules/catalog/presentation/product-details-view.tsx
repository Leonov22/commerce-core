import { getTranslations } from "next-intl/server";
import { ArrowLeft, Package } from "lucide-react";
import { Link } from "@/core/i18n/navigation";
import { Container } from "@/shared/components/layout/container";
import { Button } from "@/shared/components/ui/button";
import type { CatalogProduct } from "@/modules/catalog/types/catalog-product";

interface ProductDetailsViewProps {
  product: CatalogProduct;
}

export async function ProductDetailsView({ product }: ProductDetailsViewProps) {
  const tCatalog = await getTranslations("Catalog");
  const tDetails = await getTranslations("ProductDetails");
  const key = product.translationKey;

  const name = tCatalog(`products.${key}.name`);
  const meta = tCatalog(`products.${key}.meta`);
  const price = tCatalog(`products.${key}.price`);
  const category = product.categoryKey ? tCatalog(`categories.${product.categoryKey}`) : undefined;
  const badge =
    product.badgeKey === "new"
      ? tCatalog("newBadge")
      : product.badgeKey === "limited"
        ? tCatalog("limitedBadge")
        : undefined;

  const attributes = [
    {
      label: tDetails("attributes.materialLabel"),
      value: tDetails(`products.${key}.attributes.material`),
    },
    {
      label: tDetails("attributes.dimensionsLabel"),
      value: tDetails(`products.${key}.attributes.dimensions`),
    },
    {
      label: tDetails("attributes.availabilityLabel"),
      value: tDetails(`products.${key}.attributes.availability`),
    },
  ];

  return (
    <section className="py-16 sm:py-24">
      <Container>
        <Link
          href="/shop"
          className="inline-flex items-center gap-2 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {tDetails("back")}
        </Link>

        <div className="mt-8 grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
          <div
            role="img"
            aria-label={tDetails("imagePlaceholder")}
            className="relative flex aspect-square items-center justify-center rounded-lg border border-border bg-muted"
          >
            <Package
              aria-hidden="true"
              className="h-16 w-16 text-muted-foreground"
              strokeWidth={1.25}
            />
            {badge ? (
              <span className="absolute left-4 top-4 rounded-full bg-background px-2.5 py-1 text-xs font-medium">
                {badge}
              </span>
            ) : null}
          </div>

          <div>
            {category ? (
              <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
                {category}
              </p>
            ) : null}
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{meta}</p>
            <p className="mt-4 text-xl font-medium">{price}</p>
            <p className="mt-6 max-w-md leading-relaxed text-muted-foreground">
              {tDetails(`products.${key}.description`)}
            </p>

            <dl className="mt-8 flex flex-col gap-3 border-t border-border pt-6">
              <h2 className="sr-only">{tDetails("attributes.heading")}</h2>
              {attributes.map((attribute) => (
                <div key={attribute.label} className="flex justify-between gap-4 text-sm">
                  <dt className="text-muted-foreground">{attribute.label}</dt>
                  <dd className="font-medium">{attribute.value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-8">
              <Button disabled aria-describedby="add-to-cart-note" className="w-full sm:w-auto">
                {tDetails("addToCart.button")}
              </Button>
              <p id="add-to-cart-note" className="mt-2 text-xs text-muted-foreground">
                {tDetails("addToCart.unavailable")}
              </p>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
