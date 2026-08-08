import { getTranslations } from "next-intl/server";
import { Gem, Sparkles, Globe } from "lucide-react";
import { Container } from "@/shared/components/layout/container";

export async function BrandValuesSection() {
  const t = await getTranslations("BrandValues");

  const values = [
    { Icon: Gem, title: t("materialsTitle"), body: t("materialsBody") },
    { Icon: Sparkles, title: t("presentationTitle"), body: t("presentationBody") },
    { Icon: Globe, title: t("scaleTitle"), body: t("scaleBody") },
  ];

  return (
    <section className="border-t border-border py-16 sm:py-24">
      <Container>
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          {t("eyebrow")}
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight">{t("title")}</h2>

        <div className="mt-12 grid gap-10 sm:grid-cols-3">
          {values.map(({ Icon, title, body }) => (
            <div key={title}>
              <Icon
                aria-hidden="true"
                className="h-6 w-6 text-muted-foreground"
                strokeWidth={1.5}
              />
              <h3 className="mt-4 text-base font-medium">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
