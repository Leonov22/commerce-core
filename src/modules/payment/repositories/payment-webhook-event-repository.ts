/**
 * Durable webhook deduplication/processing-identity record (IMP-039) — NOT
 * an event-sourcing log. See `prisma/schema.prisma`'s `PaymentWebhookEvent`
 * model doc comment for the full reasoning behind `(provider,
 * providerEventId)` as the uniqueness Postgres enforces.
 */
export interface NewPaymentWebhookEventInput {
  provider: string;
  providerEventId: string;
  eventType: string;
  /** `null` when the event could not be resolved to a known internal Payment. */
  paymentId: string | null;
}

export type RecordPaymentWebhookEventResult = "recorded" | "duplicate";

/**
 * Intentionally the single narrow operation this milestone needs — no
 * `findBy...`, no listing, no update/delete. Mirrors
 * `PaymentRepository`'s "small, purpose-built interface" convention.
 */
export interface PaymentWebhookEventRepository {
  /**
   * Atomic record-or-detect-duplicate, mirroring `PaymentRepository.create`'s
   * proven pattern exactly: a single `INSERT`, never a "does this event id
   * already exist?" read beforehand. Postgres's own unique constraint on
   * `(provider, providerEventId)` is the sole arbiter of which caller
   * "wins" when the same event is delivered concurrently — the loser
   * observes the constraint violation and this method resolves it into
   * `"duplicate"`, never by re-deciding based on its own stale view of
   * "have I seen this before".
   *
   * This result is intentionally NOT the sole correctness gate for webhook
   * processing (see `process-stripe-webhook-event.ts`) — it is recorded for
   * durable audit/deduplication identity, while the actual Payment/Order
   * state transitions remain independently safe to (re)attempt based on
   * their own current persisted state, so a caller must never treat
   * `"duplicate"` as proof that no further work remains.
   */
  recordIfNew(input: NewPaymentWebhookEventInput): Promise<RecordPaymentWebhookEventResult>;
}
