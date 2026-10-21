import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetCurrentUser, mockAdjustProductStock } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockAdjustProductStock: vi.fn(),
}));

vi.mock("@/modules/identity", () => ({
  getCurrentUser: mockGetCurrentUser,
  isAdminUser: (user: { role: string } | null) => user?.role === "ADMIN",
}));

vi.mock("@/modules/catalog", () => ({
  adjustProductStock: mockAdjustProductStock,
}));

const { POST } = await import("@/app/api/admin/inventory/[productId]/adjust/route");

const ADMIN_USER = { id: "admin-1", email: "admin@example.com", role: "ADMIN" };
const CUSTOMER_USER = { id: "customer-1", email: "customer@example.com", role: "CUSTOMER" };

function makeParams(productId: string) {
  return { params: Promise.resolve({ productId }) };
}

function makePostRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/inventory/product-1/adjust", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/inventory/[productId]/adjust — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with 401 when there is no session, never calling adjustProductStock", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);
    const response = await POST(
      makePostRequest({ quantityChange: 5, reason: "test" }),
      makeParams("product-1"),
    );
    expect(response.status).toBe(401);
    expect(mockAdjustProductStock).not.toHaveBeenCalled();
  });

  it("rejects with 403 for an authenticated non-admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(CUSTOMER_USER);
    const response = await POST(
      makePostRequest({ quantityChange: 5, reason: "test" }),
      makeParams("product-1"),
    );
    expect(response.status).toBe(403);
    expect(mockAdjustProductStock).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body with 400", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    const request = new Request("http://localhost/api/admin/inventory/product-1/adjust", {
      method: "POST",
      body: "not json",
    });
    const response = await POST(request, makeParams("product-1"));
    expect(response.status).toBe(400);
    expect(mockAdjustProductStock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/inventory/[productId]/adjust — validation and outcome mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue(ADMIN_USER);
  });

  it("includes the route's productId and the authenticated admin's id in the call, even if the body omits/spoofs productId", async () => {
    mockAdjustProductStock.mockResolvedValueOnce({
      ok: true,
      result: { outcome: "applied", adjustment: {}, stockQuantity: 10 },
    });
    await POST(
      makePostRequest({ productId: "someone-elses-product", quantityChange: 5, reason: "test" }),
      makeParams("product-1"),
    );
    expect(mockAdjustProductStock).toHaveBeenCalledWith(
      { productId: "product-1", quantityChange: 5, reason: "test" },
      "admin-1",
    );
  });

  it("returns 400 with the validation error when adjustProductStock reports one", async () => {
    mockAdjustProductStock.mockResolvedValueOnce({ ok: false, error: "MISSING_REASON" });
    const response = await POST(
      makePostRequest({ quantityChange: 5, reason: "" }),
      makeParams("product-1"),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "MISSING_REASON" });
  });

  it("returns 200 with the adjustment and new stockQuantity when applied", async () => {
    mockAdjustProductStock.mockResolvedValueOnce({
      ok: true,
      result: {
        outcome: "applied",
        adjustment: { id: "adjustment-1", quantityChange: 5 },
        stockQuantity: 15,
      },
    });
    const response = await POST(
      makePostRequest({ quantityChange: 5, reason: "Restock" }),
      makeParams("product-1"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      adjustment: { id: "adjustment-1", quantityChange: 5 },
      stockQuantity: 15,
    });
  });

  it("returns 400 when the repository reports wouldGoNegative", async () => {
    mockAdjustProductStock.mockResolvedValueOnce({
      ok: true,
      result: { outcome: "wouldGoNegative", currentStockQuantity: 2 },
    });
    const response = await POST(
      makePostRequest({ quantityChange: -5, reason: "Correction" }),
      makeParams("product-1"),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when the repository reports belowActiveReservations", async () => {
    mockAdjustProductStock.mockResolvedValueOnce({
      ok: true,
      result: { outcome: "belowActiveReservations", currentStockQuantity: 10, activeReserved: 8 },
    });
    const response = await POST(
      makePostRequest({ quantityChange: -5, reason: "Correction" }),
      makeParams("product-1"),
    );
    expect(response.status).toBe(400);
  });

  it("returns 404 when the repository reports productNotFound", async () => {
    mockAdjustProductStock.mockResolvedValueOnce({
      ok: true,
      result: { outcome: "productNotFound" },
    });
    const response = await POST(
      makePostRequest({ quantityChange: 5, reason: "test" }),
      makeParams("nonexistent"),
    );
    expect(response.status).toBe(404);
  });

  it("returns 500 without leaking the underlying error when adjustProductStock throws", async () => {
    mockAdjustProductStock.mockRejectedValueOnce(new Error("db exploded"));
    const response = await POST(
      makePostRequest({ quantityChange: 5, reason: "test" }),
      makeParams("product-1"),
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "INTERNAL_ERROR" });
  });
});
