import "dotenv/config";
import { describe, expect, it } from "vitest";
import { verifyCredentials } from "@/modules/identity/application/verify-credentials";
import { hashPassword } from "@/modules/identity/application/password";
import type { UserRepository, UserRecord } from "@/modules/identity/repositories/user-repository";
import type { User } from "@/modules/identity/domain/user";

function makeFakeRepository(seed: UserRecord[]): UserRepository {
  return {
    async create(input) {
      const now = new Date();
      const user: User = { id: "new-user", email: input.email, createdAt: now, updatedAt: now };
      return user;
    },
    async findByEmail(email) {
      return seed.find((user) => user.email === email) ?? null;
    },
    async findById(id) {
      return seed.find((user) => user.id === id) ?? null;
    },
  };
}

describe("verifyCredentials", () => {
  it("succeeds for a correct email and password, and never exposes the password hash", async () => {
    const passwordHash = await hashPassword("correct-horse");
    const now = new Date();
    const repository = makeFakeRepository([
      { id: "user-1", email: "jane@example.com", passwordHash, createdAt: now, updatedAt: now },
    ]);

    const result = await verifyCredentials(repository, {
      email: "Jane@Example.com",
      password: "correct-horse",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.id).toBe("user-1");
    expect(result.user.email).toBe("jane@example.com");
    expect("passwordHash" in result.user).toBe(false);
  });

  it("fails with INVALID_CREDENTIALS for a wrong password", async () => {
    const passwordHash = await hashPassword("correct-horse");
    const now = new Date();
    const repository = makeFakeRepository([
      { id: "user-1", email: "jane@example.com", passwordHash, createdAt: now, updatedAt: now },
    ]);

    const result = await verifyCredentials(repository, {
      email: "jane@example.com",
      password: "wrong-password",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("INVALID_CREDENTIALS");
  });

  it("fails with INVALID_CREDENTIALS for an unregistered email, using the same error as a wrong password", async () => {
    const repository = makeFakeRepository([]);

    const result = await verifyCredentials(repository, {
      email: "nobody@example.com",
      password: "whatever-password",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("INVALID_CREDENTIALS");
  });
});
