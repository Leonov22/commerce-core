/**
 * The single place the product details route (`/shop/${id}`) is spelled
 * out. IMP-037: previously only `catalog-grid.tsx` built this string
 * inline; the Homepage's Featured Products section now needs the
 * identical one, so it's extracted here instead of duplicated a second
 * time. `id`, not `slug`, matches the existing `[shop]/[product]` route's
 * own resolution (`getProductById`) — this does not introduce a new
 * identity convention, only names the one already in use.
 */
export function productDetailsHref(productId: string): string {
  return `/shop/${productId}`;
}
