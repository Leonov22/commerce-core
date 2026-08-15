import { describe, expect, it } from "vitest";
import { isValidIdempotencyKey } from "@/app/api/orders/validate-idempotency-key";

describe("isValidIdempotencyKey", () => {
  it("accepts a typical UUID-shaped key", () => {
    expect(isValidIdempotencyKey("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true);
  });

  it("accepts a key at exactly the minimum length (16)", () => {
    expect(isValidIdempotencyKey("a".repeat(16))).toBe(true);
  });

  it("accepts a key at exactly the maximum length (128)", () => {
    expect(isValidIdempotencyKey("a".repeat(128))).toBe(true);
  });

  it("rejects a key shorter than the minimum length", () => {
    expect(isValidIdempotencyKey("a".repeat(15))).toBe(false);
  });

  it("rejects a key longer than the maximum length", () => {
    expect(isValidIdempotencyKey("a".repeat(129))).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidIdempotencyKey("")).toBe(false);
  });

  it("rejects whitespace", () => {
    expect(isValidIdempotencyKey("a valid looking key with spaces")).toBe(false);
  });

  it("rejects a key containing characters outside the safe charset", () => {
    expect(isValidIdempotencyKey("<script>alert(1)</script>!!!!!!")).toBe(false);
  });

  it("rejects a key that is only punctuation from outside the allow-list", () => {
    expect(isValidIdempotencyKey("!@#$%^&*()!@#$%^&*()!@#$%^&*()!@")).toBe(false);
  });

  it("accepts underscores and hyphens", () => {
    expect(isValidIdempotencyKey("client_generated-key_value-123")).toBe(true);
  });
});
