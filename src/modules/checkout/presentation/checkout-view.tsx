import { getTranslations } from "next-intl/server";
import { Container } from "@/shared/components/layout/container";
import { CheckoutForm } from "@/modules/checkout/components/checkout-form";

export async function CheckoutView() {
  const t = await getTranslations("Checkout");

  return (
    <section className="py-16 sm:py-24">
      <Container>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1>
        <p className="mt-3 max-w-md text-muted-foreground">{t("intro")}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t("guestNotice")}</p>

        <div className="mt-10">
          <CheckoutForm />
        </div>
      </Container>
    </section>
  );
}
