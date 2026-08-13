import { getTranslations } from "next-intl/server";
import { Container } from "@/shared/components/layout/container";
import { Link } from "@/core/i18n/navigation";
import { AccountLogoutButton } from "@/modules/identity/components/account-logout-button";
import type { User } from "@/modules/identity/domain/user";

interface AccountDashboardViewProps {
  user: User;
}

/**
 * Intentionally minimal per IMP-028 scope, extended minimally in IMP-029
 * with a link to Order History: just proves the authenticated boundary
 * works end to end. Profile and addresses remain future milestones. The
 * link below is plain markup, not a dependency on `@/modules/order` — this
 * module still never imports Order.
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

        <div className="mt-8">
          <Link href="/account/orders" className="text-sm font-medium underline">
            {t("ordersLink")}
          </Link>
        </div>
      </Container>
    </section>
  );
}
