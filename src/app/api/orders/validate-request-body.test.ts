import { describe, expect, it } from "vitest";
import { isPlainRequestObject } from "@/app/api/orders/validate-request-body";

/**
 * Covers the exact set of non-object JSON top-level values `request.json()`
 * can hand back without throwing (`null`, arrays, strings, numbers,
 * booleans) — see the doc comment on `isPlainRequestObject` for why this is
 * tested in isolation rather than through `POST` itself.
 */
describe("isPlainRequestObject", () => {
  it("rejects null", () => {
    expect(isPlainRequestObject(null)).toBe(false);
  });

  it("rejects an array", () => {
    expect(isPlainRequestObject([])).toBe(false);
    expect(isPlainRequestObject([1, 2, 3])).toBe(false);
  });

  it("rejects a string", () => {
    expect(isPlainRequestObject("hello")).toBe(false);
  });

  it("rejects a number", () => {
    expect(isPlainRequestObject(123)).toBe(false);
  });

  it("rejects booleans", () => {
    expect(isPlainRequestObject(true)).toBe(false);
    expect(isPlainRequestObject(false)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isPlainRequestObject(undefined)).toBe(false);
  });

  it("accepts a plain object", () => {
    expect(isPlainRequestObject({})).toBe(true);
    expect(isPlainRequestObject({ customer: {}, items: [] })).toBe(true);
  });
});
