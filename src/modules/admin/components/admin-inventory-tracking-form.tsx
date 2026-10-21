"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "@/core/i18n/navigation";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

interface AdminInventoryTrackingFormProps {
  productId: string;
  trackInventory: boolean;
  stockQuantity: number;
  reserved: number;
}

/**
 * Enable/disable `trackInventory` for one product (IMP-048 Increment 4).
 * Calls `PATCH /api/admin/inventory/[productId]` — never writes
 * `stockQuantity` itself; an initial quantity given while enabling is
 * applied server-side through the same `adjustStock` operation the
 * "Adjust stock" form uses, so it always leaves an audit row when it
 * actually changes the on-hand count.
 */
export function AdminInventoryTrackingForm({
  productId,
  trackInventory,
  stockQuantity,
  reserved,
}: AdminInventoryTrackingFormProps) {
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(false);
  const [initialQuantity, setInitialQuantity] = useState(String(stockQuantity));
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setErrorCode(null);
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/admin/inventory/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data: { error?: string } = await response.json().catch(() => ({}));
        setErrorCode(data.error ?? "UNKNOWN_ERROR");
        return;
      }
      setIsExpanded(false);
      router.refresh();
    } catch {
      setErrorCode("NETWORK_ERROR");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEnable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const parsedInitialQuantity = Number.parseInt(initialQuantity, 10);
    if (!Number.isInteger(parsedInitialQuantity) || parsedInitialQuantity < 0) {
      setErrorCode("INVALID_INITIAL_QUANTITY");
      return;
    }
    const quantityChanges = parsedInitialQuantity !== stockQuantity;
    if (quantityChanges && reason.trim().length === 0) {
      setErrorCode("MISSING_REASON_FOR_INITIAL_QUANTITY");
      return;
    }

    await patch({
      trackInventory: true,
      initialQuantity: parsedInitialQuantity,
      ...(quantityChanges ? { reason: reason.trim() } : {}),
    });
  }

  async function handleDisable() {
    if (isSubmitting) return;
    if (
      !window.confirm(
        "Disable inventory tracking for this product? Its on-hand count is kept as-is, not reset.",
      )
    ) {
      return;
    }
    await patch({ trackInventory: false });
  }

  if (trackInventory) {
    return (
      <div className="flex flex-col gap-2">
        {errorCode === "activeReservationsExist" ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            Cannot disable tracking: {reserved} unit(s) are still actively reserved by one or more
            orders.
          </div>
        ) : errorCode ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {errorCode}
          </div>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isSubmitting}
          onClick={handleDisable}
        >
          {isSubmitting ? "Disabling…" : "Disable tracking"}
        </Button>
      </div>
    );
  }

  if (!isExpanded) {
    return (
      <Button type="button" size="sm" onClick={() => setIsExpanded(true)}>
        Enable tracking
      </Button>
    );
  }

  return (
    <form
      onSubmit={handleEnable}
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      {errorCode ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {errorCode}
        </div>
      ) : null}
      <div>
        <label htmlFor="initialQuantity" className="text-xs font-medium text-muted-foreground">
          Initial stock quantity
        </label>
        <Input
          id="initialQuantity"
          required
          type="number"
          min="0"
          step="1"
          value={initialQuantity}
          onChange={(e) => setInitialQuantity(e.target.value)}
          className="mt-1"
        />
      </div>
      <div>
        <label htmlFor="trackingReason" className="text-xs font-medium text-muted-foreground">
          Reason (required if the quantity above differs from the current on-hand count)
        </label>
        <Input
          id="trackingReason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Initial stock count"
          className="mt-1"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting ? "Enabling…" : "Enable tracking"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setIsExpanded(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
