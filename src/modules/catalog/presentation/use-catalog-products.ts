"use client";

import { useEffect, useState } from "react";
import type { StorefrontProductSummary } from "@/modules/catalog/presentation/storefront-product";

interface UseCatalogProductsResult {
  productsById: Map<string, StorefrontProductSummary>;
  isLoading: boolean;
}

/**
 * The minimal read-only Catalog transport for Client Components (Cart,
 * Checkout). It never talks to Prisma/PostgreSQL directly — it calls the
 * `/api/catalog/products` route handler, which does. Call this once per
 * container (e.g. the Cart page) with the full set of product IDs it needs,
 * rather than once per row, to avoid N+1 client-side requests.
 */
export function useCatalogProducts(ids: string[], locale: string): UseCatalogProductsResult {
  const idsKey = Array.from(new Set(ids)).sort().join(",");
  const [productsById, setProductsById] = useState<Map<string, StorefrontProductSummary>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState(idsKey.length > 0);

  useEffect(() => {
    if (!idsKey) {
      setProductsById(new Map());
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const params = new URLSearchParams({ ids: idsKey, locale });

    fetch(`/api/catalog/products?${params.toString()}`)
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error("request failed")),
      )
      .then((data: { products: StorefrontProductSummary[] }) => {
        if (cancelled) return;
        setProductsById(new Map(data.products.map((product) => [product.id, product])));
      })
      .catch(() => {
        // Fail gracefully: an empty map means every item renders through
        // the "unavailable" path rather than crashing the page.
        if (!cancelled) {
          setProductsById(new Map());
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [idsKey, locale]);

  return { productsById, isLoading };
}
