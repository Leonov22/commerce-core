import { useLocale, useTranslations } from "next-intl";
import { ProductCard } from "@/shared/components/product-card";
import { formatProductPrice, productDetailsHref } from "@/modules/catalog/client";
import type { Product } from "@/modules/catalog";

interface CatalogGridProps {
  products: Product[];
}

export function CatalogGrid({ products }: CatalogGridProps) {
  const t = useTranslations("Catalog");
  const locale = useLocale();

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-24 text-center">
        <p className="text-sm font-medium">{t("empty.title")}</p>
        <p className="text-sm text-muted-foreground">{t("empty.body")}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-3">
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
  );
}
