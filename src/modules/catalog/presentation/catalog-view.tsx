import { getTranslations } from "next-intl/server";
import { Container } from "@/shared/components/layout/container";
import { CatalogBrowser } from "@/modules/catalog/components/catalog-browser";
import {
  getCatalogCategories,
  getCatalogProducts,
} from "@/modules/catalog/presentation/catalog-data";

export async function CatalogView() {
  const t = await getTranslations("Catalog");
  const products = getCatalogProducts();
  const categories = getCatalogCategories();

  return (
    <section className="py-16 sm:py-24">
      <Container>
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          {t("eyebrow")}
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{t("title")}</h1>
        <p className="mt-4 max-w-md text-muted-foreground">{t("intro")}</p>

        <CatalogBrowser products={products} categories={categories} />
      </Container>
    </section>
  );
}
