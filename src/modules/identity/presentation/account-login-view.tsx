import { getTranslations } from "next-intl/server";
import { Container } from "@/shared/components/layout/container";
import { Link } from "@/core/i18n/navigation";
import { AccountLoginForm } from "@/modules/identity/components/account-login-form";

interface AccountLoginViewProps {
  /**
   * Already validated by the caller (`account/login/page.tsx`, via
   * `resolveSafeCallbackUrl`) — forwarded as-is to the form (for after
   * sign-in) and to the "Register" link (so a guest who needs to create an
   * account first doesn't lose their intended destination).
   */
  callbackUrl: string;
}

export async function AccountLoginView({ callbackUrl }: AccountLoginViewProps) {
  const t = await getTranslations("Account.login");

  return (
    <section className="py-16 sm:py-24">
      <Container>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1>
        <p className="mt-3 max-w-md text-muted-foreground">{t("intro")}</p>

        <div className="mt-10">
          <AccountLoginForm callbackUrl={callbackUrl} />
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          {t("noAccount")}{" "}
          <Link
            href={`/account/register?callbackUrl=${encodeURIComponent(callbackUrl)}`}
            className="font-medium text-foreground underline"
          >
            {t("registerLink")}
          </Link>
        </p>
      </Container>
    </section>
  );
}
