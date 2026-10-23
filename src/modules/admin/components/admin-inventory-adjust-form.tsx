"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "@/core/i18n/navigation";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Select } from "@/shared/components/ui/select";
import {
  readUnresolvedAdjustmentOutcome,
  markAdjustmentOutcomeUnresolved,
} from "@/modules/admin/components/admin-inventory-adjust-storage";

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
 * goes unknown, `hasUnknownOutcome` never flips back to `false` again,
 * REGARDLESS of what any later request — success, non-2xx, or another
 * network failure — reports. `router.refresh()` only refreshes
 * displayed data; it is never treated as authoritative reconciliation
 * of which request actually committed.
 *
 * Chat 3 Finding (HIGH), round 5: "for the rest of this component's
 * mounted lifetime" (round 4's own limit) was not actually enough —
 * React local state does not survive this component unmounting, which
 * happens on perfectly ordinary navigation (leaving this product's
 * inventory page and coming back), silently resetting a real,
 * still-open ambiguity back to "resolved" while the SAME inventory
 * item remained fully actionable. `admin-inventory-adjust-storage.ts`
 * persists the flag in `sessionStorage`, keyed by `productId`, scoped
 * to exactly the current browser tab (see that module's own doc
 * comment for why `sessionStorage` rather than `localStorage`) — read
 * once on mount via `useEffect` (never during the initial render
 * itself, which would make the server-rendered and client-hydrated
 * output disagree — a hydration mismatch — since `sessionStorage`
 * doesn't exist during SSR) and written only at the exact same moment
 * `hasUnknownOutcome` itself is set to `true`. Nothing else about this
 * round's own logic changed: still a one-way latch, still never
 * cleared by any later response, still never treated as reconciled by
 * `router.refresh()`.
 *
 * Chat 3 Finding (HIGH), round 6 — two gaps round 5 left open:
 *
 * 1. Between this component mounting and that `useEffect` actually
 *    running, `hasUnknownOutcome` still read as its initial `false` —
 *    a submission in that window could not possibly have seen a real,
 *    persisted flag, silently skipping the exact protection this whole
 *    mechanism exists for. `restorationState` makes that window
 *    explicit (`"pending"` until the stored flag for the CURRENT
 *    `productId` has actually been checked, `"ready"` after) and
 *    `handleSubmit` itself refuses to proceed while pending — not
 *    merely via the submit button's own `disabled` attribute, which
 *    guards normal clicks but is not what `handleSubmit` itself relies
 *    on to decide whether it's safe to run.
 * 2. `readUnresolvedAdjustmentOutcome` can report `"unreadable"` (the
 *    read itself failed) — round 5's boolean-only read conflated this
 *    with `"absent"`, meaning a storage failure was silently treated
 *    as "nothing to worry about." It is instead treated the SAME as
 *    `"present"` here — conservatively surfacing the warning rather
 *    than risking a false "all clear" — but flagged as
 *    `persistenceConfirmed: false`, which changes the warning's own
 *    copy (see the JSX below) to stop promising a persistence
 *    guarantee that was never actually confirmed. The exact same
 *    `persistenceConfirmed` flag also covers a WRITE failure: if
 *    `markAdjustmentOutcomeUnresolved` reports it could not persist a
 *    brand-new ambiguity, this mount's own warning still shows (the
 *    in-memory flag is unconditional), but the copy is honest that it
 *    might not survive leaving the page.
 *
 * Round 6 also fixes `productId` changing on an ALREADY-mounted
 * instance (Next.js can do this for a dynamic route segment without a
 * full unmount in some navigation patterns) — resetting
 * `hasUnknownOutcome`/`restorationState`/`persistenceConfirmed`
 * SYNCHRONOUSLY, during render, the moment a new `productId` prop is
 * observed (the React-documented "adjusting state when a prop
 * changes" pattern — see the `if (productId !== currentProductId)`
 * block below), rather than in an effect. An effect-based reset would
 * commit at least one render where the NEW product's form still shows
 * the OLD product's warning/button state before the effect catches
 * up; resetting during render itself means React re-renders with the
 * reset state before anything is ever painted, so that stale frame
 * never exists. The restoration effect's own stale-result guard (the
 * `isCurrent` flag) additionally protects against the read itself
 * resolving out of order for an old `productId` after a newer one has
 * already taken over — inert today since `sessionStorage` reads are
 * synchronous, but the explicit, standard React idiom for exactly this
 * class of bug if that read ever stopped being synchronous.
 *
 * Chat 3 Finding (HIGH), round 7 — round 6 fixed `productId` changing
 * SYNCHRONOUSLY, but `handleSubmit` itself is `async`: it closes over
 * the `productId` that was current when the admin clicked submit,
 * `await`s `fetch`, and only resumes afterward. Nothing stops
 * `productId` from changing (synchronously, per round 6) WHILE that
 * `fetch` is still in flight — the admin can submit for product A,
 * then navigate to product B on this SAME component instance before
 * A's request ever settles. When it finally does settle, the
 * resumed code was about to call `setErrorCode`/`setHasUnknownOutcome`/
 * `setPersistenceConfirmed`/`setQuantity`/`setReason`/`setIsSubmitting`
 * — every one of which is CURRENTLY-VISIBLE, shared state that, by
 * then, belongs to product B's own rendering, not A's.
 *
 * `generationRef` is a plain `useRef` counter. Each submission
 * captures the counter's value at the moment the admin actually
 * confirmed it (`submissionGeneration`, right before the first
 * `await`); `stillCurrent()` compares that snapshot against the
 * counter's CURRENT value at each point afterward where the code is
 * about to touch shared state. If they no longer match, this
 * submission belongs to a product that is no longer displayed, and
 * every one of those setters is skipped — not merely the warning, but
 * `errorCode`/`quantity`/`reason`/`isSubmitting` too, since all of
 * them are equally visible, equally shared, and equally wrong to
 * mutate on behalf of a product the admin has since navigated away
 * from. `AbortController` was deliberately NOT used for this: aborting
 * the outgoing request only stops THIS CLIENT from waiting on it — it
 * proves nothing about whether the server already committed the
 * adjustment, which is exactly the ambiguity this form exists to
 * surface, never to paper over by pretending the request never
 * happened.
 *
 * The one deliberate exception: `markAdjustmentOutcomeUnresolved` is
 * still called, keyed by the SUBMISSION's own original product id —
 * never the currently-displayed one — regardless of staleness. A's
 * own persisted ambiguity must exist whether or not the admin has
 * since moved on to B, and moving on to B must never be mistaken for
 * reconciling A (see this component's own round 4/5 reasoning for why
 * nothing is ever allowed to look like reconciliation that isn't).
 *
 * Chat 3 Finding (MAJOR), round 8 — round 7 incremented
 * `generationRef.current` INSIDE the render-phase `if (productId !==
 * currentProductId)` block, alongside the `setState` calls. That is
 * unsafe in a way the `setState` calls next to it are not: React can
 * call a component's render function more than once for what ends up
 * being a SINGLE eventual commit (React Strict Mode's extra
 * development round-trip, or — the more consequential case —
 * concurrent rendering starting a render speculatively and then
 * abandoning it, e.g. because a higher-priority update interrupts it
 * before it ever commits). React's own state updates are safe to
 * repeat or discard this way: an abandoned render's `setState` calls
 * are simply discarded along with the rest of that render, as if they
 * never happened, and a genuinely retried render recomputes the SAME
 * state from the SAME props deterministically. A plain `useRef`
 * mutation has NO such protection — writing to `generationRef.current`
 * during a render that never commits still leaves that write in
 * place, forever, with nothing to ever correct it, because nothing
 * about React's render/commit cycle is aware that ref — unlike
 * state — needs to be rolled back. Concretely: if React speculatively
 * started rendering toward product B while product A's own request
 * was genuinely still in flight and still the one actually displayed,
 * and that speculative render was then abandoned (B never actually
 * shown), the OLD code's render-phase bump would have already
 * invalidated A's own, entirely legitimate, still-current request —
 * even though the admin never actually left product A.
 *
 * The fix moves the bump into a `useLayoutEffect`'s CLEANUP, keyed on
 * `[productId]`, instead of the render body:
 *
 *   useLayoutEffect(() => {
 *     return () => { generationRef.current += 1; };
 *   }, [productId]);
 *
 * This is correct under BOTH failure modes the render-phase version
 * had, for two different reasons:
 *   1. Abandoned renders: a `useLayoutEffect` (its setup AND its
 *      cleanup) is only ever invoked by React for a render that
 *      ACTUALLY COMMITTED — never for one that was started and then
 *      discarded. An abandoned speculative render toward B therefore
 *      cannot bump this at all; the bump only happens once React has
 *      genuinely committed to showing a different product.
 *   2. The commit-to-cleanup window: `useLayoutEffect`'s cleanup for
 *      the PREVIOUS commit runs SYNCHRONOUSLY, as part of the very
 *      same uninterrupted synchronous phase as the commit that
 *      replaces it — before the browser paints, and before control is
 *      ever yielded back to the microtask queue. A regular
 *      `useEffect` (used elsewhere in this component, for the
 *      restoration read) is deliberately NOT used for this specific
 *      bump: passive effects are scheduled to run AFTER paint, which
 *      leaves a real window, between "the new product has committed"
 *      and "the passive effect queue gets around to running," during
 *      which a stale request's OWN microtask-scheduled continuation
 *      (its `await fetch(...)` resolving) could resume and find
 *      `generationRef` not yet bumped — passing `stillCurrent()` by
 *      accident and mutating the NEWLY committed product's state
 *      anyway. `useLayoutEffect`'s synchronous timing closes that gap
 *      to zero: nothing else can run between the commit and the bump.
 *
 * The render-phase block still synchronously resets
 * `hasUnknownOutcome`/`restorationState`/`persistenceConfirmed`/
 * `isSubmitting`/`currentProductId` exactly as round 6/7 did — ONLY
 * the generation bump moved out of it. Those `setState` calls remain
 * safe to run during render precisely because they ARE state, with
 * React's own discard-on-abandon guarantee already covering them;
 * nothing about THIS round changes that reasoning, or needs to.
 */
type RestorationState = "pending" | "ready";

export function AdminInventoryAdjustForm({ productId }: AdminInventoryAdjustFormProps) {
  const router = useRouter();
  const [direction, setDirection] = useState<Direction>("increase");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [hasUnknownOutcome, setHasUnknownOutcome] = useState(false);
  const [restorationState, setRestorationState] = useState<RestorationState>("pending");
  // Whether the CURRENT `hasUnknownOutcome: true` is reliably backed by
  // storage — `false` means it either came from an unreadable
  // restoration or a failed write; see this component's own doc
  // comment (round 6) for why that distinction changes the copy below.
  const [persistenceConfirmed, setPersistenceConfirmed] = useState(true);
  const [currentProductId, setCurrentProductId] = useState(productId);
  // Round 7: see this component's own doc comment. A plain `useRef`,
  // not state — nothing ever renders based on its value directly, it
  // only needs to be read synchronously inside `handleSubmit` and
  // survive across renders, which a ref already does without
  // triggering an extra one. Round 8: bumped from a `useLayoutEffect`
  // cleanup below, never from render itself — see this component's
  // own doc comment for why.
  const generationRef = useRef(0);

  // Round 6: resets synchronously, DURING render, the moment a new
  // `productId` prop is observed on this already-mounted instance —
  // see this component's own doc comment for why this must not be an
  // effect. Round 7: also resets `isSubmitting` — a newly-displayed
  // product has never submitted anything of its own yet, regardless
  // of whether the PREVIOUS product's own request is still pending in
  // the background. Round 8: no longer touches `generationRef` here —
  // see the `useLayoutEffect` below and this component's own doc
  // comment for why that bump moved out of render.
  if (productId !== currentProductId) {
    setCurrentProductId(productId);
    setHasUnknownOutcome(false);
    setRestorationState("pending");
    setPersistenceConfirmed(true);
    setIsSubmitting(false);
  }

  // Chat 3 Finding (MAJOR), round 8: the ONLY place `generationRef` is
  // ever written. A `useLayoutEffect`'s cleanup runs synchronously,
  // immediately after a commit, before paint and before any other
  // microtask gets a chance to run — and only ever for a render that
  // actually committed, never an abandoned one. See this component's
  // own doc comment for the full reasoning.
  useLayoutEffect(() => {
    return () => {
      generationRef.current += 1;
    };
  }, [productId]);

  // Chat 3 Finding (HIGH), round 5: starts `false`/`"pending"` on
  // every render (including the server-rendered one) and only reads
  // `sessionStorage` here, in an effect — never in the initial state
  // itself — so the server-rendered HTML and the client's first
  // hydration pass always agree; this one-render "pending, then
  // possibly a warning" flash for a returning tab is the same accepted
  // tradeoff `cart-context.tsx` documents for its own `localStorage`
  // hydration.
  useEffect(() => {
    let isCurrent = true;
    const result = readUnresolvedAdjustmentOutcome(productId);
    if (!isCurrent) {
      return;
    }
    if (result.status === "present") {
      setHasUnknownOutcome(true);
      setPersistenceConfirmed(true);
    } else if (result.status === "unreadable") {
      // Round 6, requirement 3.5: never treat a restoration failure as
      // confirmed absence — conservatively surface the same handling
      // as a real, present flag, but mark it as not confirmed so the
      // copy stays honest about the uncertainty.
      setHasUnknownOutcome(true);
      setPersistenceConfirmed(false);
    } else {
      setHasUnknownOutcome(false);
      setPersistenceConfirmed(true);
    }
    setRestorationState("ready");
    return () => {
      isCurrent = false;
    };
  }, [productId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    // Round 6, requirements 3.1/3.2: enforced here, in `handleSubmit`
    // itself — not merely via the submit button's own `disabled`
    // attribute (which guards an ordinary click, but is not what this
    // function itself checks before doing anything irreversible).
    if (restorationState !== "ready") {
      setErrorCode("RESTORATION_PENDING");
      return;
    }

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
      // Round 6, requirement 4.4: only promise the cross-remount
      // persistence guarantee when it was actually confirmed —
      // otherwise this says so plainly instead of overstating it.
      const acknowledgedRisk = window.confirm(
        persistenceConfirmed
          ? "An earlier attempt's outcome is still unknown, and will stay unresolved for this " +
              "product in this browser tab — even if this new attempt succeeds, and even if " +
              "you leave and come back to this page. That earlier attempt may already have " +
              "been applied, so submitting again could create a DUPLICATE stock change. Do " +
              "not keep retrying based on this page alone: check the stock history below for " +
              "a possible duplicate first. Submit this adjustment anyway?"
          : "An earlier attempt's outcome is still unknown, and this warning could NOT be " +
              "reliably saved for this product — it may be LOST if you leave this page, even " +
              "though the underlying risk is not. That earlier attempt may already have been " +
              "applied, so submitting again could create a DUPLICATE stock change. Check the " +
              "stock history below for a possible duplicate before leaving this page. Submit " +
              "this adjustment anyway?",
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

    // Round 7: snapshot taken at the LAST possible synchronous point —
    // immediately before the first `await` — so it reflects exactly
    // which product this specific submission is for. Nothing async
    // has happened yet, so `generationRef.current` is still guaranteed
    // to equal `submissionGeneration` right now; the only question is
    // whether it STILL will once this resumes after `fetch` settles.
    const submissionProductId = productId;
    const submissionGeneration = generationRef.current;
    const stillCurrent = () => generationRef.current === submissionGeneration;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/admin/inventory/${submissionProductId}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantityChange, reason: reason.trim() }),
      });
      if (!response.ok) {
        const data: { error?: string } = await response.json().catch(() => ({}));
        if (!stillCurrent()) {
          // Round 7: this product is no longer the one displayed —
          // never overwrite whatever error state (or anything else)
          // the CURRENTLY displayed product's own form already has.
          return;
        }
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
      if (!stillCurrent()) {
        // Round 7: a stale SUCCESS must not clear the currently
        // displayed product's own quantity/reason either — this
        // request's success says nothing about what the admin is
        // doing with a different product right now.
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
      // Round 7: the storage write is keyed to `submissionProductId` —
      // the product this submission was ACTUALLY for — and happens
      // UNCONDITIONALLY, regardless of staleness. A's own ambiguity
      // must be recorded whether or not the admin has since moved on
      // to B; navigating to B is never allowed to look like
      // reconciling A.
      const persisted = markAdjustmentOutcomeUnresolved(submissionProductId);
      if (!stillCurrent()) {
        // The CURRENTLY displayed product's own in-memory warning/
        // error state belongs to a different product now — never
        // touch it on behalf of this stale rejection. A's own
        // ambiguity is already correctly recorded above, under A's
        // own key, independent of anything below this line.
        return;
      }
      setErrorCode("NETWORK_ERROR");
      // Genuinely ambiguous: the request may have reached the server
      // and been applied despite this client never seeing a response.
      // The in-memory flag is set UNCONDITIONALLY — this mount's own
      // warning must show regardless of whether persisting it below
      // actually succeeded. Persisted (round 5) in the SAME event as
      // the in-memory flag, so a remount of this exact product's form
      // within this tab normally picks the ambiguity back up instead of
      // losing it — but round 6: the write can itself fail, so its own
      // result is what `persistenceConfirmed` reflects, never an
      // assumption that it worked.
      setHasUnknownOutcome(true);
      setPersistenceConfirmed(persisted);
      // Refresh anyway — if the adjustment actually went through, the
      // stock/history below will already show it, which is the admin's
      // best evidence for deciding whether to resubmit.
      router.refresh();
    } finally {
      // Round 7: only this submission's OWN generation may clear
      // `isSubmitting` — if stale, either the currently displayed
      // product was never submitting on this request's behalf (reset
      // to `false` already, synchronously, the moment `productId`
      // changed) or it has its OWN, unrelated submission in flight
      // whose loading state this must not clobber.
      if (stillCurrent()) {
        setIsSubmitting(false);
      }
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
          {persistenceConfirmed ? (
            <>
              An earlier attempt&rsquo;s outcome is unknown — it may already have been applied on
              the server even though this page never confirmed it. This warning will stay visible
              for this product in this browser tab, even after a later attempt succeeds and even if
              you leave this page and come back, because a later success does not prove the earlier
              one failed: if both went through, stock may now be adjusted twice. Do not keep
              retrying based on this page alone — check the stock history below for a possible
              duplicate.
            </>
          ) : (
            <>
              An earlier attempt&rsquo;s outcome is unknown, and this warning could NOT be reliably
              saved for this product in this browser tab — it may be lost if you leave this page,
              even though the underlying risk is not. Check the stock history below for a possible
              duplicate before leaving this page.
            </>
          )}
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
        {/* Round 6, requirement 3.3: visibly unavailable while
            restoration is pending — the REAL guard is in
            `handleSubmit` itself (above); this is the user-visible
            half of the same rule, not a substitute for it. */}
        <Button type="submit" size="sm" disabled={isSubmitting || restorationState !== "ready"}>
          {isSubmitting ? "Saving…" : restorationState !== "ready" ? "Checking…" : "Adjust stock"}
        </Button>
      </div>
    </form>
  );
}
