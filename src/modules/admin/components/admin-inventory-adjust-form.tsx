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
 * Chat 3 Finding 3 (MEDIUM): a server response to attempt N is evidence
 * about attempt N only; it is never evidence, one way or the other,
 * about whether an EARLIER, still-unresolved attempt was applied. An
 * unrelated validation error on a retry (e.g. a mistyped reason) must
 * not silently erase a real, still-open ambiguity from a previous
 * attempt.
 *
 * Chat 3 Finding 1 (HIGH), round 4: the previous version of this
 * component still cleared `hasUnknownOutcome` on a SUCCESSFUL retry —
 * which is just as unsound as clearing it on an error. A later,
 * independent request succeeding proves only that THAT request
 * committed; it proves nothing about whether the EARLIER request that
 * caused the ambiguity in the first place also committed server-side
 * before its response was lost. Both may have gone through, in which
 * case stock has now been adjusted twice. There is no durable,
 * server-side way to tell these two requests apart within this round's
 * scope — no schema change, no idempotency key, no invented
 * reconciliation mechanism that cannot actually identify the original
 * request (see this round's own report for the proposed
 * `clientRequestId` column, not implemented here). So once an outcome
 * goes unknown, `hasUnknownOutcome` never flips back to `false` again
 * for the rest of this component's mounted lifetime, REGARDLESS of
 * what any later request — success, non-2xx, or another network
 * failure — reports. `router.refresh()` only refreshes displayed data;
 * it is never treated as authoritative reconciliation of which request
 * actually committed. The warning's own copy and the resubmission
 * confirm dialog both say this plainly, so an admin is never misled
 * into thinking a later success "cleared" the risk, and is told to
 * check the stock history for a duplicate rather than keep retrying
 * blindly.
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
        "An earlier attempt's outcome is still unknown, and will stay unresolved for the rest " +
          "of this session — even if this new attempt succeeds. That earlier attempt may " +
          "already have been applied, so submitting again could create a DUPLICATE stock " +
          "change. Do not keep retrying based on this page alone: check the stock history " +
          "below for a possible duplicate first. Submit this adjustment anyway?",
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
        // Deliberately NOT touching `hasUnknownOutcome` here. This
        // response is evidence about THIS attempt only — never about
        // whether an earlier, still-ambiguous attempt was applied. If a
        // prior attempt's outcome was unknown, it stays unknown and the
        // warning stays visible, no matter what this unrelated error
        // says. Still refreshing so the stock/history below reflects
        // the latest known server state — but that refresh is not
        // treated as proof of anything about either request.
        router.refresh();
        return;
      }
      setQuantity("");
      setReason("");
      // Chat 3 Finding 1 (HIGH), round 4: deliberately NOT clearing
      // `hasUnknownOutcome` even on THIS definite success — see this
      // component's own doc comment for why a later success is not
      // evidence that an EARLIER, still-ambiguous attempt did or did
      // not also commit. If no prior attempt was ever ambiguous,
      // `hasUnknownOutcome` is already `false` and nothing changes.
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
          An earlier attempt&rsquo;s outcome is unknown — it may already have been applied on the
          server even though this page never confirmed it. This warning will stay visible for the
          rest of this session, even after a later attempt succeeds, because a later success does
          not prove the earlier one failed: if both went through, stock may now be adjusted twice.
          Do not keep retrying based on this page alone — check the stock history below for a
          possible duplicate.
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
