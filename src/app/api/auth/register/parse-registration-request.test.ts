import { describe, expect, it } from "vitest";
import { parseRegistrationRequestBody } from "@/app/api/auth/register/parse-registration-request";

/**
 * Covers the request-shape and password-confirmation checks specific to
 * this route. Email format, password strength, and duplicate-email
 * handling are Identity's own rules and are already covered by
 * `identity/application/register-user.test.ts` — not re-tested here, to
 * avoid duplicating that coverage at two layers.
 */
describe("parseRegistrationRequestBody", () => {
  it("accepts a well-formed body with matching passwords", () => {
    const result = parseRegistrationRequestBody({
      email: "jane@example.com",
      password: "correct-horse",
      confirmPassword: "correct-horse",
    });

    expect(result).toEqual({ ok: true, email: "jane@example.com", password: "correct-horse" });
  });

  it("rejects mismatched password confirmation", () => {
    const result = parseRegistrationRequestBody({
      email: "jane@example.com",
      password: "correct-horse",
      confirmPassword: "different-password",
    });

    expect(result).toEqual({ ok: false, error: "PASSWORD_MISMATCH" });
  });

  it("rejects a non-object body", () => {
    expect(parseRegistrationRequestBody(null)).toEqual({ ok: false, error: "INVALID_REQUEST" });
    expect(parseRegistrationRequestBody([])).toEqual({ ok: false, error: "INVALID_REQUEST" });
    expect(parseRegistrationRequestBody("hello")).toEqual({ ok: false, error: "INVALID_REQUEST" });
    expect(parseRegistrationRequestBody(123)).toEqual({ ok: false, error: "INVALID_REQUEST" });
    expect(parseRegistrationRequestBody(undefined)).toEqual({
      ok: false,
      error: "INVALID_REQUEST",
    });
  });

  it("rejects a body missing required fields", () => {
    expect(parseRegistrationRequestBody({ email: "jane@example.com" })).toEqual({
      ok: false,
      error: "INVALID_REQUEST",
    });
    expect(
      parseRegistrationRequestBody({ email: "jane@example.com", password: "correct-horse" }),
    ).toEqual({ ok: false, error: "INVALID_REQUEST" });
  });

  it("rejects non-string field types", () => {
    const result = parseRegistrationRequestBody({
      email: "jane@example.com",
      password: 12345678,
      confirmPassword: 12345678,
    });

    expect(result).toEqual({ ok: false, error: "INVALID_REQUEST" });
  });

  it("rejects an empty email or password", () => {
    expect(
      parseRegistrationRequestBody({
        email: "",
        password: "correct-horse",
        confirmPassword: "correct-horse",
      }),
    ).toEqual({ ok: false, error: "INVALID_REQUEST" });
    expect(
      parseRegistrationRequestBody({
        email: "jane@example.com",
        password: "",
        confirmPassword: "",
      }),
    ).toEqual({ ok: false, error: "INVALID_REQUEST" });
  });

  it("rejects an oversized email or password", () => {
    const hugeEmail = `${"a".repeat(260)}@example.com`;
    const hugePassword = "a".repeat(201);

    expect(
      parseRegistrationRequestBody({
        email: hugeEmail,
        password: "correct-horse",
        confirmPassword: "correct-horse",
      }),
    ).toEqual({ ok: false, error: "INVALID_REQUEST" });
    expect(
      parseRegistrationRequestBody({
        email: "jane@example.com",
        password: hugePassword,
        confirmPassword: hugePassword,
      }),
    ).toEqual({ ok: false, error: "INVALID_REQUEST" });
  });
});
