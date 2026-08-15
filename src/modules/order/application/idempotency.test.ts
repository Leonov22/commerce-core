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
      userId: null,
    });
    const b = computeCheckoutSubmissionFingerprint({
      customer,
      items,
      deliveryAmountMinor: 800,
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
      userId: null,
    });
    const b = computeCheckoutSubmissionFingerprint({
      customer,
      items: [
        { productId: "3", quantity: 2 },
        { productId: "1", quantity: 1 },
      ],
      deliveryAmountMinor: 800,
      userId: null,
    });
    expect(a).toBe(b);
  });

  it("differs when a quantity differs", () => {
    const a = computeCheckoutSubmissionFingerprint({
      customer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      userId: null,
    });
    const b = computeCheckoutSubmissionFingerprint({
      customer,
      items: [{ productId: "1", quantity: 2 }],
      deliveryAmountMinor: 800,
      userId: null,
    });
    expect(a).not.toBe(b);
  });

  it("differs when the item set differs", () => {
    const a = computeCheckoutSubmissionFingerprint({
      customer,
      items: [{ productId: "1", quantity: 1 }],
      deliveryAmountMinor: 800,
      userId: null,
    });
    const b = computeCheckoutSubmissionFingerprint({
      customer,
      items: [{ productId: "2", quantity: 1 }],
      deliveryAmountMinor: 800,
      userId: null,
    });
    expect(a).not.toBe(b);
  });

  it("differs when a customer field differs", () => {
    const a = computeCheckoutSubmissionFingerprint({
      customer,
      items,
      deliveryAmountMinor: 800,
      userId: null,
    });
    const b = computeCheckoutSubmissionFingerprint({
      customer: { ...customer, email: "someone-else@example.com" },
      items,
      deliveryAmountMinor: 800,
      userId: null,
    });
    expect(a).not.toBe(b);
  });

  it("differs when deliveryAmountMinor differs", () => {
    const a = computeCheckoutSubmissionFingerprint({
      customer,
      items,
      deliveryAmountMinor: 800,
      userId: null,
    });
    const b = computeCheckoutSubmissionFingerprint({
      customer,
      items,
      deliveryAmountMinor: 1800,
      userId: null,
    });
    expect(a).not.toBe(b);
  });

  it("differs between a guest (null userId) and an authenticated user with an otherwise identical submission", () => {
    const guest = computeCheckoutSubmissionFingerprint({
      customer,
      items,
      deliveryAmountMinor: 800,
      userId: null,
    });
    const authenticated = computeCheckoutSubmissionFingerprint({
      customer,
      items,
      deliveryAmountMinor: 800,
      userId: "user-a",
    });
    expect(guest).not.toBe(authenticated);
  });

  it("differs between two different authenticated users with an otherwise identical submission", () => {
    const userA = computeCheckoutSubmissionFingerprint({
      customer,
      items,
      deliveryAmountMinor: 800,
      userId: "user-a",
    });
    const userB = computeCheckoutSubmissionFingerprint({
      customer,
      items,
      deliveryAmountMinor: 800,
      userId: "user-b",
    });
    expect(userA).not.toBe(userB);
  });
});
