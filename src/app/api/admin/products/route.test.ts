import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mirrors `src/app/api/orders/route.test.ts`'s own convention exactly:
 * `vi.mock` replaces `@/modules/identity` and `@/modules/catalog` before
 * `route.ts` loads, since both barrels re-export `.tsx` presentation
 * components this project's Vitest config has no JSX transform for.
 */
const { mockGetCurrentUser, mockListAdminProducts, mockCreateAdminProduct } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockListAdminProducts: vi.fn(),
  mockCreateAdminProduct: vi.fn(),
}));

vi.mock("@/modules/identity", () => ({
  getCurrentUser: mockGetCurrentUser,
  isAdminUser: (user: { role: string } | null) => user?.role === "ADMIN",
}));

vi.mock("@/modules/catalog", () => ({
  listAdminProducts: mockListAdminProducts,
  createAdminProduct: mockCreateAdminProduct,
}));

const { GET, POST } = await import("@/app/api/admin/products/route");

const ADMIN_USER = { id: "admin-1", email: "admin@example.com", role: "ADMIN" };
const CUSTOMER_USER = { id: "customer-1", email: "customer@example.com", role: "CUSTOMER" };

function makeGetRequest(searchParams = ""): Request {
  return new Request(`http://localhost/api/admin/products${searchParams}`);
}

function makePostRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/admin/products — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with 401 when there is no session, and never calls listAdminProducts", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);
    const response = await GET(makeGetRequest());
    expect(response.status).toBe(401);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("UNAUTHENTICATED");
    expect(mockListAdminProducts).not.toHaveBeenCalled();
  });

  it("rejects with 403 when the authenticated user is not an admin, and never calls listAdminProducts", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(CUSTOMER_USER);
    const response = await GET(makeGetRequest());
    expect(response.status).toBe(403);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("FORBIDDEN");
    expect(mockListAdminProducts).not.toHaveBeenCalled();
  });

  it("returns 200 and calls listAdminProducts for an authenticated admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockListAdminProducts.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });

    const response = await GET(makeGetRequest());

    expect(response.status).toBe(200);
    expect(mockListAdminProducts).toHaveBeenCalledTimes(1);
  });

  it("parses status/categoryId/search/page query params and passes them through", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockListAdminProducts.mockResolvedValueOnce({ items: [], total: 0, page: 2, pageSize: 20 });

    await GET(makeGetRequest("?status=ACTIVE&categoryId=cat-1&search=chair&page=2"));

    const callArg = mockListAdminProducts.mock.calls[0]?.[0];
    expect(callArg.filter).toEqual({ status: "ACTIVE", categoryId: "cat-1", search: "chair" });
    expect(callArg.page).toBe(2);
  });

  it("ignores an invalid status value rather than passing it through untrusted", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockListAdminProducts.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });

    await GET(makeGetRequest("?status=NOT_A_REAL_STATUS"));

    const callArg = mockListAdminProducts.mock.calls[0]?.[0];
    expect(callArg.filter.status).toBeUndefined();
  });
});

describe("POST /api/admin/products — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with 401 when there is no session, and never calls createAdminProduct", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);
    const response = await POST(makePostRequest({ slug: "x" }));
    expect(response.status).toBe(401);
    expect(mockCreateAdminProduct).not.toHaveBeenCalled();
  });

  it("rejects with 403 when the authenticated user is not an admin, and never calls createAdminProduct", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(CUSTOMER_USER);
    const response = await POST(makePostRequest({ slug: "x" }));
    expect(response.status).toBe(403);
    expect(mockCreateAdminProduct).not.toHaveBeenCalled();
  });

  it("returns 201 for a successful creation by an admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockCreateAdminProduct.mockResolvedValueOnce({ ok: true, product: { id: "new-id" } });

    const response = await POST(makePostRequest({ slug: "x" }));

    expect(response.status).toBe(201);
    expect(mockCreateAdminProduct).toHaveBeenCalledTimes(1);
  });

  it("returns 400 with the validation error code when createAdminProduct reports a validation failure", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockCreateAdminProduct.mockResolvedValueOnce({ ok: false, error: "INVALID_PRICE" });

    const response = await POST(makePostRequest({ slug: "x" }));

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("INVALID_PRICE");
  });

  it("rejects a malformed JSON body with 400, never calling createAdminProduct", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    const request = new Request("http://localhost/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not valid json",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(mockCreateAdminProduct).not.toHaveBeenCalled();
  });
});
