import { describe, expect, it } from "vitest";
import {
  isProductCurrencyMigrationConfirmed,
  PRODUCT_CURRENCY_MIGRATION_CONFIRMATION_ENV_VAR,
  PRODUCT_CURRENCY_MIGRATION_CONFIRMATION_VALUE,
} from "@/modules/catalog/infrastructure/product-currency-migration-guard";

describe("isProductCurrencyMigrationConfirmed (PR2-F01)", () => {
  it("refuses when the confirmation variable is unset", () => {
    expect(isProductCurrencyMigrationConfirmed({})).toBe(false);
  });

  it("refuses when the confirmation variable has any other value", () => {
    expect(
      isProductCurrencyMigrationConfirmed({
        [PRODUCT_CURRENCY_MIGRATION_CONFIRMATION_ENV_VAR]: "yes",
      }),
    ).toBe(false);
    expect(
      isProductCurrencyMigrationConfirmed({
        [PRODUCT_CURRENCY_MIGRATION_CONFIRMATION_ENV_VAR]: "true",
      }),
    ).toBe(false);
  });

  it("this gate does not trust NODE_ENV — 'development' alone is never sufficient", () => {
    expect(isProductCurrencyMigrationConfirmed({ NODE_ENV: "development" })).toBe(false);
    expect(isProductCurrencyMigrationConfirmed({ NODE_ENV: "production" })).toBe(false);
  });

  it("merely having DATABASE_URL set is never sufficient on its own", () => {
    expect(
      isProductCurrencyMigrationConfirmed({
        DATABASE_URL: "postgresql://user:password@localhost:5432/commerce_core",
      }),
    ).toBe(false);
  });

  it("a mismatched confirmation value is refused even when DATABASE_URL is also set", () => {
    expect(
      isProductCurrencyMigrationConfirmed({
        DATABASE_URL: "postgresql://user:password@localhost:5432/commerce_core",
        [PRODUCT_CURRENCY_MIGRATION_CONFIRMATION_ENV_VAR]: "yes",
      }),
    ).toBe(false);
  });

  it("confirms only with the exact, deliberate confirmation value", () => {
    expect(
      isProductCurrencyMigrationConfirmed({
        [PRODUCT_CURRENCY_MIGRATION_CONFIRMATION_ENV_VAR]:
          PRODUCT_CURRENCY_MIGRATION_CONFIRMATION_VALUE,
      }),
    ).toBe(true);
  });

  it("is case-sensitive — a differently-cased otherwise-correct value is refused", () => {
    expect(
      isProductCurrencyMigrationConfirmed({
        [PRODUCT_CURRENCY_MIGRATION_CONFIRMATION_ENV_VAR]:
          PRODUCT_CURRENCY_MIGRATION_CONFIRMATION_VALUE.toUpperCase(),
      }),
    ).toBe(false);
  });
});
