"use client";

import { useMemo, useState } from "react";
import { CategoryFilter } from "@/modules/catalog/components/category-filter";
import { CatalogGrid } from "@/modules/catalog/components/catalog-grid";
import type { Product, Category } from "@/modules/catalog";

type ActiveCategory = string | "all";

interface CatalogBrowserProps {
  products: Product[];
  categories: Category[];
}

export function CatalogBrowser({ products, categories }: CatalogBrowserProps) {
  const [activeCategory, setActiveCategory] = useState<ActiveCategory>("all");

  const filteredProducts = useMemo(() => {
    if (activeCategory === "all") {
      return products;
    }
    return products.filter((product) => product.categorySlug === activeCategory);
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
