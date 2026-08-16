import { describe, expect, it } from "vitest";
import { evaluateFeaturedProvisioning } from "@/modules/catalog/infrastructure/featured-provisioning";

/**
 * CR-037-FIX-01: pure-logic tests only — no Prisma, no database. This is
 * deliberate: `prisma/set-featured-products.ts` itself must never be
 * imported by a test (it executes real database operations as a
 * side effect of module evaluation), so the decision logic is tested in
 * isolation here instead. See `featured-provisioning.ts`'s own doc
 * comment.
 */
describe("evaluateFeaturedProvisioning (CR-037-FIX-01)", () => {
  it("succeeds when the actual count matches the expected count exactly", () => {
    const outcome = evaluateFeaturedProvisioning(4, 4);
    expect(outcome.ok).toBe(true);
    expect(outcome.expectedCount).toBe(4);
    expect(outcome.actualCount).toBe(4);
  });

  it("fails on a partial match, and the message says so", () => {
    const outcome = evaluateFeaturedProvisioning(4, 2);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("2");
    expect(outcome.message).toContain("partial match");
  });

  it("fails on zero matches, with wording distinct from a partial match", () => {
    const outcome = evaluateFeaturedProvisioning(4, 0);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("none of them matched");
    expect(outcome.message).not.toContain("partial match");
  });

  it("fails if the actual count exceeds the expected count too — exact equality is required, not merely 'at least'", () => {
    const outcome = evaluateFeaturedProvisioning(4, 5);
    expect(outcome.ok).toBe(false);
  });

  it("never exposes anything resembling a connection string or secret in its message", () => {
    const outcome = evaluateFeaturedProvisioning(4, 0);
    expect(outcome.message).not.toMatch(/postgres(?:ql)?:\/\//i);
    expect(outcome.message).not.toMatch(/DATABASE_URL/i);
  });
});
