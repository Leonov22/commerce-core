import { describe, expect, it } from "vitest";
import { computeCheckoutSubmissionFingerprint } from "@/modules/order/application/idempotency";
import type {
  CheckoutOrderCustomer,
  CheckoutOrderItemRequest,
} from "@/modules/order/application/checkout-order";

const customer: CheckoutOrderCustomer = {
  firstName: "John",
  lastName: "Smith",
  email: "john.smith@example.com",
  phone: "+421 900 123 456",
};

const items: CheckoutOrderItemRequest[] = [
  { productId: "1", quantity: 1 },
  { productId: "3", quantity: 2 },
];

describe("computeCheckoutSubmissionFingerprint", () => {
  it("is deterministic for identical input", () => {
    const a = computeCheckoutSubmissionFingerprint({
      customer,
      items,
      deliveryAmountMinor: 800,
      locale: "en",
      userId: null,
    });
    const b = computeCheckoutSubmissionFingerprint({
      customer,
      items,
      deliveryAmountMinor: 800,
      locale: "en",
      userId: null,
    });
    expect(a).toBe(b);
  });

  it("is unaffected by item array order", () => {
    const a = computeCheckoutSubmissionFingerprint({
      customer,
      items: [
        { productId: "1", quantity: 1 },
        { productId: "3", quantity: 2 },
      ],
      deliveryAmountMinor: 800,
      locale: "en",
      userId: null,
    });
    const b = computeCheckoutSubmissionFingerprint({
      customer,
      items: [
        { productId: "3", quantity: 2 },
        { productId: "1", quantity: 1 },
      ],
      deliveryAmountMinor: 800,
      locale: "en",
      userId: null,
    });
    expect(a).toBe(b);
  });

  it("differs when a quantity differs", () => {
    const a = computeCheckoutSubmissionFingerprint({
      customer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
      userId: null,
    });
    const b = computeCheckoutSubmissionFingerprint({
      customer,
      items: [{ productId: "1", quantity: 2 }],
      deliveryAmountMinor: 800,
      locale: "en",
      userId: null,
    });
    expect(a).not.toBe(b);
  });

  it("differs when the item set differs", () => {
    const a = computeCheckoutSubmissionFingerprint({
      customer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
      userId: null,
    });
    const b = computeCheckoutSubmissionFingerprint({
      customer,
      items: [{ productId: "2", quantity: 1 }],
      deliveryAmountMinor: 800,
      locale: "en",
      userId: null,
    });
    expect(a).not.toBe(b);
  });

  it("differs when a customer field differs", () => {
    const a = computeCheckoutSubmissionFingerprint({
      customer,
      items,
      deliveryAmountMinor: 800,
      locale: "en",
      userId: null,
    });
    const b = computeCheckoutSubmissionFingerprint({
      customer: { ...customer, email: "someone-else@example.com" },
      items,
      deliveryAmountMinor: 800,
      locale: "en",
      userId: null,
    });
    expect(a).not.toBe(b);
  });

  it("differs when deliveryAmountMinor differs", () => {
    const a = computeCheckoutSubmissionFingerprint({
      customer,
      items,
      deliveryAmountMinor: 800,
      locale: "en",
      userId: null,
    });
    const b = computeCheckoutSubmissionFingerprint({
      customer,
      items,
      deliveryAmountMinor: 1800,
      locale: "en",
      userId: null,
    });
    expect(a).not.toBe(b);
  });

  it("differs between a guest (null userId) and an authenticated user with an otherwise identical submission", () => {
    const guest = computeCheckoutSubmissionFingerprint({
      customer,
      items,
      deliveryAmountMinor: 800,
      locale: "en",
      userId: null,
    });
    const authenticated = computeCheckoutSubmissionFingerprint({
      customer,
      items,
      deliveryAmountMinor: 800,
      locale: "en",
      userId: "user-a",
    });
    expect(guest).not.toBe(authenticated);
  });

  it("differs between two different authenticated users with an otherwise identical submission", () => {
    const userA = computeCheckoutSubmissionFingerprint({
      customer,
      items,
      deliveryAmountMinor: 800,
      locale: "en",
      userId: "user-a",
    });
    const userB = computeCheckoutSubmissionFingerprint({
      customer,
      items,
      deliveryAmountMinor: 800,
      locale: "en",
      userId: "user-b",
    });
    expect(userA).not.toBe(userB);
  });

  /**
   * CR-031-01: `locale` materially affects the persisted Order snapshot —
   * Checkout resolves localized Catalog product names/text through it — so
   * it must be part of the fingerprint, exactly like every other field that
   * changes what gets persisted.
   */
  describe("CR-031-01: locale", () => {
    it("same request + same locale -> same fingerprint", () => {
      const a = computeCheckoutSubmissionFingerprint({
        customer,
        items,
        deliveryAmountMinor: 800,
        locale: "en",
        userId: null,
      });
      const b = computeCheckoutSubmissionFingerprint({
        customer,
        items,
        deliveryAmountMinor: 800,
        locale: "en",
        userId: null,
      });
      expect(a).toBe(b);
    });

    it("same request + different locale -> different fingerprint", () => {
      const en = computeCheckoutSubmissionFingerprint({
        customer,
        items,
        deliveryAmountMinor: 800,
        locale: "en",
        userId: null,
      });
      const fr = computeCheckoutSubmissionFingerprint({
        customer,
        items,
        deliveryAmountMinor: 800,
        locale: "fr",
        userId: null,
      });
      expect(en).not.toBe(fr);
    });

    it("locale is compared as an opaque value — no normalization that would make two distinct locales collide", () => {
      // Guards against a naive implementation that, say, lowercases or
      // truncates locale in a way that could make two genuinely different
      // effective locales hash identically.
      const en = computeCheckoutSubmissionFingerprint({
        customer,
        items,
        deliveryAmountMinor: 800,
        locale: "en",
        userId: null,
      });
      const enUS = computeCheckoutSubmissionFingerprint({
        customer,
        items,
        deliveryAmountMinor: 800,
        locale: "en-US",
        userId: null,
      });
      expect(en).not.toBe(enUS);
    });
  });
});
