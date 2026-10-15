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

  it("rejects a value containing an embedded tab character", () => {
    expect(resolveSafeCallbackUrl("/\t/evil.example")).toBe("/account");
  });

  it("rejects a value containing an embedded line feed", () => {
    expect(resolveSafeCallbackUrl("/\n/evil.example")).toBe("/account");
  });

  it("rejects a value containing an embedded carriage return", () => {
    expect(resolveSafeCallbackUrl("/\r/evil.example")).toBe("/account");
  });

  it("rejects the reported protocol-relative bypass attempt — a leading-slash-then-tab value that would resolve to '//evil.example' if the tab were stripped during URL parsing", () => {
    expect(resolveSafeCallbackUrl("/\t/evil.example")).not.toBe("/\t/evil.example");
    expect(resolveSafeCallbackUrl("/\t/evil.example")).toBe("/account");
  });

  it("rejects a tab/newline/carriage-return anywhere in the value, not only at the start", () => {
    expect(resolveSafeCallbackUrl("/checkout\t/evil.example")).toBe("/account");
    expect(resolveSafeCallbackUrl("/checkout\n/evil.example")).toBe("/account");
    expect(resolveSafeCallbackUrl("/checkout\r/evil.example")).toBe("/account");
  });

  it("still accepts a legitimate internal path containing none of these characters", () => {
    expect(resolveSafeCallbackUrl("/account/orders/cmv9lm7mk000d08jn1zj5goqd")).toBe(
      "/account/orders/cmv9lm7mk000d08jn1zj5goqd",
    );
  });
});
