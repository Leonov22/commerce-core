import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetCurrentUser, mockListAdminDiscounts, mockCreateAdminDiscount } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockListAdminDiscounts: vi.fn(),
  mockCreateAdminDiscount: vi.fn(),
}));

vi.mock("@/modules/identity", () => ({
  getCurrentUser: mockGetCurrentUser,
  isAdminUser: (user: { role: string } | null) => user?.role === "ADMIN",
}));

vi.mock("@/modules/catalog", () => ({
  listAdminDiscounts: mockListAdminDiscounts,
  createAdminDiscount: mockCreateAdminDiscount,
}));

const { GET, POST } = await import("@/app/api/admin/discounts/route");

const ADMIN_USER = { id: "admin-1", email: "admin@example.com", role: "ADMIN" };
const CUSTOMER_USER = { id: "customer-1", email: "customer@example.com", role: "CUSTOMER" };

function makeGetRequest(searchParams = ""): Request {
  return new Request(`http://localhost/api/admin/discounts${searchParams}`);
}

function makePostRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/discounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/admin/discounts — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with 401 when there is no session, and never calls listAdminDiscounts", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);
    const response = await GET(makeGetRequest());
    expect(response.status).toBe(401);
    expect(mockListAdminDiscounts).not.toHaveBeenCalled();
  });

  it("rejects with 403 for an authenticated non-admin, and never calls listAdminDiscounts", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(CUSTOMER_USER);
    const response = await GET(makeGetRequest());
    expect(response.status).toBe(403);
    expect(mockListAdminDiscounts).not.toHaveBeenCalled();
  });

  it("returns 200 and calls listAdminDiscounts for an authenticated admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockListAdminDiscounts.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });

    const response = await GET(makeGetRequest());

    expect(response.status).toBe(200);
    expect(mockListAdminDiscounts).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it("parses page/pageSize query params", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockListAdminDiscounts.mockResolvedValueOnce({ items: [], total: 0, page: 2, pageSize: 10 });

    await GET(makeGetRequest("?page=2&pageSize=10"));

    expect(mockListAdminDiscounts).toHaveBeenCalledWith({ page: 2, pageSize: 10 });
  });
});

describe("POST /api/admin/discounts — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with 401 when there is no session, and never calls createAdminDiscount", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);
    const response = await POST(makePostRequest({ productId: "product-1" }));
    expect(response.status).toBe(401);
    expect(mockCreateAdminDiscount).not.toHaveBeenCalled();
  });

  it("rejects with 403 for an authenticated non-admin, and never calls createAdminDiscount", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(CUSTOMER_USER);
    const response = await POST(makePostRequest({ productId: "product-1" }));
    expect(response.status).toBe(403);
    expect(mockCreateAdminDiscount).not.toHaveBeenCalled();
  });

  it("returns 201 for a successful creation by an admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockCreateAdminDiscount.mockResolvedValueOnce({ ok: true, discount: { id: "new-id" } });

    const response = await POST(makePostRequest({ productId: "product-1" }));

    expect(response.status).toBe(201);
    expect(mockCreateAdminDiscount).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when createAdminDiscount reports the product was not found", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockCreateAdminDiscount.mockResolvedValueOnce({ ok: false, error: "PRODUCT_NOT_FOUND" });

    const response = await POST(makePostRequest({ productId: "nonexistent" }));

    expect(response.status).toBe(404);
  });

  it("returns 400 with the validation error code for any other failure", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockCreateAdminDiscount.mockResolvedValueOnce({ ok: false, error: "DISCOUNT_OVERLAP" });

    const response = await POST(makePostRequest({ productId: "product-1" }));

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("DISCOUNT_OVERLAP");
  });

  it("rejects a malformed JSON body with 400, never calling createAdminDiscount", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    const request = new Request("http://localhost/api/admin/discounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not valid json",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(mockCreateAdminDiscount).not.toHaveBeenCalled();
  });
});
