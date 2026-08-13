/**
 * Re-exported from the genuinely shared location (CR029-02): this is pure
 * money formatting, not Catalog domain logic, so the implementation now
 * lives at `@/shared/utils/format-price`. Kept as a re-export here, rather
 * than deleted, so Catalog's own existing consumers (`catalog-grid.tsx`,
 * `product-details-view.tsx`) and `catalog/client.ts`'s public export keep
 * working unchanged — Cart/Checkout's existing
 * `import { formatProductPrice } from "@/modules/catalog/client"` is
 * untouched by this move.
 */
export { formatProductPrice } from "@/shared/utils/format-price";
