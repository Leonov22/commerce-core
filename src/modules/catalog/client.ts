/**
 * Client-safe subset of the catalog module's public API.
 *
 * `@/modules/catalog` (the main entry point) is guarded with `server-only`
 * because it touches Prisma. A Client Component cannot import anything from
 * that file at all — not even a re-export — so the one piece Client
 * Components legitimately need (read-only product resolution via the HTTP
 * transport, plus price formatting) is exposed here instead. This is the
 * only sanctioned way Cart/Checkout may reach catalog data; everything else
 * still goes through `@/modules/catalog`.
 */
export { useCatalogProducts } from "@/modules/catalog/presentation/use-catalog-products";
export { formatProductPrice } from "@/modules/catalog/presentation/format-price";
export type { StorefrontProductSummary } from "@/modules/catalog/presentation/storefront-product";
