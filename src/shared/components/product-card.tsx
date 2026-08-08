import { Package } from "lucide-react";

interface ProductCardProps {
  name: string;
  meta: string;
  price: string;
  badge?: string;
  imageLabel: string;
}

export function ProductCard({ name, meta, price, badge, imageLabel }: ProductCardProps) {
  return (
    <article className="group">
      <div
        role="img"
        aria-label={imageLabel}
        className="relative flex aspect-square items-center justify-center rounded-lg border border-border bg-muted"
      >
        <Package
          aria-hidden="true"
          className="h-10 w-10 text-muted-foreground"
          strokeWidth={1.25}
        />
        {badge ? (
          <span className="absolute left-3 top-3 rounded-full bg-background px-2.5 py-1 text-xs font-medium">
            {badge}
          </span>
        ) : null}
      </div>

      <h3 className="mt-4 text-sm font-medium">{name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{meta}</p>
      <p className="mt-2 text-sm font-medium">{price}</p>
    </article>
  );
}
