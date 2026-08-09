import { useTranslations } from "next-intl";
import { CheckoutField } from "@/modules/checkout/components/checkout-field";
import { DELIVERY_OPTIONS } from "@/modules/checkout/types/checkout";
import type {
  CheckoutDeliveryAddressValues,
  CheckoutFormErrors,
  DeliveryMethodKey,
} from "@/modules/checkout/types/checkout";

interface CheckoutDeliveryProps {
  value: CheckoutDeliveryAddressValues;
  deliveryMethod: DeliveryMethodKey | null;
  errors: CheckoutFormErrors;
  onAddressChange: (value: CheckoutDeliveryAddressValues) => void;
  onDeliveryMethodChange: (value: DeliveryMethodKey) => void;
}

export function CheckoutDelivery({
  value,
  deliveryMethod,
  errors,
  onAddressChange,
  onDeliveryMethodChange,
}: CheckoutDeliveryProps) {
  const t = useTranslations("Checkout");

  return (
    <section aria-labelledby="checkout-delivery-heading">
      <h2 id="checkout-delivery-heading" className="text-base font-medium">
        {t("delivery.heading")}
      </h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <CheckoutField
            id="checkout-address"
            label={t("delivery.address")}
            autoComplete="street-address"
            value={value.address}
            error={errors.address}
            onChange={(address) => onAddressChange({ ...value, address })}
          />
        </div>
        <CheckoutField
          id="checkout-city"
          label={t("delivery.city")}
          autoComplete="address-level2"
          value={value.city}
          error={errors.city}
          onChange={(city) => onAddressChange({ ...value, city })}
        />
        <CheckoutField
          id="checkout-postal-code"
          label={t("delivery.postalCode")}
          autoComplete="postal-code"
          value={value.postalCode}
          error={errors.postalCode}
          onChange={(postalCode) => onAddressChange({ ...value, postalCode })}
        />
      </div>

      <fieldset
        className="mt-6"
        aria-invalid={errors.deliveryMethod ? true : undefined}
        aria-describedby={errors.deliveryMethod ? "delivery-method-error" : undefined}
      >
        <legend className="text-sm font-medium">{t("delivery.methodLabel")}</legend>
        <div className="mt-3 flex flex-col gap-3">
          {DELIVERY_OPTIONS.map((option) => (
            <label
              key={option.key}
              className="flex cursor-pointer items-center justify-between gap-4 rounded-md border border-border p-4 has-[:checked]:border-foreground"
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="deliveryMethod"
                  value={option.key}
                  checked={deliveryMethod === option.key}
                  onChange={() => onDeliveryMethodChange(option.key)}
                  className="h-4 w-4 accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                />
                <span>
                  <span className="block text-sm font-medium">
                    {t(`delivery.methods.${option.key}.label`)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`delivery.methods.${option.key}.description`)}
                  </span>
                </span>
              </span>
              <span className="text-sm text-muted-foreground">
                {t("summary.amount", { amount: option.priceAmount })}
              </span>
            </label>
          ))}
        </div>
        {errors.deliveryMethod ? (
          <p id="delivery-method-error" role="alert" className="mt-2 text-xs text-destructive">
            {errors.deliveryMethod}
          </p>
        ) : null}
      </fieldset>
    </section>
  );
}
