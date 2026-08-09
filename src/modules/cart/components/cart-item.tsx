import { useTranslations } from "next-intl";
import { Package, X } from "lucide-react";
import { getCatalogProductById } from "@/modules/catalog";
import { QuantityControl } from "@/modules/cart/components/quantity-control";
import type { CartItem as CartItemData } from "@/modules/cart/types/cart";

interface CartItemProps {
  item: CartItemData;
  onIncrease: () => void;
  onDecrease: () => void;
  onRemove: () => void;
}

export function CartItem({ item, onIncrease, onDecrease, onRemove }: CartItemProps) {
  const tCatalog = useTranslations("Catalog");
  const tCart = useTranslations("Cart");
  const product = getCatalogProductById(item.productId);

  // Cart state only stores productId — if the catalog no longer has this
  // product, there is nothing left to render for this line.
  if (!product) {
    return null;
  }

  const name = tCatalog(`products.${product.translationKey}.name`);
  const meta = tCatalog(`products.${product.translationKey}.meta`);
  const price = tCatalog(`products.${product.translationKey}.price`);

  return (
    <li className="flex gap-4 border-b border-border py-6 last:border-b-0">
      <div
        role="img"
        aria-label={tCatalog("imagePlaceholder")}
        className="flex h-24 w-24 flex-none items-center justify-center rounded-lg border border-border bg-muted"
      >
        <Package aria-hidden="true" className="h-8 w-8 text-muted-foreground" strokeWidth={1.25} />
      </div>

      <div className="flex flex-1 flex-col justify-between">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">{name}</p>
            <p className="mt-1 text-sm text-muted-foreground">{meta}</p>
          </div>
          <p className="text-sm font-medium">{price}</p>
        </div>

        <div className="mt-4 flex items-center justify-between gap-4">
          <QuantityControl
            quantity={item.quantity}
            productName={name}
            onIncrease={onIncrease}
            onDecrease={onDecrease}
          />
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <X aria-hidden="true" className="h-4 w-4" />
            {tCart("remove")}
          </button>
        </div>
      </div>
    </li>
  );
}
