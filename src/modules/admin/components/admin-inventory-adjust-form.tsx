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
 *
 * Chat 3 Finding 5 (MEDIUM): there is no durable, server-side
 * deduplication of a submission (no client-generated request id is
 * persisted anywhere — `StockAdjustment` has no column for one today,
 * and adding one is a schema change out of scope for this round; see
 * this round's own report for the proposed addition). What this form
 * CAN do without one is make the one genuinely ambiguous case — a
 * `fetch` that throws, meaning the request may or may not have reached
 * and been applied by the server — impossible to casually retry past:
 * `hasUnknownOutcome` gates a second, explicit confirmation naming that
 * ambiguity before a resubmission with the same inputs is allowed, and
 * the page is refreshed even on this failure path so the stock history
 * below reflects whatever the server actually did, for the admin to
 * check before deciding. This is honest, UI-level risk disclosure, not
 * a substitute for real idempotency.
 *
 * Chat 3 Finding 3 (MEDIUM): `hasUnknownOutcome` is cleared ONLY by a
 * definite 2xx success — never merely because SOME response (even a
 * non-2xx one) eventually arrived for a later attempt. A server
 * response to attempt N is evidence about attempt N; it is never
 * evidence, one way or the other, about whether an EARLIER,
 * still-unresolved attempt was applied. An unrelated validation error
 * on a retry (e.g. a mistyped reason) must not silently erase a real,
 * still-open ambiguity from a previous attempt — doing so would let an
 * admin walk away believing the risk was resolved when nothing actually
 * resolved it. The warning therefore stays visible across any number of
 * non-2xx responses, clearing only once a request is KNOWN to have
 * succeeded.
 */
export function AdminInventoryAdjustForm({ productId }: AdminInventoryAdjustFormProps) {
  const router = useRouter();
  const [direction, setDirection] = useState<Direction>("increase");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [hasUnknownOutcome, setHasUnknownOutcome] = useState(false);

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

    if (hasUnknownOutcome) {
      const acknowledgedRisk = window.confirm(
        "The previous attempt's outcome is unknown — it may already have been applied. " +
          "Check the stock history below before continuing. Submit this adjustment anyway?",
      );
      if (!acknowledgedRisk) {
        return;
      }
    }

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
        // Chat 3 Finding 3 (MEDIUM): deliberately NOT touching
        // `hasUnknownOutcome` here. This response is evidence about
        // THIS attempt only — never about whether an earlier,
        // still-ambiguous attempt was applied. If a prior attempt's
        // outcome was unknown, it stays unknown and the warning stays
        // visible, no matter what this unrelated error says. Still
        // refreshing so the stock/history below reflects the latest
        // known server state — but that refresh is not treated as
        // proof of anything about either request.
        router.refresh();
        return;
      }
      setQuantity("");
      setReason("");
      // The only path that actually resolves a prior ambiguous
      // outcome: THIS exact request reached the server and is now
      // known, definitively, to have succeeded.
      setHasUnknownOutcome(false);
      router.refresh();
    } catch {
      setErrorCode("NETWORK_ERROR");
      // Genuinely ambiguous: the request may have reached the server
      // and been applied despite this client never seeing a response.
      setHasUnknownOutcome(true);
      // Refresh anyway — if the adjustment actually went through, the
      // stock/history below will already show it, which is the admin's
      // best evidence for deciding whether to resubmit.
      router.refresh();
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
      {hasUnknownOutcome ? (
        <div
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
        >
          The last attempt&rsquo;s outcome is unknown — the request may already have been applied.
          Check the stock history below before submitting again.
        </div>
      ) : null}
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
