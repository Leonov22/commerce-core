import { describe, expect, it } from "vitest";
import {
  isAdminPromotionConfirmed,
  ADMIN_PROMOTION_CONFIRMATION_ENV_VAR,
  ADMIN_PROMOTION_CONFIRMATION_VALUE,
} from "@/modules/identity/infrastructure/admin-promotion-guard";

describe("isAdminPromotionConfirmed (IMP-044)", () => {
  it("refuses when the confirmation variable is unset", () => {
    expect(isAdminPromotionConfirmed({})).toBe(false);
  });

  it("refuses when the confirmation variable has any other value", () => {
    expect(isAdminPromotionConfirmed({ [ADMIN_PROMOTION_CONFIRMATION_ENV_VAR]: "yes" })).toBe(
      false,
    );
  });

  it("merely having DATABASE_URL set is never sufficient on its own", () => {
    expect(
      isAdminPromotionConfirmed({
        DATABASE_URL: "postgresql://user:password@localhost:5432/commerce_core",
      }),
    ).toBe(false);
  });

  it("confirms only with the exact, deliberate confirmation value", () => {
    expect(
      isAdminPromotionConfirmed({
        [ADMIN_PROMOTION_CONFIRMATION_ENV_VAR]: ADMIN_PROMOTION_CONFIRMATION_VALUE,
      }),
    ).toBe(true);
  });

  it("is case-sensitive — a differently-cased otherwise-correct value is refused", () => {
    expect(
      isAdminPromotionConfirmed({
        [ADMIN_PROMOTION_CONFIRMATION_ENV_VAR]: ADMIN_PROMOTION_CONFIRMATION_VALUE.toUpperCase(),
      }),
    ).toBe(false);
  });
});
