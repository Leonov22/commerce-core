import { createHash } from "node:crypto";
import type {
  CheckoutOrderCustomer,
  CheckoutOrderItemRequest,
} from "@/modules/order/application/checkout-order";

/**
 * Identifies a "logical checkout submission" for IMP-031 idempotency —
 * deliberately built only from what the client actually submitted (plus the
 * server-resolved `userId`, which is what makes cross-user key reuse
 * detectable), never from server-resolved Catalog data (product name, unit
 * price). Hashing resolved prices would make a legitimate retry falsely
 * look like a "different submission" if a Catalog price changed between
 * attempts — the client's cart didn't change, so the retry must still match.
 *
 * CR-031-01: `locale` is included because it materially affects the
 * persisted Order snapshot — Checkout resolves localized Catalog product
 * names through it, so the same cart submitted under two different locales
 * is not the same logical submission and must not be treated as a replay.
 * This is the *effective* locale `createOrderFromCheckout` actually uses to
 * resolve Catalog data (already normalized/validated by the API route
 * before this function ever runs — see `route.ts`'s `routing.locales`
 * check), not an arbitrary raw client field.
 */
export interface CheckoutSubmissionFingerprintInput {
  customer: CheckoutOrderCustomer;
  items: CheckoutOrderItemRequest[];
  deliveryAmountMinor: number;
  /** The effective locale used to resolve Catalog data for this submission. */
  locale: string;
  /** The server-resolved requester, `null` for guest — never client input. */
  userId: string | null;
}

/**
 * Deterministic fingerprint of a checkout submission, used to tell a
 * genuine retry (same key, same logical request → return the existing
 * Order) apart from a conflicting reuse of the same key (same key, a
 * materially different request, including a different resolved user →
 * reject). Item order doesn't affect the result — items are sorted by
 * `productId` first — but item *content* (including quantity) does.
 *
 * Not a security boundary by itself (SHA-256 of non-secret data is not a
 * MAC) — it only needs to be collision-resistant enough to distinguish
 * "same submission" from "different submission", which cryptographic
 * hashing comfortably provides; nothing here is ever used as a credential.
 */
export function computeCheckoutSubmissionFingerprint(
  input: CheckoutSubmissionFingerprintInput,
): string {
  const canonicalItems = input.items
    .map((item) => ({ productId: item.productId, quantity: item.quantity }))
    .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));

  const canonical = JSON.stringify({
    customer: {
      firstName: input.customer.firstName,
      lastName: input.customer.lastName,
      email: input.customer.email,
      phone: input.customer.phone,
    },
    items: canonicalItems,
    deliveryAmountMinor: input.deliveryAmountMinor,
    locale: input.locale,
    userId: input.userId,
  });

  return createHash("sha256").update(canonical).digest("hex");
}
