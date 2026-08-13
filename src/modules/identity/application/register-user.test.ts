import "dotenv/config";
import { describe, expect, it } from "vitest";
import { registerUser } from "@/modules/identity/application/register-user";
import type {
  UserRepository,
  NewUserInput,
  UserRecord,
} from "@/modules/identity/repositories/user-repository";
import type { User } from "@/modules/identity/domain/user";

/**
 * Pure application-layer tests: `UserRepository` is injected, so a fake is
 * used and nothing is actually persisted — mirrors
 * `checkout-order.test.ts`'s `makeFakeRepository()` pattern. Real
 * Prisma-backed persistence is covered separately in
 * `prisma-user-repository.test.ts`.
 */
function makeFakeRepository(seed: UserRecord[] = []): {
  repository: UserRepository;
  createCalls: NewUserInput[];
} {
  const users = [...seed];
  const createCalls: NewUserInput[] = [];
  const repository: UserRepository = {
    async create(input) {
      createCalls.push(input);
      const now = new Date();
      const user: User = {
        id: `fake-user-${users.length + 1}`,
        email: input.email,
        createdAt: now,
        updatedAt: now,
      };
      users.push({ ...user, passwordHash: input.passwordHash });
      return user;
    },
    async findByEmail(email) {
      return users.find((user) => user.email === email) ?? null;
    },
    async findById(id) {
      return users.find((user) => user.id === id) ?? null;
    },
  };
  return { repository, createCalls };
}

describe("registerUser", () => {
  it("creates a user from a valid email and password", async () => {
    const { repository, createCalls } = makeFakeRepository();
    const result = await registerUser(repository, {
      email: "Jane@Example.com",
      password: "correct-horse",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Normalized before persistence.
    expect(result.user.email).toBe("jane@example.com");
    expect(createCalls).toHaveLength(1);
  });

  it("never stores the plaintext password", async () => {
    const { repository, createCalls } = makeFakeRepository();
    await registerUser(repository, { email: "jane@example.com", password: "correct-horse" });

    expect(createCalls[0]?.passwordHash).toBeDefined();
    expect(createCalls[0]?.passwordHash).not.toBe("correct-horse");
    expect(createCalls[0]?.passwordHash).not.toContain("correct-horse");
  });

  it("fails with INVALID_EMAIL for a malformed email, and never calls the repository", async () => {
    const { repository, createCalls } = makeFakeRepository();
    const result = await registerUser(repository, {
      email: "not-an-email",
      password: "correct-horse",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("INVALID_EMAIL");
    expect(createCalls).toHaveLength(0);
  });

  it("fails with WEAK_PASSWORD for a too-short password, and never calls the repository", async () => {
    const { repository, createCalls } = makeFakeRepository();
    const result = await registerUser(repository, { email: "jane@example.com", password: "short" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("WEAK_PASSWORD");
    expect(createCalls).toHaveLength(0);
  });

  it("fails with EMAIL_ALREADY_REGISTERED for a duplicate email, and never calls the repository", async () => {
    const now = new Date();
    const { repository, createCalls } = makeFakeRepository([
      {
        id: "existing-user",
        email: "jane@example.com",
        passwordHash: "irrelevant",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const result = await registerUser(repository, {
      email: "Jane@Example.com",
      password: "correct-horse",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("EMAIL_ALREADY_REGISTERED");
    expect(createCalls).toHaveLength(0);
  });
});
