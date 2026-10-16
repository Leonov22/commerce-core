import Image from "next/image";
import { Package } from "lucide-react";
import { Link } from "@/core/i18n/navigation";

interface ProductCardProps {
  name: string;
  meta: string;
  price: string;
  badge?: string;
  imageLabel: string;
  /** IMP-046: the product's uploaded image, if any. `null`/omitted falls back to the existing placeholder. */
  imageUrl?: string | null;
  imageAlt?: string | null;
  href?: string;
}

export function ProductCard({
  name,
  meta,
  price,
  badge,
  imageLabel,
  imageUrl,
  imageAlt,
  href,
}: ProductCardProps) {
  const content = (
    <>
      <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-muted transition-colors group-hover:border-foreground/30">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={imageAlt ?? name}
            fill
            sizes="(min-width: 1024px) 33vw, 50vw"
            className="object-cover"
          />
        ) : (
          <div
            role="img"
            aria-label={imageLabel}
            className="flex h-full w-full items-center justify-center"
          >
            <Package
              aria-hidden="true"
              className="h-10 w-10 text-muted-foreground"
              strokeWidth={1.25}
            />
          </div>
        )}
        {badge ? (
          <span className="absolute left-3 top-3 rounded-full bg-background px-2.5 py-1 text-xs font-medium">
            {badge}
          </span>
        ) : null}
      </div>

      <h3 className="mt-4 text-sm font-medium">{name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{meta}</p>
      <p className="mt-2 text-sm font-medium">{price}</p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="group block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {content}
      </Link>
    );
  }

  return <article className="group">{content}</article>;
}
