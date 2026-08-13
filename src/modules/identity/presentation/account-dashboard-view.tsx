import { getTranslations } from "next-intl/server";
import { Container } from "@/shared/components/layout/container";
import { AccountLogoutButton } from "@/modules/identity/components/account-logout-button";
import type { User } from "@/modules/identity/domain/user";

interface AccountDashboardViewProps {
  user: User;
}

/**
 * Intentionally minimal per IMP-028 scope: just proves the authenticated
 * boundary works end to end. Orders, profile, and addresses are future
 * milestones, not stubbed out here.
 */
export async function AccountDashboardView({ user }: AccountDashboardViewProps) {
  const t = await getTranslations("Account.dashboard");

  return (
    <section className="py-16 sm:py-24">
      <Container>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("heading")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("signedInAs", { email: user.email })}
            </p>
          </div>
          <AccountLogoutButton />
        </div>
      </Container>
    </section>
  );
}
