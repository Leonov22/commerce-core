/**
 * Formats integer minor-unit pricing for display. Pure, framework-agnostic
 * (uses only the standard `Intl` API), so it works identically whether
 * called from a Server Component or a Client Component.
 *
 * Lives here (not inside Catalog) because it is generic money-formatting
 * logic with no Catalog domain concept in it (no Product/Category, just
 * primitives) — genuinely shared presentation logic, not business logic
 * any one module owns. Catalog re-exports it for its own existing
 * consumers (see `catalog/presentation/format-price.ts`); Order and any
 * other module needing to format a stored money amount should import it
 * from here directly instead of reaching into Catalog for it.
 */
export function formatProductPrice(
  priceAmountMinor: number,
  currency: string,
  locale: string,
): string {
  const isWholeAmount = priceAmountMinor % 100 === 0;

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: isWholeAmount ? 0 : 2,
    maximumFractionDigits: isWholeAmount ? 0 : 2,
  }).format(priceAmountMinor / 100);
}
