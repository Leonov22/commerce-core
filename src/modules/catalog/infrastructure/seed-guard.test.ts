import { describe, expect, it } from "vitest";
import {
  isBroadSeedConfirmed,
  SEED_CONFIRMATION_ENV_VAR,
  SEED_CONFIRMATION_VALUE,
} from "@/modules/catalog/infrastructure/seed-guard";

describe("isBroadSeedConfirmed (CR-037-01-SEED)", () => {
  it("refuses when the confirmation variable is unset", () => {
    expect(isBroadSeedConfirmed({})).toBe(false);
  });

  it("refuses when the confirmation variable has any other value", () => {
    expect(isBroadSeedConfirmed({ [SEED_CONFIRMATION_ENV_VAR]: "yes" })).toBe(false);
    expect(isBroadSeedConfirmed({ [SEED_CONFIRMATION_ENV_VAR]: "true" })).toBe(false);
  });

  it("this gate does not trust NODE_ENV — 'development' alone is never sufficient", () => {
    expect(isBroadSeedConfirmed({ NODE_ENV: "development" })).toBe(false);
    expect(isBroadSeedConfirmed({ NODE_ENV: "test" })).toBe(false);
  });

  it("confirms only with the exact, deliberate confirmation value", () => {
    expect(isBroadSeedConfirmed({ [SEED_CONFIRMATION_ENV_VAR]: SEED_CONFIRMATION_VALUE })).toBe(
      true,
    );
  });
});
