import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CR029-03: verifies the actual transport boundary. Importing `route.ts`
 * directly under Vitest is otherwise blocked — it statically imports
 * `@/modules/checkout` and `@/modules/identity`, and both modules'
 * `index.ts` barrels re-export `.tsx` presentation components; this
 * project's Vitest config has no JSX/React transform, so evaluating those
 * real files fails (the same limitation documented for
 * `api/orders/validate-request-body.ts` since IMP-026-FIX). `vi.mock`
 * replaces all three of `route.ts`'s module-level dependencies before it
 * loads, so the real (JSX-containing) files are never evaluated at all —
 * this lets the real route handler run under test without introducing any
 * new testing framework or dependency.
 */
const { mockGetCurrentUser, mockCreateOrderFromCheckout } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockCreateOrderFromCheckout: vi.fn(),
}));

vi.mock("@/modules/identity", () => ({
  getCurrentUser: mockGetCurrentUser,
}));

vi.mock("@/modules/order", () => ({
  createOrderFromCheckout: mockCreateOrderFromCheckout,
  MAX_QUANTITY_PER_ITEM: 100,
}));

vi.mock("@/modules/checkout", () => ({
  validateCustomerInformation: () => ({}),
  getDeliveryAmountMinor: (method: string) => (method === "standard" ? 800 : null),
}));

const { POST } = await import("@/app/api/orders/route");

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody(extra: Record<string, unknown> = {}) {
  return {
    customer: { firstName: "A", lastName: "A", email: "a@example.com", phone: "+1234567890" },
    items: [{ productId: "1", quantity: 1 }],
    deliveryMethod: "standard",
    locale: "en",
    ...extra,
  };
}

describe("POST /api/orders — ownership cannot be overridden by the client (CR029-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the authenticated session's user id, ignoring a client-supplied userId in the body", async () => {
    mockGetCurrentUser.mockResolvedValueOnce({
      id: "real-user-a",
      email: "a@example.com",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockCreateOrderFromCheckout.mockResolvedValueOnce({
      ok: true,
      order: {
        id: "order-1",
        status: "PENDING",
        userId: "real-user-a",
        subtotalAmountMinor: 100,
        deliveryAmountMinor: 0,
        totalAmountMinor: 100,
        currency: "USD",
      },
    });

    const response = await POST(makeRequest(validBody({ userId: "malicious-user-b" })));

    expect(response.status).toBe(201);
    expect(mockCreateOrderFromCheckout).toHaveBeenCalledTimes(1);
    const callArg = mockCreateOrderFromCheckout.mock.calls[0]?.[0];
    expect(callArg.userId).toBe("real-user-a");
    expect(callArg.userId).not.toBe("malicious-user-b");
  });

  it("uses null (guest) when there is no authenticated session, regardless of a client-supplied userId", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);
    mockCreateOrderFromCheckout.mockResolvedValueOnce({
      ok: true,
      order: {
        id: "order-2",
        status: "PENDING",
        userId: null,
        subtotalAmountMinor: 100,
        deliveryAmountMinor: 0,
        totalAmountMinor: 100,
        currency: "USD",
      },
    });

    const response = await POST(makeRequest(validBody({ userId: "malicious-user-b" })));

    expect(response.status).toBe(201);
    const callArg = mockCreateOrderFromCheckout.mock.calls[0]?.[0];
    expect(callArg.userId).toBeNull();
  });

  it("ignores a client-supplied userId even when the field is absent entirely for a guest session", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);
    mockCreateOrderFromCheckout.mockResolvedValueOnce({
      ok: true,
      order: {
        id: "order-3",
        status: "PENDING",
        userId: null,
        subtotalAmountMinor: 100,
        deliveryAmountMinor: 0,
        totalAmountMinor: 100,
        currency: "USD",
      },
    });

    const response = await POST(makeRequest(validBody()));

    expect(response.status).toBe(201);
    const callArg = mockCreateOrderFromCheckout.mock.calls[0]?.[0];
    expect(callArg.userId).toBeNull();
  });
});
