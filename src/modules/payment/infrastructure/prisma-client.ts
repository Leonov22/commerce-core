import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Reusable, server-only Prisma client for the Payment module.
 *
 * A separate `PrismaClient` instance alongside Order's/Catalog's/Identity's
 * own, rather than a shared one — sharing it would require importing into
 * another module's infrastructure internals, which the project's
 * module-boundary rules forbid (modules only expose their `index.ts`). At
 * this foundation's scale, a small additional connection pool to the same
 * database is a negligible cost — see `@/modules/order/infrastructure/prisma-client.ts`
 * for the same reasoning applied there.
 */
const globalForPrisma = globalThis as unknown as {
  paymentPrismaClient?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.paymentPrismaClient ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.paymentPrismaClient = prisma;
}
