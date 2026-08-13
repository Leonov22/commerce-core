import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prismaUserRepository } from "@/modules/identity/infrastructure/prisma-user-repository";
import { prisma } from "@/modules/identity/infrastructure/prisma-client";

/**
 * Integration tests against the real Neon Postgres database — mirrors
 * `prisma-order-repository.test.ts`'s pattern exactly: collect created ids,
 * delete them in `afterAll`, never touch unrelated rows.
 */
describe("prismaUserRepository", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  function uniqueEmail(label: string): string {
    return `identity-test-${label}-${Date.now()}@example.com`;
  }

  it("creates a user and returns the public shape without a password hash", async () => {
    const email = uniqueEmail("create");
    const user = await prismaUserRepository.create({ email, passwordHash: "fake-hash-for-test" });
    createdUserIds.push(user.id);

    expect(user.email).toBe(email);
    expect(user.id).toBeTruthy();
    expect("passwordHash" in user).toBe(false);
  });

  it("finds a user by email, including the password hash", async () => {
    const email = uniqueEmail("find-by-email");
    const created = await prismaUserRepository.create({
      email,
      passwordHash: "fake-hash-for-test",
    });
    createdUserIds.push(created.id);

    const found = await prismaUserRepository.findByEmail(email);

    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
    expect(found?.passwordHash).toBe("fake-hash-for-test");
  });

  it("returns null from findByEmail for an email that does not exist", async () => {
    const found = await prismaUserRepository.findByEmail(uniqueEmail("nonexistent"));
    expect(found).toBeNull();
  });

  it("finds a user by id, without a password hash", async () => {
    const email = uniqueEmail("find-by-id");
    const created = await prismaUserRepository.create({
      email,
      passwordHash: "fake-hash-for-test",
    });
    createdUserIds.push(created.id);

    const found = await prismaUserRepository.findById(created.id);

    expect(found).not.toBeNull();
    expect(found?.email).toBe(email);
    expect("passwordHash" in (found ?? {})).toBe(false);
  });

  it("returns null from findById for an id that does not exist", async () => {
    const found = await prismaUserRepository.findById("nonexistent-id");
    expect(found).toBeNull();
  });

  it("enforces email uniqueness at the database level", async () => {
    const email = uniqueEmail("duplicate");
    const first = await prismaUserRepository.create({ email, passwordHash: "fake-hash-for-test" });
    createdUserIds.push(first.id);

    await expect(
      prismaUserRepository.create({ email, passwordHash: "another-hash" }),
    ).rejects.toThrow();
  });
});
