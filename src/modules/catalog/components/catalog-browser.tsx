"use client";

import { useMemo, useState } from "react";
import { CategoryFilter } from "@/modules/catalog/components/category-filter";
import { CatalogGrid } from "@/modules/catalog/components/catalog-grid";
import type { CatalogCategoryKey, CatalogProduct } from "@/modules/catalog/types/catalog-product";

type ActiveCategory = CatalogCategoryKey | "all";

interface CatalogBrowserProps {
  products: CatalogProduct[];
  categories: CatalogCategoryKey[];
}

export function CatalogBrowser({ products, categories }: CatalogBrowserProps) {
  const [activeCategory, setActiveCategory] = useState<ActiveCategory>("all");

  const filteredProducts = useMemo(() => {
    if (activeCategory === "all") {
      return products;
    }
    return products.filter((product) => product.categoryKey === activeCategory);
  }, [products, activeCategory]);

  return (
    <div className="mt-10 flex flex-col gap-10">
      <CategoryFilter
        categories={categories}
        active={activeCategory}
        onSelect={setActiveCategory}
      />
      <CatalogGrid products={filteredProducts} />
    </div>
  );
}
