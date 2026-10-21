import { describe, expect, it } from "vitest";
import { getUserById } from "@/modules/identity/application/user-lookup";
import type { UserRepository } from "@/modules/identity/repositories/user-repository";
import type { User } from "@/modules/identity/domain/user";

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
const admin: User = {
  id: "admin-1",
  email: "admin@example.com",
  role: "ADMIN",
  createdAt: now,
  updatedAt: now,
};

describe("getUserById", () => {
  it("returns the user for a known id", async () => {
    const repository = makeFakeRepository([admin]);
    const result = await getUserById(repository, "admin-1");
    expect(result).toEqual(admin);
  });

  it("returns null for an unknown id, never throwing", async () => {
    const repository = makeFakeRepository([admin]);
    const result = await getUserById(repository, "does-not-exist");
    expect(result).toBeNull();
  });
});
