import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

interface QuantityControlProps {
  quantity: number;
  onIncrease: () => void;
  onDecrease: () => void;
}

export function QuantityControl({ quantity, onIncrease, onDecrease }: QuantityControlProps) {
  const t = useTranslations("Cart");

  return (
    <div className="inline-flex items-center gap-3 rounded-md border border-border">
      <button
        type="button"
        onClick={onDecrease}
        aria-label={t("decreaseQuantity")}
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Minus aria-hidden="true" className="h-4 w-4" />
      </button>
      <span aria-live="polite" className="w-4 text-center text-sm font-medium">
        {quantity}
      </span>
      <button
        type="button"
        onClick={onIncrease}
        aria-label={t("increaseQuantity")}
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}
