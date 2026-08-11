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
import { CheckoutSuccess } from "@/modules/checkout/components/checkout-success";
import {
  resolveCheckoutSummary,
  validateCustomerInformation,
} from "@/modules/checkout/types/checkout";
import type {
  CheckoutFormErrors,
  CheckoutFormValues,
  CustomerInformation,
} from "@/modules/checkout/types/checkout";

const initialValues: CheckoutFormValues = {
  contact: { firstName: "", lastName: "", email: "", phone: "" },
  deliveryAddress: { address: "", city: "", postalCode: "" },
  deliveryMethod: null,
};

interface CreatedOrder {
  id: string;
}

export function CheckoutForm() {
  const t = useTranslations("Checkout");
  const locale = useLocale();
  const { items, clearCart } = useCart();
  const { productsById, isLoading } = useCatalogProducts(
    items.map((item) => item.productId),
    locale,
  );
  const [values, setValues] = useState<CheckoutFormValues>(initialValues);
  const [errors, setErrors] = useState<CheckoutFormErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [touchedContactFields, setTouchedContactFields] = useState<
    Partial<Record<keyof CustomerInformation, boolean>>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null);

  // A just-created Order clears the Cart, which would otherwise fall
  // through to the empty-cart branch below and hide the confirmation the
  // user is meant to see — so this check comes first.
  if (createdOrder) {
    return <CheckoutSuccess orderId={createdOrder.id} />;
  }

  if (items.length === 0) {
    return <CheckoutEmptyState />;
  }

  function handleContactBlur(field: keyof CustomerInformation) {
    setTouchedContactFields((previous) => ({ ...previous, [field]: true }));
  }

  // Live, per-field feedback (validate on blur, then stay up to date as the
  // user types) for Customer Information specifically — the raw result
  // (ignoring touched-state) also feeds the submit-readiness check below.
  const contactValidation = validateCustomerInformation(values.contact);
  const contactErrors: CheckoutFormErrors = {};
  (Object.keys(contactValidation) as (keyof CustomerInformation)[]).forEach((field) => {
    if (touchedContactFields[field]) {
      contactErrors[field] = t(`errors.${contactValidation[field]}`);
    }
  });
  const isCustomerInformationValid = Object.keys(contactValidation).length === 0;

  const summary = resolveCheckoutSummary(items, productsById, isLoading);
  const isCartReady = summary.status === "ready" && summary.unresolvedCount === 0;

  const canSubmit =
    isCustomerInformationValid && isCartReady && values.deliveryMethod !== null && !isSubmitting;

  function validate(): CheckoutFormErrors {
    const nextErrors: CheckoutFormErrors = {};

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const deliveryErrors = validate();
    const nextErrors: CheckoutFormErrors = { ...deliveryErrors, ...contactErrors };
    setErrors(nextErrors);
    setSubmitted(true);
    setSubmitError(false);

    if (Object.keys(deliveryErrors).length > 0 || !isCustomerInformationValid || !isCartReady) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: values.contact,
          items: items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
          deliveryMethod: values.deliveryMethod,
          locale,
        }),
      });

      if (!response.ok) {
        setSubmitError(true);
        return;
      }

      const data: { order: { id: string } } = await response.json();
      // Cart is only cleared after the server confirms the Order exists —
      // never before, so a failed request always leaves the Cart intact.
      clearCart();
      setCreatedOrder({ id: data.order.id });
    } catch {
      setSubmitError(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  const hasErrors = submitted && (Object.keys(errors).length > 0 || submitError);

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
            {submitError ? t("errors.orderFailed") : t("errors.summary")}
          </div>
        ) : null}

        <CheckoutContact
          value={values.contact}
          errors={contactErrors}
          onChange={(contact) => setValues((previous) => ({ ...previous, contact }))}
          onFieldBlur={handleContactBlur}
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
          <Button
            type="submit"
            disabled={!canSubmit}
            aria-describedby="checkout-submit-note"
            className="w-full sm:w-auto"
          >
            {isSubmitting ? t("submitting") : t("submit")}
          </Button>
          <p id="checkout-submit-note" className="mt-2 text-xs text-muted-foreground">
            {t("submitNote")}
          </p>
        </div>
      </div>

      <CheckoutSummary
        items={items}
        productsById={productsById}
        isLoading={isLoading}
        deliveryMethod={values.deliveryMethod}
      />
    </form>
  );
}
