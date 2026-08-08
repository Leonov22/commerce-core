import { getTranslations } from "next-intl/server";
import { ShoppingBag } from "lucide-react";
import { Link } from "@/core/i18n/navigation";
import { Container } from "@/shared/components/layout/container";
import { buttonVariants } from "@/shared/components/ui/button";
import { cn } from "@/core/lib/utils";

export async function HeroSection() {
  const t = await getTranslations("Hero");

  return (
    <section className="py-16 sm:py-24 lg:py-28">
      <Container className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            {t("eyebrow")}
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            {t("headline")}
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-muted-foreground">
            {t("subtext")}
          </p>

          <div className="mt-10 flex flex-col gap-4 sm:flex-row">
            <Link href="/shop" className={buttonVariants({ size: "lg" })}>
              {t("primaryCta")}
            </Link>
            <Link href="/about" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
              {t("secondaryCta")}
            </Link>
          </div>
        </div>

        <div
          role="img"
          aria-label={t("visualLabel")}
          className="flex aspect-square items-center justify-center rounded-lg border border-border bg-muted"
        >
          <ShoppingBag
            aria-hidden="true"
            className="h-16 w-16 text-muted-foreground"
            strokeWidth={1.25}
          />
        </div>
      </Container>
    </section>
  );
}
