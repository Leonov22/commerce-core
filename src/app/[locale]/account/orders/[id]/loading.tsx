import { getTranslations } from "next-intl/server";
import { Container } from "@/shared/components/layout/container";

export default async function AccountOrderDetailLoading() {
  const t = await getTranslations("Account.orders");

  return (
    <section className="py-16 sm:py-24">
      <Container>
        <div
          role="status"
          className="rounded-lg border border-border p-10 text-center text-sm text-muted-foreground"
        >
          {t("loading")}
        </div>
      </Container>
    </section>
  );
}
