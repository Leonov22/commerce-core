"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "@/core/i18n/navigation";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Select } from "@/shared/components/ui/select";
import type { ProductDiscount, DiscountType } from "@/modules/catalog";

interface AdminDiscountFormProps {
  /** Omitted for creation; present for editing an existing discount. */
  initialDiscount?: ProductDiscount;
  products: { id: string; name: string }[];
}

interface FormState {
  productId: string;
  type: DiscountType;
  /** For PERCENTAGE: a whole percent as typed (e.g. "20"). For FIXED_AMOUNT: a decimal currency string (e.g. "15.00") — converted to integer minor units only on submit, mirroring the product price field's own convention. */
  value: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

/** `datetime-local` wants `YYYY-MM-DDTHH:mm`, local time, no timezone suffix. */
function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toFormState(discount?: ProductDiscount, defaultProductId?: string): FormState {
  if (!discount) {
    return {
      productId: defaultProductId ?? "",
      type: "PERCENTAGE",
      value: "",
      startsAt: "",
      endsAt: "",
      isActive: true,
    };
  }
  return {
    productId: discount.productId,
    type: discount.type,
    value:
      discount.type === "PERCENTAGE" ? String(discount.value) : (discount.value / 100).toFixed(2),
    startsAt: toDatetimeLocalValue(discount.startsAt),
    endsAt: toDatetimeLocalValue(discount.endsAt),
    isActive: discount.isActive,
  };
}

/**
 * Create/edit form for a product discount (IMP-047). The product a
 * discount applies to is immutable once created — the field is disabled
 * (not merely read-only) when editing, mirroring how
 * `admin-product-form.tsx` never lets `currency` be edited either.
 * Server-side validation in `admin-discount-commands.ts` is the actual
 * authority — this form's own checks exist only for immediate feedback.
 */
export function AdminDiscountForm({ initialDiscount, products }: AdminDiscountFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toFormState(initialDiscount, products[0]?.id));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setErrorCode(null);

    const startsAt = new Date(form.startsAt);
    const endsAt = new Date(form.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      setErrorCode("INVALID_DATE_RANGE");
      return;
    }

    const value =
      form.type === "PERCENTAGE"
        ? Number.parseInt(form.value, 10)
        : Math.round(Number.parseFloat(form.value || "0") * 100);
    if (!Number.isFinite(value)) {
      setErrorCode(form.type === "PERCENTAGE" ? "INVALID_PERCENTAGE_VALUE" : "INVALID_FIXED_VALUE");
      return;
    }

    const body = {
      ...(initialDiscount ? {} : { productId: form.productId }),
      type: form.type,
      value,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      isActive: form.isActive,
    };

    setIsSubmitting(true);
    try {
      const response = initialDiscount
        ? await fetch(`/api/admin/discounts/${initialDiscount.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/discounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      if (!response.ok) {
        const data: { error?: string } = await response.json().catch(() => ({}));
        setErrorCode(data.error ?? "UNKNOWN_ERROR");
        return;
      }

      router.push("/admin/discounts");
      router.refresh();
    } catch {
      setErrorCode("NETWORK_ERROR");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!initialDiscount || isDeleting) return;
    // "Remove a discount when safe" (§5.2) — always safe here, since
    // `ProductDiscount` is never referenced by a historical OrderItem
    // (see `deleteProductDiscount`'s own doc comment) — but deletion is
    // still irreversible, so confirm before sending the request.
    if (!window.confirm("Remove this discount? This cannot be undone.")) {
      return;
    }
    setErrorCode(null);
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/admin/discounts/${initialDiscount.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data: { error?: string } = await response.json().catch(() => ({}));
        setErrorCode(data.error ?? "UNKNOWN_ERROR");
        return;
      }
      router.push("/admin/discounts");
      router.refresh();
    } catch {
      setErrorCode("NETWORK_ERROR");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {errorCode ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {errorCode}
        </div>
      ) : null}

      <Field label="Product" htmlFor="productId" required>
        <Select
          id="productId"
          required
          disabled={Boolean(initialDiscount)}
          value={form.productId}
          onChange={(e) => update("productId", e.target.value)}
        >
          <option value="" disabled>
            Select a product
          </option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Discount type" htmlFor="type" required>
          <Select
            id="type"
            required
            value={form.type}
            onChange={(e) => update("type", e.target.value as DiscountType)}
          >
            <option value="PERCENTAGE">Percentage</option>
            <option value="FIXED_AMOUNT">Fixed amount</option>
          </Select>
        </Field>
        <Field
          label={form.type === "PERCENTAGE" ? "Percentage off" : "Amount off (EUR)"}
          htmlFor="value"
          required
        >
          <Input
            id="value"
            required
            type="number"
            min="0"
            step={form.type === "PERCENTAGE" ? "1" : "0.01"}
            value={form.value}
            onChange={(e) => update("value", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts at" htmlFor="startsAt" required>
          <Input
            id="startsAt"
            required
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => update("startsAt", e.target.value)}
          />
        </Field>
        <Field label="Ends at" htmlFor="endsAt" required>
          <Input
            id="endsAt"
            required
            type="datetime-local"
            value={form.endsAt}
            onChange={(e) => update("endsAt", e.target.value)}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => update("isActive", e.target.checked)}
          className="h-4 w-4 accent-foreground"
        />
        Active
      </label>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isSubmitting || isDeleting}>
          {isSubmitting ? "Saving…" : initialDiscount ? "Save changes" : "Create discount"}
        </Button>
        {initialDiscount ? (
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting || isDeleting}
            onClick={handleDelete}
          >
            {isDeleting ? "Removing…" : "Remove discount"}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-destructive">
            {" "}
            *
          </span>
        ) : null}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
