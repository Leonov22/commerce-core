import { useTranslations } from "next-intl";
import { Link } from "@/core/i18n/navigation";
import { buttonVariants } from "@/shared/components/ui/button";

export function CartEmptyState() {
  const t = useTranslations("Cart");

  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border py-24 text-center">
      <p className="text-base font-medium">{t("emptyTitle")}</p>
      <p className="max-w-xs text-sm text-muted-foreground">{t("emptyBody")}</p>
      <Link href="/shop" className={buttonVariants({ variant: "outline" })}>
        {t("continueShopping")}
      </Link>
    </div>
  );
}
