import { describe, expect, it } from "vitest";
import { resolveSafeCallbackUrl } from "@/modules/identity/application/callback-url";

describe("resolveSafeCallbackUrl", () => {
  it("accepts a plain internal path", () => {
    expect(resolveSafeCallbackUrl("/checkout")).toBe("/checkout");
  });

  it("accepts an internal path with a query string", () => {
    expect(resolveSafeCallbackUrl("/account/orders?cursor=abc")).toBe("/account/orders?cursor=abc");
  });

  it("falls back to /account when missing", () => {
    expect(resolveSafeCallbackUrl(undefined)).toBe("/account");
    expect(resolveSafeCallbackUrl(null)).toBe("/account");
  });

  it("falls back to /account for an empty string", () => {
    expect(resolveSafeCallbackUrl("")).toBe("/account");
  });

  it("rejects an absolute external URL", () => {
    expect(resolveSafeCallbackUrl("https://evil.example")).toBe("/account");
    expect(resolveSafeCallbackUrl("http://evil.example/checkout")).toBe("/account");
  });

  it("rejects a protocol-relative URL", () => {
    expect(resolveSafeCallbackUrl("//evil.example")).toBe("/account");
    expect(resolveSafeCallbackUrl("//evil.example/checkout")).toBe("/account");
  });

  it("rejects backslash-based variants", () => {
    expect(resolveSafeCallbackUrl("/\\evil.example")).toBe("/account");
    expect(resolveSafeCallbackUrl("\\\\evil.example")).toBe("/account");
    expect(resolveSafeCallbackUrl("/checkout\\evil.example")).toBe("/account");
  });

  it("rejects a javascript: scheme smuggled before the path", () => {
    expect(resolveSafeCallbackUrl("/javascript:alert(1)")).toBe("/account");
  });

  it("rejects a value with no leading slash", () => {
    expect(resolveSafeCallbackUrl("checkout")).toBe("/account");
    expect(resolveSafeCallbackUrl("evil.example/checkout")).toBe("/account");
  });

  it("rejects a bare scheme with no path at all", () => {
    expect(resolveSafeCallbackUrl("javascript:alert(1)")).toBe("/account");
  });

  it("accepts the root path", () => {
    expect(resolveSafeCallbackUrl("/")).toBe("/");
  });
});
