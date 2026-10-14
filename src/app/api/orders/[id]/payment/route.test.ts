import { describe, expect, it, vi } from "vitest";

/**
 * Mirrors `api/orders/route.test.ts`'s CR029-03 pattern and
 * `api/webhooks/stripe/route.test.ts`'s pattern exactly: importing
 * `route.ts` directly under Vitest would otherwise transitively evaluate
 * `@/modules/order`'s barrel (re-exports `.tsx` presentation components
 * this project's Vitest config has no JSX transform for). `vi.mock`
 * replaces all three of this route's module-level dependencies before it
 * loads, so the real (JSX-containing) chain is never evaluated.
 */
const { mockGetCurrentUser, mockGetCustomerOrder, mockStartOrderPayment, mockGetPaymentForOrder } =
  vi.hoisted(() => ({
    mockGetCurrentUser: vi.fn(),
    mockGetCustomerOrder: vi.fn(),
    mockStartOrderPayment: vi.fn(),
    mockGetPaymentForOrder: vi.fn(),
  }));

vi.mock("@/modules/identity", () => ({
  getCurrentUser: mockGetCurrentUser,
}));

vi.mock("@/modules/order", () => ({
  getCustomerOrder: mockGetCustomerOrder,
}));

vi.mock("@/modules/payment", () => ({
  startOrderPayment: mockStartOrderPayment,
  getPaymentForOrder: mockGetPaymentForOrder,
}));

const paymentRouteModule = await import("@/app/api/orders/[id]/payment/route");
const { GET, POST } = paymentRouteModule;

const ORDER_ID = "order-1";

function makeRequest(method: "GET" | "POST"): Request {
  return new Request(`http://localhost/api/orders/${ORDER_ID}/payment`, { method });
}

function routeContext() {
  return { params: Promise.resolve({ id: ORDER_ID }) };
}

function resetMocks() {
  mockGetCurrentUser.mockReset();
  mockGetCustomerOrder.mockReset();
  mockStartOrderPayment.mockReset();
  mockGetPaymentForOrder.mockReset();
}

const fakeOrder = { id: ORDER_ID, status: "PENDING" };
const fakePayment = { id: "payment-1", status: "PENDING" };

describe("GET /api/orders/[id]/payment", () => {
  it("returns 401 UNAUTHENTICATED and never looks up the order when there is no session", async () => {
    resetMocks();
    mockGetCurrentUser.mockResolvedValueOnce(null);

    const response = await GET(makeRequest("GET"), routeContext());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHENTICATED" });
    expect(mockGetCustomerOrder).not.toHaveBeenCalled();
  });

  it("returns 404 ORDER_NOT_FOUND when the order doesn't exist or doesn't belong to this customer — indistinguishably", async () => {
    resetMocks();
    mockGetCurrentUser.mockResolvedValueOnce({ id: "user-1" });
    mockGetCustomerOrder.mockResolvedValueOnce(null);

    const response = await GET(makeRequest("GET"), routeContext());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "ORDER_NOT_FOUND" });
  });

  it("resolves ownership via getCustomerOrder using the session's own userId, never a client-supplied one", async () => {
    resetMocks();
    mockGetCurrentUser.mockResolvedValueOnce({ id: "user-1" });
    mockGetCustomerOrder.mockResolvedValueOnce(fakeOrder);
    mockGetPaymentForOrder.mockResolvedValueOnce(null);

    await GET(makeRequest("GET"), routeContext());

    expect(mockGetCustomerOrder).toHaveBeenCalledWith("user-1", ORDER_ID);
  });

  it("returns orderStatus and a null paymentStatus when no Payment exists yet", async () => {
    resetMocks();
    mockGetCurrentUser.mockResolvedValueOnce({ id: "user-1" });
    mockGetCustomerOrder.mockResolvedValueOnce(fakeOrder);
    mockGetPaymentForOrder.mockResolvedValueOnce(null);

    const response = await GET(makeRequest("GET"), routeContext());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ orderStatus: "PENDING", paymentStatus: null });
  });

  it("returns the current Payment status when one exists", async () => {
    resetMocks();
    mockGetCurrentUser.mockResolvedValueOnce({ id: "user-1" });
    mockGetCustomerOrder.mockResolvedValueOnce(fakeOrder);
    mockGetPaymentForOrder.mockResolvedValueOnce({ ...fakePayment, status: "SUCCEEDED" });

    const response = await GET(makeRequest("GET"), routeContext());

    expect(await response.json()).toEqual({ orderStatus: "PENDING", paymentStatus: "SUCCEEDED" });
  });

  it("returns 500 INTERNAL_ERROR and never leaks the underlying error when reading status throws", async () => {
    resetMocks();
    mockGetCurrentUser.mockResolvedValueOnce({ id: "user-1" });
    mockGetCustomerOrder.mockResolvedValueOnce(fakeOrder);
    mockGetPaymentForOrder.mockRejectedValueOnce(
      new Error("simulated database connection string leak"),
    );

    const response = await GET(makeRequest("GET"), routeContext());

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toEqual({ error: "INTERNAL_ERROR" });
    expect(JSON.stringify(json)).not.toContain("connection string");
  });
});

describe("POST /api/orders/[id]/payment", () => {
  it("returns 401 UNAUTHENTICATED and never calls startOrderPayment when there is no session", async () => {
    resetMocks();
    mockGetCurrentUser.mockResolvedValueOnce(null);

    const response = await POST(makeRequest("POST"), routeContext());

    expect(response.status).toBe(401);
    expect(mockStartOrderPayment).not.toHaveBeenCalled();
  });

  it("returns 404 ORDER_NOT_FOUND for an order that doesn't exist or isn't owned by this customer", async () => {
    resetMocks();
    mockGetCurrentUser.mockResolvedValueOnce({ id: "user-1" });
    mockGetCustomerOrder.mockResolvedValueOnce(null);

    const response = await POST(makeRequest("POST"), routeContext());

    expect(response.status).toBe(404);
    expect(mockStartOrderPayment).not.toHaveBeenCalled();
  });

  it("returns 200 with the clientSecret on success", async () => {
    resetMocks();
    mockGetCurrentUser.mockResolvedValueOnce({ id: "user-1" });
    mockGetCustomerOrder.mockResolvedValueOnce(fakeOrder);
    mockStartOrderPayment.mockResolvedValueOnce({
      ok: true,
      payment: fakePayment,
      clientSecret: "cs_test_123",
    });

    const response = await POST(makeRequest("POST"), routeContext());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      clientSecret: "cs_test_123",
      orderStatus: "PENDING",
      paymentStatus: "PENDING",
    });
  });

  it.each([
    ["ORDER_ALREADY_PAID", 409],
    ["ORDER_CANCELLED", 409],
    ["PROVIDER_ERROR", 502],
  ] as const)("maps %s to HTTP %i without leaking internals", async (error, expectedStatus) => {
    resetMocks();
    mockGetCurrentUser.mockResolvedValueOnce({ id: "user-1" });
    mockGetCustomerOrder.mockResolvedValueOnce(fakeOrder);
    mockStartOrderPayment.mockResolvedValueOnce({ ok: false, error });

    const response = await POST(makeRequest("POST"), routeContext());

    expect(response.status).toBe(expectedStatus);
    expect(await response.json()).toEqual({ error });
  });

  it.each(["SUCCEEDED", "FAILED", "CANCELLED"] as const)(
    "IMP-041: maps PAYMENT_NOT_PENDING to HTTP 409 including the current paymentStatus (%s), so the client can distinguish already-paid from already-failed",
    async (paymentStatus) => {
      resetMocks();
      mockGetCurrentUser.mockResolvedValueOnce({ id: "user-1" });
      mockGetCustomerOrder.mockResolvedValueOnce(fakeOrder);
      mockStartOrderPayment.mockResolvedValueOnce({
        ok: false,
        error: "PAYMENT_NOT_PENDING",
        payment: { ...fakePayment, status: paymentStatus },
      });

      const response = await POST(makeRequest("POST"), routeContext());

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "PAYMENT_NOT_PENDING",
        paymentStatus,
      });
    },
  );

  it("returns 500 INTERNAL_ERROR and never leaks the underlying error when startOrderPayment throws", async () => {
    resetMocks();
    mockGetCurrentUser.mockResolvedValueOnce({ id: "user-1" });
    mockGetCustomerOrder.mockResolvedValueOnce(fakeOrder);
    mockStartOrderPayment.mockRejectedValueOnce(
      new Error("simulated Stripe secret key sk_live_super_secret failure"),
    );

    const response = await POST(makeRequest("POST"), routeContext());

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toEqual({ error: "INTERNAL_ERROR" });
    expect(JSON.stringify(json)).not.toContain("sk_live_super_secret");
  });

  it("passes only the orderId resolved from the URL to startOrderPayment — never a client-supplied amount/currency/status", async () => {
    resetMocks();
    mockGetCurrentUser.mockResolvedValueOnce({ id: "user-1" });
    mockGetCustomerOrder.mockResolvedValueOnce(fakeOrder);
    mockStartOrderPayment.mockResolvedValueOnce({
      ok: true,
      payment: fakePayment,
      clientSecret: "cs_test_123",
    });

    await POST(makeRequest("POST"), routeContext());

    expect(mockStartOrderPayment).toHaveBeenCalledWith(ORDER_ID);
    expect(mockStartOrderPayment).toHaveBeenCalledTimes(1);
  });
});
