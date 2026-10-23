import { getTranslations } from "next-intl/server";
import { Container } from "@/shared/components/layout/container";

export default async function AccountOrdersLoading() {
  const t = await getTranslations("Account.orders");

  return (
    <section className="py-16 sm:py-24">
      <Container>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1>
        <div
          role="status"
          className="mt-10 rounded-lg border border-border p-10 text-center text-sm text-muted-foreground"
        >
          {t("loading")}
        </div>
      </Container>
    </section>
  );
}
