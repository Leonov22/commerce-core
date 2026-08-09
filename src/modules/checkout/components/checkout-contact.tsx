import { useTranslations } from "next-intl";
import { CheckoutField } from "@/modules/checkout/components/checkout-field";
import type { CheckoutContactValues, CheckoutFormErrors } from "@/modules/checkout/types/checkout";

interface CheckoutContactProps {
  value: CheckoutContactValues;
  errors: CheckoutFormErrors;
  onChange: (value: CheckoutContactValues) => void;
}

export function CheckoutContact({ value, errors, onChange }: CheckoutContactProps) {
  const t = useTranslations("Checkout");

  return (
    <section aria-labelledby="checkout-contact-heading">
      <h2 id="checkout-contact-heading" className="text-base font-medium">
        {t("contact.heading")}
      </h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <CheckoutField
            id="checkout-full-name"
            label={t("contact.fullName")}
            autoComplete="name"
            value={value.fullName}
            error={errors.fullName}
            onChange={(fullName) => onChange({ ...value, fullName })}
          />
        </div>
        <CheckoutField
          id="checkout-email"
          label={t("contact.email")}
          type="email"
          autoComplete="email"
          value={value.email}
          error={errors.email}
          onChange={(email) => onChange({ ...value, email })}
        />
        <CheckoutField
          id="checkout-phone"
          label={t("contact.phone")}
          type="tel"
          autoComplete="tel"
          value={value.phone}
          error={errors.phone}
          onChange={(phone) => onChange({ ...value, phone })}
        />
      </div>
    </section>
  );
}
