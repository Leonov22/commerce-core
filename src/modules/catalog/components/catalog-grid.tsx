import { useTranslations } from "next-intl";
import { ProductCard } from "@/shared/components/product-card";
import type { CatalogProduct } from "@/modules/catalog/types/catalog-product";

interface CatalogGridProps {
  products: CatalogProduct[];
}

export function CatalogGrid({ products }: CatalogGridProps) {
  const t = useTranslations("Catalog");

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
          name={t(`products.${product.translationKey}.name`)}
          meta={t(`products.${product.translationKey}.meta`)}
          price={t(`products.${product.translationKey}.price`)}
          badge={
            product.badgeKey === "new"
              ? t("newBadge")
              : product.badgeKey === "limited"
                ? t("limitedBadge")
                : undefined
          }
          imageLabel={t("imagePlaceholder")}
          href={`/shop/${product.id}`}
        />
      ))}
    </div>
  );
}
