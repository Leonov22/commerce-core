import { useTranslations } from "next-intl";
import { Link } from "@/core/i18n/navigation";
import { buttonVariants } from "@/shared/components/ui/button";
import { cn } from "@/core/lib/utils";

interface CheckoutSuccessProps {
  orderId: string;
}

export function CheckoutSuccess({ orderId }: CheckoutSuccessProps) {
  const t = useTranslations("Checkout");

  return (
    <div
      role="status"
      className="flex flex-col items-center gap-3 rounded-lg border border-border py-24 text-center"
    >
      <p className="text-lg font-medium">{t("success.title")}</p>
      <p className="text-sm text-muted-foreground">{t("success.orderId", { id: orderId })}</p>
      <p className="text-sm text-muted-foreground">{t("success.status")}</p>
      <Link href="/shop" className={cn(buttonVariants({ variant: "outline" }), "mt-3")}>
        {t("success.continueShopping")}
      </Link>
    </div>
  );
}
