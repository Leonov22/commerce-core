"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useCart } from "@/modules/cart/state/cart-context";
import { Button } from "@/shared/components/ui/button";

interface AddToCartButtonProps {
  productId: string;
}

export function AddToCartButton({ productId }: AddToCartButtonProps) {
  const t = useTranslations("ProductDetails");
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);

  return (
    <div>
      <Button
        onClick={() => {
          addItem(productId);
          setAdded(true);
        }}
        className="w-full sm:w-auto"
      >
        {t("addToCart.button")}
      </Button>
      <p role="status" aria-live="polite" className="mt-2 text-xs text-muted-foreground">
        {added ? t("addToCart.addedMessage") : " "}
      </p>
    </div>
  );
}
