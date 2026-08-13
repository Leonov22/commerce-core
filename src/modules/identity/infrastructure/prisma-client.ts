import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Reusable, server-only Prisma client for the Identity module. A separate
 * instance from Catalog's and Order's, for the same reason those two are
 * separate from each other — sharing would require importing into another
 * module's infrastructure internals, which the project's module-boundary
 * rules forbid (modules only expose their `index.ts`).
 */
const globalForPrisma = globalThis as unknown as {
  identityPrismaClient?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.identityPrismaClient ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.identityPrismaClient = prisma;
}
