import { useTranslations } from "next-intl";
import { cn } from "@/core/lib/utils";
import type { CatalogCategoryKey } from "@/modules/catalog/types/catalog-product";

type ActiveCategory = CatalogCategoryKey | "all";

interface CategoryFilterProps {
  categories: CatalogCategoryKey[];
  active: ActiveCategory;
  onSelect: (category: ActiveCategory) => void;
}

export function CategoryFilter({ categories, active, onSelect }: CategoryFilterProps) {
  const t = useTranslations("Catalog");

  const options: ActiveCategory[] = ["all", ...categories];

  return (
    <div role="group" aria-label={t("filters.categoryLabel")} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isActive = option === active;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(option)}
            className={cn(
              "rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              isActive
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-transparent text-foreground hover:bg-accent",
            )}
          >
            {option === "all" ? t("filters.all") : t(`categories.${option}`)}
          </button>
        );
      })}
    </div>
  );
}
