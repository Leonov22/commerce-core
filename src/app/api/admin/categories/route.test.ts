import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetCurrentUser, mockListCategories, mockCreateAdminCategory } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockListCategories: vi.fn(),
  mockCreateAdminCategory: vi.fn(),
}));

vi.mock("@/modules/identity", () => ({
  getCurrentUser: mockGetCurrentUser,
  isAdminUser: (user: { role: string } | null) => user?.role === "ADMIN",
}));

vi.mock("@/modules/catalog", () => ({
  listCategories: mockListCategories,
  createAdminCategory: mockCreateAdminCategory,
}));

const { GET, POST } = await import("@/app/api/admin/categories/route");

const ADMIN_USER = { id: "admin-1", email: "admin@example.com", role: "ADMIN" };
const CUSTOMER_USER = { id: "customer-1", email: "customer@example.com", role: "CUSTOMER" };

describe("GET /api/admin/categories — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with 401 when there is no session", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mockListCategories).not.toHaveBeenCalled();
  });

  it("rejects with 403 for an authenticated non-admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(CUSTOMER_USER);
    const response = await GET();
    expect(response.status).toBe(403);
    expect(mockListCategories).not.toHaveBeenCalled();
  });

  it("returns 200 for an authenticated admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockListCategories.mockResolvedValueOnce([]);
    const response = await GET();
    expect(response.status).toBe(200);
  });
});

describe("POST /api/admin/categories — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeRequest(body: unknown): Request {
    return new Request("http://localhost/api/admin/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rejects with 401 when there is no session, and never calls createAdminCategory", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);
    const response = await POST(makeRequest({ slug: "x", name: "X" }));
    expect(response.status).toBe(401);
    expect(mockCreateAdminCategory).not.toHaveBeenCalled();
  });

  it("rejects with 403 for an authenticated non-admin, and never calls createAdminCategory", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(CUSTOMER_USER);
    const response = await POST(makeRequest({ slug: "x", name: "X" }));
    expect(response.status).toBe(403);
    expect(mockCreateAdminCategory).not.toHaveBeenCalled();
  });

  it("returns 201 for a successful creation by an admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockCreateAdminCategory.mockResolvedValueOnce({ ok: true, category: { id: "new-id" } });
    const response = await POST(makeRequest({ slug: "x", name: "X" }));
    expect(response.status).toBe(201);
  });
});
