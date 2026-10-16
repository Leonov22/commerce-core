import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetCurrentUser, mockGetAdminProduct, mockUpdateAdminProduct } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockGetAdminProduct: vi.fn(),
  mockUpdateAdminProduct: vi.fn(),
}));

vi.mock("@/modules/identity", () => ({
  getCurrentUser: mockGetCurrentUser,
  isAdminUser: (user: { role: string } | null) => user?.role === "ADMIN",
}));

vi.mock("@/modules/catalog", () => ({
  getAdminProduct: mockGetAdminProduct,
  updateAdminProduct: mockUpdateAdminProduct,
}));

const { GET, PATCH } = await import("@/app/api/admin/products/[id]/route");

const ADMIN_USER = { id: "admin-1", email: "admin@example.com", role: "ADMIN" };
const CUSTOMER_USER = { id: "customer-1", email: "customer@example.com", role: "CUSTOMER" };

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/admin/products/[id] — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with 401 when there is no session", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);
    const response = await GET(new Request("http://localhost"), makeParams("product-1"));
    expect(response.status).toBe(401);
    expect(mockGetAdminProduct).not.toHaveBeenCalled();
  });

  it("rejects with 403 for an authenticated non-admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(CUSTOMER_USER);
    const response = await GET(new Request("http://localhost"), makeParams("product-1"));
    expect(response.status).toBe(403);
    expect(mockGetAdminProduct).not.toHaveBeenCalled();
  });

  it("returns 404 when the product does not exist", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockGetAdminProduct.mockResolvedValueOnce(null);
    const response = await GET(new Request("http://localhost"), makeParams("nonexistent"));
    expect(response.status).toBe(404);
  });

  it("returns 200 with the product for an authenticated admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockGetAdminProduct.mockResolvedValueOnce({ id: "product-1", status: "DRAFT" });
    const response = await GET(new Request("http://localhost"), makeParams("product-1"));
    expect(response.status).toBe(200);
  });
});

describe("PATCH /api/admin/products/[id] — authorization and status changes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makePatchRequest(body: unknown): Request {
    return new Request("http://localhost/api/admin/products/product-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rejects with 401 when there is no session, and never calls updateAdminProduct", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);
    const response = await PATCH(makePatchRequest({ status: "ARCHIVED" }), makeParams("product-1"));
    expect(response.status).toBe(401);
    expect(mockUpdateAdminProduct).not.toHaveBeenCalled();
  });

  it("rejects with 403 for an authenticated non-admin attempting a status change, and never calls updateAdminProduct", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(CUSTOMER_USER);
    const response = await PATCH(makePatchRequest({ status: "ARCHIVED" }), makeParams("product-1"));
    expect(response.status).toBe(403);
    expect(mockUpdateAdminProduct).not.toHaveBeenCalled();
  });

  it("returns 400 with INVALID_STATUS when updateAdminProduct rejects an unauthorized/invalid status value", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockUpdateAdminProduct.mockResolvedValueOnce({ ok: false, error: "INVALID_STATUS" });

    const response = await PATCH(makePatchRequest({ status: "DELETED" }), makeParams("product-1"));

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("INVALID_STATUS");
  });

  it("returns 404 when updateAdminProduct reports the product does not exist", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockUpdateAdminProduct.mockResolvedValueOnce({ ok: false, error: "NOT_FOUND" });

    const response = await PATCH(
      makePatchRequest({ status: "ARCHIVED" }),
      makeParams("nonexistent"),
    );

    expect(response.status).toBe(404);
  });

  it("archives a product (status change) for an authenticated admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockUpdateAdminProduct.mockResolvedValueOnce({
      ok: true,
      product: { id: "product-1", status: "ARCHIVED" },
    });

    const response = await PATCH(makePatchRequest({ status: "ARCHIVED" }), makeParams("product-1"));

    expect(response.status).toBe(200);
    const json = (await response.json()) as { product: { status: string } };
    expect(json.product.status).toBe("ARCHIVED");
  });
});
