import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Reusable, server-only Prisma client for the Catalog module.
 *
 * `server-only` makes any accidental import from a Client Component fail
 * the build instead of silently bundling Prisma into browser JS. The
 * global-cache pattern avoids opening a new database connection pool on
 * every Next.js dev hot-reload.
 */
const globalForPrisma = globalThis as unknown as {
  catalogPrismaClient?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.catalogPrismaClient ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.catalogPrismaClient = prisma;
}
