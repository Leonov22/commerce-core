import { describe, expect, it } from "vitest";
import { productDetailsHref } from "@/modules/catalog/presentation/product-route";

/**
 * IMP-037: the one thing testable about "does a Featured Product link to
 * the correct destination" without a JSX-rendering setup this project
 * doesn't have — the href-building logic itself, shared by
 * `catalog-grid.tsx` (Shop listing) and `featured-products-section.tsx`
 * (Homepage) so there is exactly one definition of the product details
 * route shape, not two.
 */
describe("productDetailsHref (IMP-037)", () => {
  it("builds the existing /shop/:id product details route for a given product id", () => {
    expect(productDetailsHref("42")).toBe("/shop/42");
  });

  it("uses the product's own id verbatim, never transforming or guessing it", () => {
    expect(productDetailsHref("cljk3x9z10001qzrmn831p8h9")).toBe("/shop/cljk3x9z10001qzrmn831p8h9");
  });
});
