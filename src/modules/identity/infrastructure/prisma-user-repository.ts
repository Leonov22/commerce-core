import "server-only";
import { prisma } from "@/modules/identity/infrastructure/prisma-client";
import type {
  UserRepository,
  NewUserInput,
  UserRecord,
} from "@/modules/identity/repositories/user-repository";
import type { User } from "@/modules/identity/domain/user";

function toDomainUser(row: { id: string; email: string; createdAt: Date; updatedAt: Date }): User {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Prisma implementation of `UserRepository`. This is the only file in
 * Identity allowed to run Prisma queries — the application layer depends
 * on the `UserRepository` interface, never on this class directly.
 */
export const prismaUserRepository: UserRepository = {
  async create(input: NewUserInput): Promise<User> {
    const row = await prisma.user.create({
      data: { email: input.email, passwordHash: input.passwordHash },
    });
    return toDomainUser(row);
  },

  async findByEmail(email: string): Promise<UserRecord | null> {
    const row = await prisma.user.findUnique({ where: { email } });
    if (!row) return null;
    return { ...toDomainUser(row), passwordHash: row.passwordHash };
  },

  async findById(id: string): Promise<User | null> {
    const row = await prisma.user.findUnique({ where: { id } });
    return row ? toDomainUser(row) : null;
  },
};
