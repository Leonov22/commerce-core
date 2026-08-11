import { useTranslations } from "next-intl";
import { CheckoutField } from "@/modules/checkout/components/checkout-field";
import type { CheckoutFormErrors, CustomerInformation } from "@/modules/checkout/types/checkout";

interface CheckoutContactProps {
  value: CustomerInformation;
  errors: CheckoutFormErrors;
  onChange: (value: CustomerInformation) => void;
  onFieldBlur: (field: keyof CustomerInformation) => void;
}

export function CheckoutContact({ value, errors, onChange, onFieldBlur }: CheckoutContactProps) {
  const t = useTranslations("Checkout");

  return (
    <section aria-labelledby="checkout-contact-heading">
      <h2 id="checkout-contact-heading" className="text-base font-medium">
        {t("contact.heading")}
      </h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <CheckoutField
          id="checkout-first-name"
          label={t("contact.firstName")}
          autoComplete="given-name"
          required
          value={value.firstName}
          error={errors.firstName}
          onChange={(firstName) => onChange({ ...value, firstName })}
          onBlur={() => onFieldBlur("firstName")}
        />
        <CheckoutField
          id="checkout-last-name"
          label={t("contact.lastName")}
          autoComplete="family-name"
          required
          value={value.lastName}
          error={errors.lastName}
          onChange={(lastName) => onChange({ ...value, lastName })}
          onBlur={() => onFieldBlur("lastName")}
        />
        <CheckoutField
          id="checkout-email"
          label={t("contact.email")}
          type="email"
          autoComplete="email"
          required
          value={value.email}
          error={errors.email}
          onChange={(email) => onChange({ ...value, email })}
          onBlur={() => onFieldBlur("email")}
        />
        <CheckoutField
          id="checkout-phone"
          label={t("contact.phone")}
          type="tel"
          autoComplete="tel"
          required
          value={value.phone}
          error={errors.phone}
          onChange={(phone) => onChange({ ...value, phone })}
          onBlur={() => onFieldBlur("phone")}
        />
      </div>
    </section>
  );
}
