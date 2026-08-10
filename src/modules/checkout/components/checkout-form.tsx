"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useCart } from "@/modules/cart";
import { useCatalogProducts } from "@/modules/catalog/client";
import { Button } from "@/shared/components/ui/button";
import { CheckoutContact } from "@/modules/checkout/components/checkout-contact";
import { CheckoutDelivery } from "@/modules/checkout/components/checkout-delivery";
import { CheckoutSummary } from "@/modules/checkout/components/checkout-summary";
import { CheckoutEmptyState } from "@/modules/checkout/components/checkout-empty-state";
import type { CheckoutFormErrors, CheckoutFormValues } from "@/modules/checkout/types/checkout";

const initialValues: CheckoutFormValues = {
  contact: { fullName: "", email: "", phone: "" },
  deliveryAddress: { address: "", city: "", postalCode: "" },
  deliveryMethod: null,
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CheckoutForm() {
  const t = useTranslations("Checkout");
  const locale = useLocale();
  const { items } = useCart();
  const { productsById } = useCatalogProducts(
    items.map((item) => item.productId),
    locale,
  );
  const [values, setValues] = useState<CheckoutFormValues>(initialValues);
  const [errors, setErrors] = useState<CheckoutFormErrors>({});
  const [submitted, setSubmitted] = useState(false);

  if (items.length === 0) {
    return <CheckoutEmptyState />;
  }

  function validate(): CheckoutFormErrors {
    const nextErrors: CheckoutFormErrors = {};

    if (!values.contact.fullName.trim()) {
      nextErrors.fullName = t("errors.required");
    }
    if (!values.contact.email.trim()) {
      nextErrors.email = t("errors.required");
    } else if (!EMAIL_PATTERN.test(values.contact.email)) {
      nextErrors.email = t("errors.invalidEmail");
    }
    if (!values.contact.phone.trim()) {
      nextErrors.phone = t("errors.required");
    }
    if (!values.deliveryAddress.address.trim()) {
      nextErrors.address = t("errors.required");
    }
    if (!values.deliveryAddress.city.trim()) {
      nextErrors.city = t("errors.required");
    }
    if (!values.deliveryAddress.postalCode.trim()) {
      nextErrors.postalCode = t("errors.required");
    }
    if (!values.deliveryMethod) {
      nextErrors.deliveryMethod = t("errors.deliveryMethodRequired");
    }

    return nextErrors;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors(validate());
    setSubmitted(true);
  }

  const hasErrors = submitted && Object.keys(errors).length > 0;
  const isComplete = submitted && Object.keys(errors).length === 0;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="grid items-start gap-12 lg:grid-cols-[1fr_360px]"
    >
      <div className="flex flex-col gap-10">
        {hasErrors ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            {t("errors.summary")}
          </div>
        ) : null}

        <CheckoutContact
          value={values.contact}
          errors={errors}
          onChange={(contact) => setValues((previous) => ({ ...previous, contact }))}
        />

        <CheckoutDelivery
          value={values.deliveryAddress}
          deliveryMethod={values.deliveryMethod}
          errors={errors}
          onAddressChange={(deliveryAddress) =>
            setValues((previous) => ({ ...previous, deliveryAddress }))
          }
          onDeliveryMethodChange={(deliveryMethod) =>
            setValues((previous) => ({ ...previous, deliveryMethod }))
          }
        />

        <div>
          <Button type="submit" className="w-full sm:w-auto">
            {t("submit")}
          </Button>
          {isComplete ? (
            <p role="status" aria-live="polite" className="mt-2 text-xs text-muted-foreground">
              {t("submitSuccess")}
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">{t("submitNote")}</p>
          )}
        </div>
      </div>

      <CheckoutSummary
        items={items}
        productsById={productsById}
        deliveryMethod={values.deliveryMethod}
      />
    </form>
  );
}
