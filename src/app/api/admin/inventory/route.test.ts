import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetCurrentUser, mockListAdminInventory } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockListAdminInventory: vi.fn(),
}));

vi.mock("@/modules/identity", () => ({
  getCurrentUser: mockGetCurrentUser,
  isAdminUser: (user: { role: string } | null) => user?.role === "ADMIN",
}));

vi.mock("@/modules/catalog", () => ({
  listAdminInventory: mockListAdminInventory,
}));

const { GET } = await import("@/app/api/admin/inventory/route");

const ADMIN_USER = { id: "admin-1", email: "admin@example.com", role: "ADMIN" };
const CUSTOMER_USER = { id: "customer-1", email: "customer@example.com", role: "CUSTOMER" };

function makeGetRequest(searchParams = ""): Request {
  return new Request(`http://localhost/api/admin/inventory${searchParams}`);
}

describe("GET /api/admin/inventory — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with 401 when there is no session, and never calls listAdminInventory", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);
    const response = await GET(makeGetRequest());
    expect(response.status).toBe(401);
    expect(mockListAdminInventory).not.toHaveBeenCalled();
  });

  it("rejects with 403 for an authenticated non-admin, and never calls listAdminInventory", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(CUSTOMER_USER);
    const response = await GET(makeGetRequest());
    expect(response.status).toBe(403);
    expect(mockListAdminInventory).not.toHaveBeenCalled();
  });

  it("returns 200 and calls listAdminInventory for an authenticated admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockListAdminInventory.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });

    const response = await GET(makeGetRequest());

    expect(response.status).toBe(200);
    expect(mockListAdminInventory).toHaveBeenCalledWith({
      search: undefined,
      page: 1,
      pageSize: 20,
    });
  });

  it("parses search/page/pageSize query params", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockListAdminInventory.mockResolvedValueOnce({ items: [], total: 0, page: 2, pageSize: 10 });

    await GET(makeGetRequest("?search=chair&page=2&pageSize=10"));

    expect(mockListAdminInventory).toHaveBeenCalledWith({
      search: "chair",
      page: 2,
      pageSize: 10,
    });
  });

  it("returns 500 without leaking the underlying error when listAdminInventory throws", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockListAdminInventory.mockRejectedValueOnce(new Error("db exploded"));

    const response = await GET(makeGetRequest());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "INTERNAL_ERROR" });
  });
});
