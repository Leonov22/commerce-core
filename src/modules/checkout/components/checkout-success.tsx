import { useTranslations } from "next-intl";
import { Link } from "@/core/i18n/navigation";
import { buttonVariants } from "@/shared/components/ui/button";
import { cn } from "@/core/lib/utils";

interface CheckoutSuccessProps {
  orderId: string;
  isAuthenticated: boolean;
}

/**
 * IMP-040: the one place a customer leaves Checkout toward actually
 * paying. `isAuthenticated` decides the link's destination, never its
 * presence — a guest sees a path to sign in rather than no path at all,
 * since this milestone deliberately does not invent a guest-specific
 * order-access mechanism (see the Roadmap's IMP-040 entry). Either link
 * leads somewhere that independently re-verifies session/ownership; this
 * component makes no authorization decision itself.
 */
export function CheckoutSuccess({ orderId, isAuthenticated }: CheckoutSuccessProps) {
  const t = useTranslations("Checkout");

  return (
    <div
      role="status"
      className="flex flex-col items-center gap-3 rounded-lg border border-border py-24 text-center"
    >
      <p className="text-lg font-medium">{t("success.title")}</p>
      <p className="text-sm text-muted-foreground">{t("success.orderId", { id: orderId })}</p>
      <p className="text-sm text-muted-foreground">{t("success.status")}</p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
        {isAuthenticated ? (
          <Link href={`/account/orders/${orderId}`} className={cn(buttonVariants())}>
            {t("success.payNow")}
          </Link>
        ) : (
          <Link href="/account/login" className={cn(buttonVariants())}>
            {t("success.signInToPay")}
          </Link>
        )}
        <Link href="/shop" className={cn(buttonVariants({ variant: "outline" }))}>
          {t("success.continueShopping")}
        </Link>
      </div>
    </div>
  );
}
