import { describe, expect, it } from "vitest";
import { evaluateProductCurrencyProvisioning } from "@/modules/catalog/infrastructure/product-currency-provisioning";

/**
 * Pure-logic tests only — no Prisma, no database. This is deliberate:
 * `prisma/set-product-currency.ts` itself must never be imported by a test
 * (it executes real database operations as a side effect of module
 * evaluation), so the decision logic is tested in isolation here instead.
 * See `product-currency-provisioning.ts`'s own doc comment.
 */
describe("evaluateProductCurrencyProvisioning", () => {
  it("succeeds when the actual count matches the expected count exactly", () => {
    const outcome = evaluateProductCurrencyProvisioning(6, 6);
    expect(outcome.ok).toBe(true);
    expect(outcome.expectedCount).toBe(6);
    expect(outcome.actualCount).toBe(6);
  });

  it("fails on a partial match, and the message says so", () => {
    const outcome = evaluateProductCurrencyProvisioning(6, 4);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("4");
    expect(outcome.message).toContain("partial match");
  });

  it("fails on zero matches, with wording distinct from a partial match", () => {
    const outcome = evaluateProductCurrencyProvisioning(6, 0);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("none of them matched");
    expect(outcome.message).not.toContain("partial match");
  });

  it("fails if the actual count exceeds the expected count too — exact equality is required, not merely 'at least'", () => {
    const outcome = evaluateProductCurrencyProvisioning(6, 7);
    expect(outcome.ok).toBe(false);
  });

  it("mentions the rollback so a caller reading only the message still knows no partial update survives", () => {
    const outcome = evaluateProductCurrencyProvisioning(6, 3);
    expect(outcome.message).toContain("rolled back");
  });

  it("never exposes anything resembling a connection string or secret in its message", () => {
    const outcome = evaluateProductCurrencyProvisioning(6, 0);
    expect(outcome.message).not.toMatch(/postgres(?:ql)?:\/\//i);
    expect(outcome.message).not.toMatch(/DATABASE_URL/i);
  });
});
