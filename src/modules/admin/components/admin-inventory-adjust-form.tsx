"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "@/core/i18n/navigation";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Select } from "@/shared/components/ui/select";

interface AdminInventoryAdjustFormProps {
  productId: string;
}

type Direction = "increase" | "decrease";

/**
 * Admin stock adjustment (IMP-048 Increment 4) — the only UI path that
 * changes a tracked product's on-hand count once tracking is enabled.
 * Posts to `/api/admin/inventory/[productId]/adjust`, which delegates to
 * `InventoryRepository.adjustStock` — this form never computes or sends
 * a new `stockQuantity` itself, only a signed `quantityChange`, and a
 * reason is always required. A `window.confirm` summarizing the exact
 * change is required before the request is sent, and the submit button
 * is disabled for the duration of the request to prevent a double
 * submission from one click (or from pressing Enter twice).
 */
export function AdminInventoryAdjustForm({ productId }: AdminInventoryAdjustFormProps) {
  const router = useRouter();
  const [direction, setDirection] = useState<Direction>("increase");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setErrorCode(null);

    const parsedQuantity = Number.parseInt(quantity, 10);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      setErrorCode("INVALID_QUANTITY_CHANGE");
      return;
    }
    if (reason.trim().length === 0) {
      setErrorCode("MISSING_REASON");
      return;
    }

    const quantityChange = direction === "increase" ? parsedQuantity : -parsedQuantity;
    const confirmed = window.confirm(
      `${direction === "increase" ? "Increase" : "Decrease"} stock by ${parsedQuantity} unit(s)? This will be recorded in the stock history.`,
    );
    if (!confirmed) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/admin/inventory/${productId}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantityChange, reason: reason.trim() }),
      });
      if (!response.ok) {
        const data: { error?: string } = await response.json().catch(() => ({}));
        setErrorCode(data.error ?? "UNKNOWN_ERROR");
        return;
      }
      setQuantity("");
      setReason("");
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
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      <h3 className="text-sm font-medium">Adjust stock</h3>
      {errorCode ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {errorCode}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <div>
          <label htmlFor="direction" className="text-xs font-medium text-muted-foreground">
            Direction
          </label>
          <Select
            id="direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
            className="mt-1"
          >
            <option value="increase">Increase</option>
            <option value="decrease">Decrease</option>
          </Select>
        </div>
        <div>
          <label htmlFor="quantity" className="text-xs font-medium text-muted-foreground">
            Quantity
          </label>
          <Input
            id="quantity"
            required
            type="number"
            min="1"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>
      <div>
        <label htmlFor="adjustReason" className="text-xs font-medium text-muted-foreground">
          Reason{" "}
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        </label>
        <Input
          id="adjustReason"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Restock from supplier, damaged units written off…"
          className="mt-1"
        />
      </div>
      <div>
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Adjust stock"}
        </Button>
      </div>
    </form>
  );
}
