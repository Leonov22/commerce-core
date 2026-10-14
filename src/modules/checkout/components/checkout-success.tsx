import { useTranslations } from "next-intl";
import { Link } from "@/core/i18n/navigation";
import { buttonVariants } from "@/shared/components/ui/button";
import { cn } from "@/core/lib/utils";

interface CheckoutSuccessProps {
  orderId: string;
  isAuthenticated: boolean;
}

/**
 * IMP-040/IMP-041-FIX (PR1-F04): the one place a customer leaves Checkout
 * toward actually paying — but ONLY for an authenticated customer.
 *
 * `isAuthenticated` decides whether a "pay now" CTA is shown at all, not
 * merely its destination: the authenticated payment route
 * (`/api/orders/[id]/payment`) requires the requesting session to
 * actually own the Order (`getCustomerOrder`), and a guest checkout order
 * has no `userId` for ANY session to ever match — signing in (or
 * registering) can never grant access to a guest order, because this
 * repository has no guest-order-linking mechanism of any kind (no token,
 * no email-matching, no new authorization model — and this fix does not
 * invent one, per its own explicit scope limit). The previous copy
 * ("Sign in to pay for this order") was therefore misleading: it implied
 * signing in would unlock payment for THIS order, which it never could.
 * A guest instead sees an honest explanation of the limitation, with no
 * CTA that promises something the application cannot deliver.
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
      {!isAuthenticated ? (
        <p className="max-w-sm text-sm text-muted-foreground">
          {t("success.guestPaymentUnavailable")}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
        {isAuthenticated ? (
          <Link href={`/account/orders/${orderId}`} className={cn(buttonVariants())}>
            {t("success.payNow")}
          </Link>
        ) : null}
        <Link
          href="/shop"
          className={cn(buttonVariants({ variant: isAuthenticated ? "outline" : "primary" }))}
        >
          {t("success.continueShopping")}
        </Link>
      </div>
    </div>
  );
}
