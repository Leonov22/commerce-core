/**
 * Formats integer minor-unit pricing for display. Pure, framework-agnostic
 * (uses only the standard `Intl` API), so it works identically whether
 * called from a Server Component or a Client Component.
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
