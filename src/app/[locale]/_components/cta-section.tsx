import { getTranslations } from "next-intl/server";
import { Link } from "@/core/i18n/navigation";
import { Container } from "@/shared/components/layout/container";
import { buttonVariants } from "@/shared/components/ui/button";

export async function CtaSection() {
  const t = await getTranslations("Cta");

  return (
    <section className="border-t border-border py-16 sm:py-24">
      <Container className="flex flex-col items-center gap-6 text-center">
        <h2 className="max-w-xl text-3xl font-semibold tracking-tight">{t("title")}</h2>
        <p className="max-w-md text-muted-foreground">{t("subtitle")}</p>
        <Link href="/shop" className={buttonVariants({ size: "lg" })}>
          {t("button")}
        </Link>
      </Container>
    </section>
  );
}
