import { describe, expect, it } from "vitest";
import {
  resolveProtectedPageRedirect,
  resolveGuestOnlyPageRedirect,
  resolveAdminPageRedirect,
} from "@/modules/identity/application/account-access";
import type { User } from "@/modules/identity/domain/user";

const now = new Date();
const user: User = {
  id: "user-1",
  email: "jane@example.com",
  role: "CUSTOMER",
  createdAt: now,
  updatedAt: now,
};
const admin: User = {
  id: "admin-1",
  email: "admin@example.com",
  role: "ADMIN",
  createdAt: now,
  updatedAt: now,
};

describe("resolveProtectedPageRedirect", () => {
  it("sends an unauthenticated visitor to /account/login", () => {
    expect(resolveProtectedPageRedirect(null)).toBe("/account/login");
  });

  it("lets an authenticated user through", () => {
    expect(resolveProtectedPageRedirect(user)).toBeNull();
  });
});

describe("resolveGuestOnlyPageRedirect", () => {
  it("lets a guest through to login/register", () => {
    expect(resolveGuestOnlyPageRedirect(null)).toBeNull();
  });

  it("sends an already-authenticated user to /account", () => {
    expect(resolveGuestOnlyPageRedirect(user)).toBe("/account");
  });
});

describe("resolveAdminPageRedirect (IMP-043)", () => {
  it("sends an unauthenticated visitor to sign in", () => {
    expect(resolveAdminPageRedirect(null)).toBe("/account/login");
  });

  it("sends an authenticated non-admin customer home, not to login", () => {
    expect(resolveAdminPageRedirect(user)).toBe("/");
  });

  it("lets an authenticated admin through", () => {
    expect(resolveAdminPageRedirect(admin)).toBeNull();
  });
});
