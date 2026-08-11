import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Reusable, server-only Prisma client for the Order module.
 *
 * A second `PrismaClient` instance alongside Catalog's rather than a shared
 * one — sharing it would require importing into Catalog's infrastructure
 * internals, which the project's module-boundary rules forbid (modules only
 * expose their `index.ts`). At this foundation's scale, a second small
 * connection pool to the same database is a negligible cost; consolidating
 * into one shared `core/`-level client is a reasonable follow-up but is a
 * cross-cutting change outside this additive foundation's scope.
 */
const globalForPrisma = globalThis as unknown as {
  orderPrismaClient?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.orderPrismaClient ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.orderPrismaClient = prisma;
}
