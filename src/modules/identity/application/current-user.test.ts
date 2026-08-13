import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import {
  getCurrentUser,
  requireAuthenticatedUser,
  UnauthenticatedError,
} from "@/modules/identity/application/current-user";
import type { UserRepository } from "@/modules/identity/repositories/user-repository";
import type { User } from "@/modules/identity/domain/user";

/**
 * `auth()` is Identity's one non-injectable external boundary — mocked the
 * same way `checkout-order.test.ts` mocks Catalog's `getProductsByIds`:
 * `vi.hoisted` for a shared, safely-hoistable mock function, `vi.mock` to
 * replace the module for this file only (hoisted above the imports above,
 * so the statically-imported `current-user.ts` resolves against the mock).
 */
const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/core/auth/auth", () => ({ auth: mockAuth }));

function makeFakeRepository(users: User[]): UserRepository {
  return {
    async create() {
      throw new Error("not used by these tests");
    },
    async findByEmail() {
      throw new Error("not used by these tests");
    },
    async findById(id) {
      return users.find((user) => user.id === id) ?? null;
    },
  };
}

const now = new Date();
const realUser: User = { id: "user-1", email: "jane@example.com", createdAt: now, updatedAt: now };

describe("getCurrentUser", () => {
  it("resolves the repository user matching the session's user id", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "user-1" } });
    const repository = makeFakeRepository([realUser]);

    const user = await getCurrentUser(repository);

    expect(user).toEqual(realUser);
  });

  it("returns null when there is no session", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const repository = makeFakeRepository([realUser]);

    const user = await getCurrentUser(repository);

    expect(user).toBeNull();
  });

  it("returns null when the session has no user id", async () => {
    mockAuth.mockResolvedValueOnce({ user: {} });
    const repository = makeFakeRepository([realUser]);

    const user = await getCurrentUser(repository);

    expect(user).toBeNull();
  });

  it("returns null when the session's user id does not resolve to a real user", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "deleted-user" } });
    const repository = makeFakeRepository([realUser]);

    const user = await getCurrentUser(repository);

    expect(user).toBeNull();
  });
});

describe("requireAuthenticatedUser", () => {
  it("returns the user for an authenticated session", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "user-1" } });
    const repository = makeFakeRepository([realUser]);

    const user = await requireAuthenticatedUser(repository);

    expect(user).toEqual(realUser);
  });

  it("throws UnauthenticatedError when there is no session", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const repository = makeFakeRepository([realUser]);

    await expect(requireAuthenticatedUser(repository)).rejects.toThrow(UnauthenticatedError);
  });
});
