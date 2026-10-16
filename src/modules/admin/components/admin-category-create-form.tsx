"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "@/core/i18n/navigation";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

/**
 * Minimal category creation (IMP-043) — name + slug + sort order only,
 * matching `admin-category-commands.ts`'s deliberately narrow scope for
 * this milestone.
 */
export function AdminCategoryCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setErrorCode(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          sortOrder: Number.parseInt(sortOrder, 10) || 0,
        }),
      });

      if (!response.ok) {
        const data: { error?: string } = await response.json().catch(() => ({}));
        setErrorCode(data.error ?? "UNKNOWN_ERROR");
        return;
      }

      setName("");
      setSlug("");
      setSortOrder("0");
      router.refresh();
    } catch {
      setErrorCode("NETWORK_ERROR");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-lg border border-border p-5"
    >
      <h2 className="text-sm font-medium">New category</h2>
      {errorCode ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {errorCode}
        </div>
      ) : null}
      <div>
        <label htmlFor="category-name" className="text-xs font-medium text-muted-foreground">
          Name
        </label>
        <Input
          id="category-name"
          required
          className="mt-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="category-slug" className="text-xs font-medium text-muted-foreground">
          Slug
        </label>
        <Input
          id="category-slug"
          required
          className="mt-1"
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="category-sort-order" className="text-xs font-medium text-muted-foreground">
          Sort order
        </label>
        <Input
          id="category-sort-order"
          type="number"
          step="1"
          className="mt-1"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        />
      </div>
      <Button type="submit" size="sm" disabled={isSubmitting}>
        {isSubmitting ? "Creating…" : "Create category"}
      </Button>
    </form>
  );
}
