import { useTranslations } from "next-intl";
import { cn } from "@/core/lib/utils";
import type { Category } from "@/modules/catalog";

type ActiveCategory = string | "all";

interface CategoryFilterProps {
  categories: Category[];
  active: ActiveCategory;
  onSelect: (category: ActiveCategory) => void;
}

export function CategoryFilter({ categories, active, onSelect }: CategoryFilterProps) {
  const t = useTranslations("Catalog");

  return (
    <div role="group" aria-label={t("filters.categoryLabel")} className="flex flex-wrap gap-2">
      <button
        type="button"
        aria-pressed={active === "all"}
        onClick={() => onSelect("all")}
        className={cn(
          "rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          active === "all"
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-transparent text-foreground hover:bg-accent",
        )}
      >
        {t("filters.all")}
      </button>
      {categories.map((category) => {
        const isActive = category.slug === active;
        return (
          <button
            key={category.slug}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(category.slug)}
            className={cn(
              "rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              isActive
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-transparent text-foreground hover:bg-accent",
            )}
          >
            {category.translation.name}
          </button>
        );
      })}
    </div>
  );
}
