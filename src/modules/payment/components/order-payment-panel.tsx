"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useTranslations } from "next-intl";
import { useRouter } from "@/core/i18n/navigation";
import { Button } from "@/shared/components/ui/button";

interface OrderPaymentPanelProps {
  orderId: string;
}

interface InitResponse {
  clientSecret: string;
  orderStatus: string;
  paymentStatus: string;
}

interface InitErrorResponse {
  error: string;
  /**
   * IMP-041: present specifically for `error: "PAYMENT_NOT_PENDING"` — the
   * current, already-terminal Payment status, needed to distinguish
   * "already succeeded" (show confirmation) from "already failed/
   * canceled" (show a failure message) rather than a generic
   * "unavailable" either way. See the route's own doc comment.
   */
  paymentStatus?: string;
}

interface StatusResponse {
  orderStatus: string;
  paymentStatus: string | null;
}

const TERMINAL_PAYMENT_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

/**
 * Bounded reconciliation polling (IMP-040 Step requirement: "Bounded
 * polling ... when webhook processing is asynchronous"). The IMP-039
 * webhook, not this client, is the only thing that ever actually settles
 * Payment/Order status — this never trusts its own Stripe confirmation
 * result as proof of anything; it only decides WHEN to stop asking the
 * server. A fixed, small attempt count with a fixed delay — never
 * unbounded, never a WebSocket/long-poll, matching this milestone's
 * "no unnecessary asynchronous infrastructure" constraint.
 */
const POLL_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 2000;

type PanelState =
  | { phase: "loading" }
  | { phase: "unavailable"; reason: string }
  | { phase: "ready"; clientSecret: string }
  | { phase: "reconciling" }
  | { phase: "paid" }
  | { phase: "error" };

let stripePromise: Promise<StripeJs | null> | undefined;

function getStripeJs(): Promise<StripeJs | null> {
  if (!stripePromise) {
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = publishableKey ? loadStripe(publishableKey) : Promise.resolve(null);
  }
  return stripePromise;
}

async function fetchStatus(orderId: string): Promise<StatusResponse | null> {
  try {
    const response = await fetch(`/api/orders/${orderId}/payment`);
    if (!response.ok) return null;
    return (await response.json()) as StatusResponse;
  } catch {
    return null;
  }
}

/**
 * Outer panel: resolves (or resumes) the Order's Payment, then renders
 * Stripe Elements once a `clientSecret` is available. Also handles the
 * return-from-redirect case (some payment methods redirect away from
 * `confirmPayment` and back via `return_url`) by detecting Stripe's own
 * `payment_intent_client_secret` query parameter and going straight to
 * reconciliation instead of re-initializing.
 */
export function OrderPaymentPanel({ orderId }: OrderPaymentPanelProps) {
  const t = useTranslations("Account.orders.payment");
  const router = useRouter();
  const [state, setState] = useState<PanelState>({ phase: "loading" });

  useEffect(() => {
    const returning = new URLSearchParams(window.location.search).get(
      "payment_intent_client_secret",
    );
    if (returning) {
      setState({ phase: "reconciling" });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/orders/${orderId}/payment`, { method: "POST" });
        const data: InitResponse | InitErrorResponse = await response.json();
        if (cancelled) return;
        if (!response.ok || !("clientSecret" in data)) {
          // IMP-041: PAYMENT_NOT_PENDING with paymentStatus "SUCCEEDED"
          // means the IMP-039 webhook already settled this Payment before
          // Order.status caught up — show confirmation, not a generic
          // "unavailable" message, for a payment that actually succeeded.
          if ("paymentStatus" in data && data.paymentStatus === "SUCCEEDED") {
            setState({ phase: "paid" });
            return;
          }
          const reason = "error" in data ? data.error : "UNKNOWN_ERROR";
          setState({ phase: "unavailable", reason });
          return;
        }
        if (TERMINAL_PAYMENT_STATUSES.has(data.paymentStatus)) {
          setState({ phase: "paid" });
          return;
        }
        setState({ phase: "ready", clientSecret: data.clientSecret });
      } catch {
        if (!cancelled) setState({ phase: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (state.phase === "loading") {
    return <PaymentStatusBox>{t("loading")}</PaymentStatusBox>;
  }

  if (state.phase === "reconciling") {
    return (
      <ReconciliationPoller
        orderId={orderId}
        onSettled={(paid) => setState(paid ? { phase: "paid" } : { phase: "error" })}
      />
    );
  }

  if (state.phase === "paid") {
    return <PaymentStatusBox tone="success">{t("paid")}</PaymentStatusBox>;
  }

  if (state.phase === "unavailable") {
    return (
      <PaymentStatusBox>
        {t("unavailable")}
        <Button type="button" variant="outline" className="mt-3" onClick={() => router.refresh()}>
          {t("refreshStatus")}
        </Button>
      </PaymentStatusBox>
    );
  }

  if (state.phase === "error") {
    return (
      <PaymentStatusBox tone="error">
        {t("error")}
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() => setState({ phase: "loading" })}
        >
          {t("retry")}
        </Button>
      </PaymentStatusBox>
    );
  }

  return (
    <Elements stripe={getStripeJs()} options={{ clientSecret: state.clientSecret }}>
      <PaymentForm orderId={orderId} />
    </Elements>
  );
}

function PaymentStatusBox({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "error";
}) {
  return (
    <div
      role="status"
      className={
        tone === "error"
          ? "rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive"
          : tone === "success"
            ? "rounded-lg border border-border bg-muted/40 p-6 text-sm"
            : "rounded-lg border border-border p-6 text-sm text-muted-foreground"
      }
    >
      {children}
    </div>
  );
}

/**
 * Polls the SERVER's own authoritative status (never the client-side
 * Stripe confirmation result alone) for up to `POLL_ATTEMPTS` tries,
 * stopping as soon as Payment reaches a terminal status. A timeout here
 * does not mean payment failed (Step 4: "A timeout or missing response
 * does not prove that payment failed") — it only means the IMP-039
 * webhook hadn't settled things yet within this bounded window; the
 * customer can always re-check later (the order detail page itself
 * re-renders current status on any normal refresh).
 */
function ReconciliationPoller({
  orderId,
  onSettled,
}: {
  orderId: string;
  onSettled: (paid: boolean) => void;
}) {
  const t = useTranslations("Account.orders.payment");
  const router = useRouter();
  const attemptRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      while (!cancelled && attemptRef.current < POLL_ATTEMPTS) {
        attemptRef.current += 1;
        const status = await fetchStatus(orderId);
        if (cancelled) return;
        if (status?.paymentStatus === "SUCCEEDED") {
          router.refresh();
          onSettled(true);
          return;
        }
        if (status?.paymentStatus === "FAILED" || status?.paymentStatus === "CANCELLED") {
          onSettled(false);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      if (!cancelled) {
        // Bounded window elapsed with no terminal status yet — not a
        // failure, just inconclusive. Let the customer decide to wait and
        // refresh manually rather than polling forever.
        onSettled(false);
      }
    }

    void poll();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSettled/router are stable enough for this bounded, one-shot effect
  }, [orderId]);

  return <PaymentStatusBox>{t("reconciling")}</PaymentStatusBox>;
}

/**
 * Inner form, rendered only once a `clientSecret` is available. `redirect:
 * "if_required"` keeps card payments (the common case) on this page with
 * an immediate result; a payment method that genuinely requires leaving
 * the page (e.g. certain bank redirects) still returns here via
 * `return_url`, handled by the outer panel's reconciliation path above.
 * Either way, a client-side "succeeded" result only ever triggers a
 * server-status refresh/poll — it never, by itself, renders a "paid"
 * state (Step 4: client confirmation may only initiate a refresh; final
 * UI must reconcile with the server).
 */
function PaymentForm({ orderId }: { orderId: string }) {
  const t = useTranslations("Account.orders.payment");
  const stripe = useStripe();
  const elements = useElements();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [paid, setPaid] = useState(false);

  const returnUrl = useMemo(() => {
    if (typeof window === "undefined") return undefined;
    return window.location.href;
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements || isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: returnUrl ? { return_url: returnUrl } : undefined,
      });

      if (error) {
        setSubmitError(error.message ?? t("confirmFailed"));
        return;
      }

      // `paymentIntent.status` here is Stripe's CLIENT-side view
      // immediately after confirmation — never treated as final; it only
      // decides whether to start reconciling against the server.
      if (paymentIntent?.status === "succeeded" || paymentIntent?.status === "processing") {
        setReconciling(true);
      } else {
        setSubmitError(t("confirmFailed"));
      }
    } catch {
      setSubmitError(t("confirmFailed"));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (paid) {
    return <PaymentStatusBox tone="success">{t("paid")}</PaymentStatusBox>;
  }

  if (reconciling) {
    return (
      <ReconciliationPoller
        orderId={orderId}
        onSettled={(didPay) => {
          setReconciling(false);
          if (didPay) {
            setPaid(true);
          } else {
            setSubmitError(t("stillProcessing"));
          }
        }}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {submitError ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {submitError}
        </div>
      ) : null}
      <PaymentElement />
      <Button type="submit" disabled={!stripe || isSubmitting} className="mt-2 w-full sm:w-auto">
        {isSubmitting ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
