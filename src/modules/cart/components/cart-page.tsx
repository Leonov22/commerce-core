"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCart } from "@/modules/cart/state/cart-context";
import { Container } from "@/shared/components/layout/container";
import { CartItem } from "@/modules/cart/components/cart-item";
import { CartSummary } from "@/modules/cart/components/cart-summary";
import { CartEmptyState } from "@/modules/cart/components/cart-empty-state";
import { useCatalogProducts } from "@/modules/catalog/client";

export function CartPage() {
  const t = useTranslations("Cart");
  const locale = useLocale();
  const { items, increaseQuantity, decreaseQuantity, removeItem } = useCart();
  const { productsById, isLoading } = useCatalogProducts(
    items.map((item) => item.productId),
    locale,
  );

  return (
    <section className="py-16 sm:py-24">
      <Container>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1>

        {items.length === 0 ? (
          <div className="mt-10">
            <CartEmptyState />
          </div>
        ) : (
          <div className="mt-10 grid items-start gap-12 lg:grid-cols-[1fr_320px]">
            <ul>
              {items.map((item) => (
                <CartItem
                  key={item.productId}
                  item={item}
                  product={productsById.get(item.productId)}
                  isLoading={isLoading}
                  onIncrease={() => increaseQuantity(item.productId)}
                  onDecrease={() => decreaseQuantity(item.productId)}
                  onRemove={() => removeItem(item.productId)}
                />
              ))}
            </ul>

            <CartSummary items={items} productsById={productsById} />
          </div>
        )}
      </Container>
    </section>
  );
}
