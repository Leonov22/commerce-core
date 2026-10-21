import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetCurrentUser, mockGetAdminInventoryProduct, mockSetProductTrackInventory } =
  vi.hoisted(() => ({
    mockGetCurrentUser: vi.fn(),
    mockGetAdminInventoryProduct: vi.fn(),
    mockSetProductTrackInventory: vi.fn(),
  }));

vi.mock("@/modules/identity", () => ({
  getCurrentUser: mockGetCurrentUser,
  isAdminUser: (user: { role: string } | null) => user?.role === "ADMIN",
}));

vi.mock("@/modules/catalog", () => ({
  getAdminInventoryProduct: mockGetAdminInventoryProduct,
  setProductTrackInventory: mockSetProductTrackInventory,
}));

const { GET, PATCH } = await import("@/app/api/admin/inventory/[productId]/route");

const ADMIN_USER = { id: "admin-1", email: "admin@example.com", role: "ADMIN" };
const CUSTOMER_USER = { id: "customer-1", email: "customer@example.com", role: "CUSTOMER" };

function makeParams(productId: string) {
  return { params: Promise.resolve({ productId }) };
}

function makePatchRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/inventory/product-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/admin/inventory/[productId] — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with 401 when there is no session", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);
    const response = await GET(new Request("http://localhost"), makeParams("product-1"));
    expect(response.status).toBe(401);
    expect(mockGetAdminInventoryProduct).not.toHaveBeenCalled();
  });

  it("rejects with 403 for an authenticated non-admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(CUSTOMER_USER);
    const response = await GET(new Request("http://localhost"), makeParams("product-1"));
    expect(response.status).toBe(403);
    expect(mockGetAdminInventoryProduct).not.toHaveBeenCalled();
  });

  it("returns 404 when the product does not exist", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockGetAdminInventoryProduct.mockResolvedValueOnce(null);
    const response = await GET(new Request("http://localhost"), makeParams("nonexistent"));
    expect(response.status).toBe(404);
  });

  it("returns 200 with the product for an authenticated admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockGetAdminInventoryProduct.mockResolvedValueOnce({ productId: "product-1" });
    const response = await GET(new Request("http://localhost"), makeParams("product-1"));
    expect(response.status).toBe(200);
  });
});

describe("PATCH /api/admin/inventory/[productId] — authorization and outcome mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with 401 when there is no session, never calling setProductTrackInventory", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);
    const response = await PATCH(
      makePatchRequest({ trackInventory: true }),
      makeParams("product-1"),
    );
    expect(response.status).toBe(401);
    expect(mockSetProductTrackInventory).not.toHaveBeenCalled();
  });

  it("rejects with 403 for an authenticated non-admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(CUSTOMER_USER);
    const response = await PATCH(
      makePatchRequest({ trackInventory: true }),
      makeParams("product-1"),
    );
    expect(response.status).toBe(403);
    expect(mockSetProductTrackInventory).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body with 400", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    const request = new Request("http://localhost/api/admin/inventory/product-1", {
      method: "PATCH",
      body: "not json",
    });
    const response = await PATCH(request, makeParams("product-1"));
    expect(response.status).toBe(400);
    expect(mockSetProductTrackInventory).not.toHaveBeenCalled();
  });

  it("passes the authenticated admin's id as adminUserId", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockSetProductTrackInventory.mockResolvedValueOnce({
      outcome: "enabled",
      stockQuantity: 10,
      adjustment: null,
    });
    await PATCH(makePatchRequest({ trackInventory: true }), makeParams("product-1"));
    expect(mockSetProductTrackInventory).toHaveBeenCalledWith(
      "product-1",
      { trackInventory: true },
      "admin-1",
    );
  });

  it.each([
    ["enabled", 200],
    ["disabled", 200],
    ["alreadyEnabled", 409],
    ["alreadyDisabled", 409],
    ["activeReservationsExist", 409],
    ["productNotFound", 404],
    ["wouldGoNegative", 400],
    ["belowActiveReservations", 400],
  ])("maps outcome %s to status %i", async (outcome, expectedStatus) => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    const result =
      outcome === "enabled"
        ? { outcome, stockQuantity: 10, adjustment: null }
        : outcome === "activeReservationsExist"
          ? { outcome, reserved: 2 }
          : outcome === "productNotFound"
            ? { outcome: "productNotFound" }
            : { outcome };
    mockSetProductTrackInventory.mockResolvedValueOnce(result);

    const response = await PATCH(
      makePatchRequest({ trackInventory: true }),
      makeParams("product-1"),
    );
    expect(response.status).toBe(expectedStatus);
  });

  it("maps invalidInput to 400 with the specific validation error code", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockSetProductTrackInventory.mockResolvedValueOnce({
      outcome: "invalidInput",
      error: "INVALID_INITIAL_QUANTITY",
    });
    const response = await PATCH(
      makePatchRequest({ trackInventory: true, initialQuantity: -1 }),
      makeParams("product-1"),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "INVALID_INITIAL_QUANTITY" });
  });

  it("returns 500 without leaking the underlying error when setProductTrackInventory throws", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockSetProductTrackInventory.mockRejectedValueOnce(new Error("db exploded"));
    const response = await PATCH(
      makePatchRequest({ trackInventory: true }),
      makeParams("product-1"),
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "INTERNAL_ERROR" });
  });
});
