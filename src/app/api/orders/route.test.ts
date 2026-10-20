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

const orderRouteModule = await import("@/app/api/orders/route");
const { POST } = orderRouteModule;

const VALID_IDEMPOTENCY_KEY = "test-idempotency-key-aaaaaaaa";

/**
 * Account-first checkout: `POST /api/orders` now requires a session (see
 * `route.ts`'s own doc comment) — every test below that isn't specifically
 * about the unauthenticated-rejection case itself must mock an
 * authenticated user, since `getCurrentUser()` resolving to `null` is no
 * longer a "guest, proceed anyway" case; it is now a 401.
 */
const AUTHENTICATED_USER = {
  id: "real-user-a",
  email: "a@example.com",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": VALID_IDEMPOTENCY_KEY,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/** Builds a request with no `Idempotency-Key` header at all (IMP-031). */
function makeRequestWithoutIdempotencyKey(body: unknown): Request {
  const request = makeRequest(body);
  request.headers.delete("Idempotency-Key");
  return request;
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
    mockGetCurrentUser.mockResolvedValueOnce(AUTHENTICATED_USER);
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

  it("ignores a client-supplied userId even when the field is absent entirely, using the authenticated session's id instead", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(AUTHENTICATED_USER);
    mockCreateOrderFromCheckout.mockResolvedValueOnce({
      ok: true,
      order: {
        id: "order-3",
        status: "PENDING",
        userId: AUTHENTICATED_USER.id,
        subtotalAmountMinor: 100,
        deliveryAmountMinor: 0,
        totalAmountMinor: 100,
        currency: "USD",
      },
    });

    const response = await POST(makeRequest(validBody()));

    expect(response.status).toBe(201);
    const callArg = mockCreateOrderFromCheckout.mock.calls[0]?.[0];
    expect(callArg.userId).toBe(AUTHENTICATED_USER.id);
  });

  it("ignores a client-supplied status in the checkout body — initial status is never client-selectable (IMP-030)", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(AUTHENTICATED_USER);
    mockCreateOrderFromCheckout.mockResolvedValueOnce({
      ok: true,
      order: {
        id: "order-4",
        status: "PENDING",
        userId: AUTHENTICATED_USER.id,
        subtotalAmountMinor: 100,
        deliveryAmountMinor: 0,
        totalAmountMinor: 100,
        currency: "USD",
      },
    });

    const response = await POST(makeRequest(validBody({ status: "PAID" })));

    expect(response.status).toBe(201);
    // `createOrderFromCheckout` was never even given a `status` field to
    // trust — it hardcodes PENDING internally (see checkout-order.ts).
    const callArg = mockCreateOrderFromCheckout.mock.calls[0]?.[0];
    expect(callArg.status).toBeUndefined();
  });
});

describe("POST /api/orders — account-first checkout requires an authenticated session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with 401 UNAUTHENTICATED when there is no session, and never calls createOrderFromCheckout", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);

    const response = await POST(makeRequest(validBody()));

    expect(response.status).toBe(401);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("UNAUTHENTICATED");
    expect(mockCreateOrderFromCheckout).not.toHaveBeenCalled();
  });

  it("rejects with 401 even when a client-supplied userId is present in the body — guest checkout cannot be reinstated by supplying one", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);

    const response = await POST(makeRequest(validBody({ userId: "someone-else" })));

    expect(response.status).toBe(401);
    expect(mockCreateOrderFromCheckout).not.toHaveBeenCalled();
  });

  it("checks authentication before Catalog/order creation runs, but after the Idempotency-Key header and request-body checks (consistent with the route's own existing validation order)", async () => {
    // Deliberately does NOT mock `getCurrentUser` at all — the missing
    // Idempotency-Key header must be rejected before the route ever calls
    // it, so no queued return value should be consumed by this test (and
    // none must be left dangling to leak into a later, unrelated test).
    const response = await POST(makeRequestWithoutIdempotencyKey(validBody()));

    // The missing-header check fires first — 400, not 401 — proving
    // authentication isn't checked before more fundamental request
    // validity, while still never reaching order creation either way.
    expect(response.status).toBe(400);
    expect(mockGetCurrentUser).not.toHaveBeenCalled();
    expect(mockCreateOrderFromCheckout).not.toHaveBeenCalled();
  });
});

describe("api/orders/route module surface — no Customer-facing status mutation (IMP-030)", () => {
  it("exports only POST — no PATCH/PUT/DELETE handler exists for Customers to mutate Order status", () => {
    const exported = orderRouteModule as unknown as Record<string, unknown>;
    expect(typeof exported.POST).toBe("function");
    expect(exported.PATCH).toBeUndefined();
    expect(exported.PUT).toBeUndefined();
    expect(exported.DELETE).toBeUndefined();
  });
});

describe("POST /api/orders — Idempotency-Key header contract (IMP-031)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a request with no Idempotency-Key header at all, and never calls createOrderFromCheckout", async () => {
    const response = await POST(makeRequestWithoutIdempotencyKey(validBody()));

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(mockCreateOrderFromCheckout).not.toHaveBeenCalled();
  });

  it("rejects an Idempotency-Key shorter than the minimum length", async () => {
    const response = await POST(makeRequest(validBody(), { "Idempotency-Key": "short" }));

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("INVALID_IDEMPOTENCY_KEY");
    expect(mockCreateOrderFromCheckout).not.toHaveBeenCalled();
  });

  it("rejects an Idempotency-Key longer than the maximum length", async () => {
    const response = await POST(makeRequest(validBody(), { "Idempotency-Key": "a".repeat(200) }));

    expect(response.status).toBe(400);
    expect(mockCreateOrderFromCheckout).not.toHaveBeenCalled();
  });

  it("rejects an Idempotency-Key containing characters outside the safe charset", async () => {
    const response = await POST(
      makeRequest(validBody(), { "Idempotency-Key": "not a valid key! <script>" }),
    );

    expect(response.status).toBe(400);
    expect(mockCreateOrderFromCheckout).not.toHaveBeenCalled();
  });

  it("does not read an idempotency key from the JSON body — only the header is honored", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(AUTHENTICATED_USER);
    mockCreateOrderFromCheckout.mockResolvedValueOnce({
      ok: true,
      created: true,
      order: {
        id: "order-idem-1",
        status: "PENDING",
        userId: AUTHENTICATED_USER.id,
        subtotalAmountMinor: 100,
        deliveryAmountMinor: 0,
        totalAmountMinor: 100,
        currency: "USD",
      },
    });

    const response = await POST(
      makeRequest(validBody({ idempotencyKey: "body-supplied-key-aaaaaaaaaaaaaa" })),
    );

    expect(response.status).toBe(201);
    const callArg = mockCreateOrderFromCheckout.mock.calls[0]?.[0];
    // The header's value (from `makeRequest`'s default), never the body field.
    expect(callArg.idempotencyKey).toBe(VALID_IDEMPOTENCY_KEY);
  });

  it("passes a valid Idempotency-Key header through to createOrderFromCheckout", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(AUTHENTICATED_USER);
    mockCreateOrderFromCheckout.mockResolvedValueOnce({
      ok: true,
      created: true,
      order: {
        id: "order-idem-2",
        status: "PENDING",
        userId: AUTHENTICATED_USER.id,
        subtotalAmountMinor: 100,
        deliveryAmountMinor: 0,
        totalAmountMinor: 100,
        currency: "USD",
      },
    });

    const response = await POST(
      makeRequest(validBody(), { "Idempotency-Key": "a-perfectly-valid-key-123456" }),
    );

    expect(response.status).toBe(201);
    const callArg = mockCreateOrderFromCheckout.mock.calls[0]?.[0];
    expect(callArg.idempotencyKey).toBe("a-perfectly-valid-key-123456");
  });
});

describe("POST /api/orders — idempotency result handling (IMP-031)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 201 when createOrderFromCheckout reports created: true", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(AUTHENTICATED_USER);
    mockCreateOrderFromCheckout.mockResolvedValueOnce({
      ok: true,
      created: true,
      order: {
        id: "order-created",
        status: "PENDING",
        userId: AUTHENTICATED_USER.id,
        subtotalAmountMinor: 100,
        deliveryAmountMinor: 0,
        totalAmountMinor: 100,
        currency: "USD",
      },
    });

    const response = await POST(makeRequest(validBody()));
    expect(response.status).toBe(201);
    const json = (await response.json()) as { order: { id: string } };
    expect(json.order.id).toBe("order-created");
  });

  it("returns 200 (not 201) when createOrderFromCheckout reports created: false — a replayed submission, not a new Order", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(AUTHENTICATED_USER);
    mockCreateOrderFromCheckout.mockResolvedValueOnce({
      ok: true,
      created: false,
      order: {
        id: "order-replayed",
        status: "PENDING",
        userId: AUTHENTICATED_USER.id,
        subtotalAmountMinor: 100,
        deliveryAmountMinor: 0,
        totalAmountMinor: 100,
        currency: "USD",
      },
    });

    const response = await POST(makeRequest(validBody()));
    expect(response.status).toBe(200);
    const json = (await response.json()) as { order: { id: string } };
    expect(json.order.id).toBe("order-replayed");
  });

  it("returns 409 IDEMPOTENCY_KEY_CONFLICT when the key was already used for a different submission, and never leaks the other Order", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(AUTHENTICATED_USER);
    mockCreateOrderFromCheckout.mockResolvedValueOnce({
      ok: false,
      error: "IDEMPOTENCY_KEY_CONFLICT",
    });

    const response = await POST(makeRequest(validBody()));
    expect(response.status).toBe(409);
    const json = (await response.json()) as { error: string; order?: unknown };
    expect(json.error).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(json.order).toBeUndefined();
  });
});

/**
 * IMP-048 Increment 3 / CR-2 remediation (round 3): `INSUFFICIENT_STOCK`
 * and `RESERVATION_CLEANUP_INCOMPLETE` previously fell through this
 * route's generic `default:` switch arm (a safe, but semantically wrong,
 * 500 `INTERNAL_ERROR` for the former — a legitimate business outcome the
 * customer's own cart caused, not a server fault). Both now have their
 * own explicit, intentional mapping.
 */
describe("POST /api/orders — inventory reservation result mapping (IMP-048 Increment 3)", () => {
  it("returns 409 INSUFFICIENT_STOCK with the affected product ids — not a generic 500 — when checkout's stock reservation fails", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(AUTHENTICATED_USER);
    mockCreateOrderFromCheckout.mockResolvedValueOnce({
      ok: false,
      error: "INSUFFICIENT_STOCK",
      productIds: ["prod-1"],
    });

    const response = await POST(makeRequest(validBody()));
    expect(response.status).toBe(409);
    const json = (await response.json()) as { error: string; productIds?: string[] };
    expect(json.error).toBe("INSUFFICIENT_STOCK");
    expect(json.productIds).toEqual(["prod-1"]);
  });

  it("returns a generic 500 INTERNAL_ERROR, with no product ids or internal detail, when reservation cleanup could not be confirmed", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(AUTHENTICATED_USER);
    mockCreateOrderFromCheckout.mockResolvedValueOnce({
      ok: false,
      error: "RESERVATION_CLEANUP_INCOMPLETE",
      productIds: ["prod-1"],
    });

    const response = await POST(makeRequest(validBody()));
    expect(response.status).toBe(500);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json).toEqual({ error: "INTERNAL_ERROR" });
  });
});
