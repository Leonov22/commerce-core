/**
 * The one-off, explicitly-targeted way to grant `ADMIN` to a single
 * existing user (IMP-044). There is deliberately no UI, no public route,
 * and no automatic promotion on registration/startup/deploy — the
 * operator must run this by hand, once, against a database they have
 * personally verified.
 *
 * Mirrors `prisma/set-product-currency.ts`'s shape: a separate
 * confirmation gate checked before any Prisma client is constructed (see
 * `admin-promotion-guard.ts`), and the write + exact-match check run
 * inside one transaction so an ambiguous or missing match is never
 * partially applied.
 *
 * Idempotent: promoting an already-ADMIN user is a no-op success, not an
 * error — running this script twice with the same email is safe.
 *
 * Before running, verify `DATABASE_URL` actually points at the database
 * you intend to target. Then run with:
 *   ADMIN_PROMOTION_EMAIL="person@example.com" \
 *   ADMIN_PROMOTION_CONFIRM="yes-i-have-verified-DATABASE_URL-targets-the-intended-database" \
 *     pnpm exec tsx prisma/promote-user-to-admin.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  ADMIN_PROMOTION_CONFIRMATION_ENV_VAR,
  ADMIN_PROMOTION_CONFIRMATION_VALUE,
  ADMIN_PROMOTION_EMAIL_ENV_VAR,
  isAdminPromotionConfirmed,
} from "@/modules/identity/infrastructure/admin-promotion-guard";

function assertConfirmed(): void {
  if (isAdminPromotionConfirmed(process.env)) {
    return;
  }
  console.error(
    "[prisma/promote-user-to-admin.ts] Refused: this script writes to whichever " +
      "database DATABASE_URL currently points to. Having DATABASE_URL set is not " +
      "by itself confirmation that this is the intended target.\n\n" +
      "Before running this script, verify DATABASE_URL points at the database " +
      "you actually intend to target, then set:\n" +
      `  ${ADMIN_PROMOTION_CONFIRMATION_ENV_VAR}=${ADMIN_PROMOTION_CONFIRMATION_VALUE}\n\n` +
      "in the environment before retrying.",
  );
  process.exit(1);
}

function resolveTargetEmail(): string {
  const raw = process.env[ADMIN_PROMOTION_EMAIL_ENV_VAR];
  if (!raw || raw.trim().length === 0) {
    console.error(
      `[prisma/promote-user-to-admin.ts] Refused: set ${ADMIN_PROMOTION_EMAIL_ENV_VAR} to ` +
        "the exact email of the single existing user to promote.",
    );
    process.exit(1);
  }
  return raw.trim().toLowerCase();
}

assertConfirmed();
const targetEmail = resolveTargetEmail();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const outcome = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { email: targetEmail } });
    if (!user) {
      throw new Error(
        `No user found with email "${targetEmail}" — refusing to proceed. ` +
          "Verify the email is exactly correct and the account already exists.",
      );
    }

    if (user.role === "ADMIN") {
      return { message: `User "${targetEmail}" (id ${user.id}) is already ADMIN — no changes made.` };
    }

    const result = await tx.user.updateMany({
      where: { id: user.id, role: "CUSTOMER" },
      data: { role: "ADMIN" },
    });

    if (result.count !== 1) {
      throw new Error(
        `Expected to update exactly 1 user but updated ${result.count} — rolled back. ` +
          "The user's role may have changed concurrently; re-run to check its current state.",
      );
    }

    return { message: `User "${targetEmail}" (id ${user.id}) promoted to ADMIN.` };
  });

  console.log(outcome.message);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
