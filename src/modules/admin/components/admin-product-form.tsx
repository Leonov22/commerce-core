"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "@/core/i18n/navigation";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import { Select } from "@/shared/components/ui/select";
import { AdminProductImageField } from "@/modules/admin/components/admin-product-image-field";
import type { AdminProduct, ProductStatus, ProductBadge, Category } from "@/modules/catalog";

interface AdminProductFormProps {
  /** Omitted for creation; present for editing an existing product. */
  initialProduct?: AdminProduct;
  categories: Category[];
}

interface FormState {
  slug: string;
  name: string;
  meta: string;
  description: string;
  material: string;
  dimensions: string;
  /** Decimal string as typed (e.g. "240.00") — converted to integer minor units only on submit. */
  price: string;
  categoryId: string;
  badge: ProductBadge | "";
  isFeatured: boolean;
  sortOrder: string;
  status: ProductStatus;
}

function toFormState(product?: AdminProduct, defaultCategoryId?: string): FormState {
  if (!product) {
    return {
      slug: "",
      name: "",
      meta: "",
      description: "",
      material: "",
      dimensions: "",
      price: "",
      categoryId: defaultCategoryId ?? "",
      badge: "",
      isFeatured: false,
      sortOrder: "0",
      status: "DRAFT",
    };
  }
  return {
    slug: product.slug,
    name: product.name,
    meta: product.meta,
    description: product.description,
    material: product.material,
    dimensions: product.dimensions,
    price: (product.priceAmountMinor / 100).toFixed(2),
    categoryId: product.categoryId,
    badge: product.badge ?? "",
    isFeatured: product.isFeatured,
    sortOrder: String(product.sortOrder),
    status: product.status,
  };
}

/**
 * Reusable create/edit form (IMP-043), organized into the sections every
 * future admin product field should slot into:
 * 1. Basic information, 2. Media, 3. Pricing, 4. Category & organization,
 * 5. Status. Server-side validation in `admin-product-commands.ts` is
 * the actual authority — this form's own checks exist only to give the
 * admin immediate feedback, never as a substitute for it.
 *
 * Section 2 (Media, IMP-046) uploads directly to Vercel Blob via
 * `AdminProductImageField` — see that component's own doc comment. It is
 * disabled until the product has been saved once (no id to attach an
 * image to yet), which is why it isn't wired into this form's own submit
 * flow at all: image changes are persisted immediately by that
 * component's own API calls, independent of this form's price/status/etc.
 * submission.
 */
export function AdminProductForm({ initialProduct, categories }: AdminProductFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toFormState(initialProduct, categories[0]?.id));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setErrorCode(null);

    const priceAmountMinor = Math.round(Number.parseFloat(form.price || "0") * 100);
    if (!Number.isFinite(priceAmountMinor) || priceAmountMinor < 0) {
      setErrorCode("INVALID_PRICE");
      return;
    }

    const body = {
      slug: form.slug.trim(),
      status: form.status,
      priceAmountMinor,
      categoryId: form.categoryId,
      badge: form.badge === "" ? null : form.badge,
      isFeatured: form.isFeatured,
      sortOrder: Number.parseInt(form.sortOrder, 10) || 0,
      name: form.name.trim(),
      meta: form.meta,
      description: form.description,
      material: form.material,
      dimensions: form.dimensions,
    };

    setIsSubmitting(true);
    try {
      const response = initialProduct
        ? await fetch(`/api/admin/products/${initialProduct.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/products", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      if (!response.ok) {
        const data: { error?: string } = await response.json().catch(() => ({}));
        setErrorCode(data.error ?? "UNKNOWN_ERROR");
        return;
      }

      const data: { product: AdminProduct } = await response.json();
      router.push(`/admin/products/${data.product.id}`);
      router.refresh();
    } catch {
      setErrorCode("NETWORK_ERROR");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-10">
      {errorCode ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {errorCode}
        </div>
      ) : null}

      <section>
        <h2 className="text-base font-medium">Basic information</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" required>
            <Input
              id="name"
              required
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </Field>
          <Field label="Slug" htmlFor="slug" required>
            <Input
              id="slug"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              title="Lowercase letters, numbers, and hyphens only"
              value={form.slug}
              onChange={(e) => update("slug", e.target.value)}
            />
          </Field>
          <Field label="Meta" htmlFor="meta">
            <Input id="meta" value={form.meta} onChange={(e) => update("meta", e.target.value)} />
          </Field>
          <Field label="Material" htmlFor="material">
            <Input
              id="material"
              value={form.material}
              onChange={(e) => update("material", e.target.value)}
            />
          </Field>
          <Field label="Dimensions" htmlFor="dimensions">
            <Input
              id="dimensions"
              value={form.dimensions}
              onChange={(e) => update("dimensions", e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description" htmlFor="description">
              <Textarea
                id="description"
                rows={4}
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
              />
            </Field>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-base font-medium">Media</h2>
        <AdminProductImageField
          productId={initialProduct?.id ?? null}
          imageUrl={initialProduct?.imageUrl ?? null}
        />
      </section>

      <section>
        <h2 className="text-base font-medium">Pricing</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Price (EUR)" htmlFor="price" required>
            <Input
              id="price"
              required
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={(e) => update("price", e.target.value)}
            />
          </Field>
        </div>
      </section>

      <section>
        <h2 className="text-base font-medium">Category &amp; organization</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="categoryId" required>
            <Select
              id="categoryId"
              required
              value={form.categoryId}
              onChange={(e) => update("categoryId", e.target.value)}
            >
              <option value="" disabled>
                Select a category
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.translation.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Badge" htmlFor="badge">
            <Select
              id="badge"
              value={form.badge}
              onChange={(e) => update("badge", e.target.value as ProductBadge | "")}
            >
              <option value="">None</option>
              <option value="NEW">New</option>
              <option value="LIMITED">Limited</option>
            </Select>
          </Field>
          <Field label="Sort order" htmlFor="sortOrder">
            <Input
              id="sortOrder"
              type="number"
              step="1"
              value={form.sortOrder}
              onChange={(e) => update("sortOrder", e.target.value)}
            />
          </Field>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isFeatured}
              onChange={(e) => update("isFeatured", e.target.checked)}
              className="h-4 w-4 accent-foreground"
            />
            Featured on homepage
          </label>
        </div>
      </section>

      <section>
        <h2 className="text-base font-medium">Status</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Status" htmlFor="status" required>
            <Select
              id="status"
              required
              value={form.status}
              onChange={(e) => update("status", e.target.value as ProductStatus)}
            >
              <option value="DRAFT">Draft</option>
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
            </Select>
          </Field>
        </div>
      </section>

      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : initialProduct ? "Save changes" : "Create product"}
        </Button>
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
