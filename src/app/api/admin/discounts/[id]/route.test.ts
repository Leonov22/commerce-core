import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetCurrentUser,
  mockGetAdminDiscount,
  mockUpdateAdminDiscount,
  mockSetAdminDiscountActive,
  mockRemoveAdminDiscount,
} = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockGetAdminDiscount: vi.fn(),
  mockUpdateAdminDiscount: vi.fn(),
  mockSetAdminDiscountActive: vi.fn(),
  mockRemoveAdminDiscount: vi.fn(),
}));

vi.mock("@/modules/identity", () => ({
  getCurrentUser: mockGetCurrentUser,
  isAdminUser: (user: { role: string } | null) => user?.role === "ADMIN",
}));

vi.mock("@/modules/catalog", () => ({
  getAdminDiscount: mockGetAdminDiscount,
  updateAdminDiscount: mockUpdateAdminDiscount,
  setAdminDiscountActive: mockSetAdminDiscountActive,
  removeAdminDiscount: mockRemoveAdminDiscount,
}));

const { GET, PATCH, DELETE } = await import("@/app/api/admin/discounts/[id]/route");

const ADMIN_USER = { id: "admin-1", email: "admin@example.com", role: "ADMIN" };
const CUSTOMER_USER = { id: "customer-1", email: "customer@example.com", role: "CUSTOMER" };

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makePatchRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/discounts/discount-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/admin/discounts/[id] — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with 401 when there is no session", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);
    const response = await GET(new Request("http://localhost"), makeParams("discount-1"));
    expect(response.status).toBe(401);
    expect(mockGetAdminDiscount).not.toHaveBeenCalled();
  });

  it("rejects with 403 for an authenticated non-admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(CUSTOMER_USER);
    const response = await GET(new Request("http://localhost"), makeParams("discount-1"));
    expect(response.status).toBe(403);
    expect(mockGetAdminDiscount).not.toHaveBeenCalled();
  });

  it("returns 404 when the discount does not exist", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockGetAdminDiscount.mockResolvedValueOnce(null);
    const response = await GET(new Request("http://localhost"), makeParams("nonexistent"));
    expect(response.status).toBe(404);
  });

  it("returns 200 with the discount for an authenticated admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockGetAdminDiscount.mockResolvedValueOnce({ id: "discount-1" });
    const response = await GET(new Request("http://localhost"), makeParams("discount-1"));
    expect(response.status).toBe(200);
  });
});

describe("PATCH /api/admin/discounts/[id] — authorization and routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with 401 when there is no session, calling neither update function", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);
    const response = await PATCH(makePatchRequest({ isActive: false }), makeParams("discount-1"));
    expect(response.status).toBe(401);
    expect(mockUpdateAdminDiscount).not.toHaveBeenCalled();
    expect(mockSetAdminDiscountActive).not.toHaveBeenCalled();
  });

  it("rejects with 403 for an authenticated non-admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(CUSTOMER_USER);
    const response = await PATCH(makePatchRequest({ isActive: false }), makeParams("discount-1"));
    expect(response.status).toBe(403);
    expect(mockSetAdminDiscountActive).not.toHaveBeenCalled();
  });

  it("routes a lone { isActive } body to setAdminDiscountActive (the toggle shortcut), never updateAdminDiscount", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockSetAdminDiscountActive.mockResolvedValueOnce({
      ok: true,
      discount: { id: "discount-1", isActive: false },
    });

    const response = await PATCH(makePatchRequest({ isActive: false }), makeParams("discount-1"));

    expect(response.status).toBe(200);
    expect(mockSetAdminDiscountActive).toHaveBeenCalledWith("discount-1", false);
    expect(mockUpdateAdminDiscount).not.toHaveBeenCalled();
  });

  it("returns 404 when the toggle targets a nonexistent discount", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockSetAdminDiscountActive.mockResolvedValueOnce({ ok: false, error: "NOT_FOUND" });

    const response = await PATCH(makePatchRequest({ isActive: true }), makeParams("nonexistent"));

    expect(response.status).toBe(404);
  });

  it("routes a full-field body to updateAdminDiscount, never setAdminDiscountActive", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockUpdateAdminDiscount.mockResolvedValueOnce({ ok: true, discount: { id: "discount-1" } });

    const body = {
      type: "PERCENTAGE",
      value: 20,
      startsAt: "2026-07-01T00:00:00.000Z",
      endsAt: "2026-07-31T00:00:00.000Z",
      isActive: true,
    };
    const response = await PATCH(makePatchRequest(body), makeParams("discount-1"));

    expect(response.status).toBe(200);
    expect(mockUpdateAdminDiscount).toHaveBeenCalledWith("discount-1", body);
    expect(mockSetAdminDiscountActive).not.toHaveBeenCalled();
  });

  it("returns 400 with the validation error code when updateAdminDiscount rejects an invalid value", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockUpdateAdminDiscount.mockResolvedValueOnce({ ok: false, error: "INVALID_PERCENTAGE_VALUE" });

    const response = await PATCH(
      makePatchRequest({
        type: "PERCENTAGE",
        value: 150,
        startsAt: "x",
        endsAt: "y",
        isActive: true,
      }),
      makeParams("discount-1"),
    );

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("INVALID_PERCENTAGE_VALUE");
  });

  it("returns 404 when updateAdminDiscount reports NOT_FOUND", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockUpdateAdminDiscount.mockResolvedValueOnce({ ok: false, error: "NOT_FOUND" });

    const response = await PATCH(
      makePatchRequest({
        type: "PERCENTAGE",
        value: 20,
        startsAt: "x",
        endsAt: "y",
        isActive: true,
      }),
      makeParams("nonexistent"),
    );

    expect(response.status).toBe(404);
  });

  it("rejects a malformed JSON body with 400, calling neither update function", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    const request = new Request("http://localhost/api/admin/discounts/discount-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{not valid json",
    });

    const response = await PATCH(request, makeParams("discount-1"));

    expect(response.status).toBe(400);
    expect(mockUpdateAdminDiscount).not.toHaveBeenCalled();
    expect(mockSetAdminDiscountActive).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/discounts/[id] — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with 401 when there is no session, never calling removeAdminDiscount", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);
    const response = await DELETE(new Request("http://localhost"), makeParams("discount-1"));
    expect(response.status).toBe(401);
    expect(mockRemoveAdminDiscount).not.toHaveBeenCalled();
  });

  it("rejects with 403 for an authenticated non-admin, never calling removeAdminDiscount", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(CUSTOMER_USER);
    const response = await DELETE(new Request("http://localhost"), makeParams("discount-1"));
    expect(response.status).toBe(403);
    expect(mockRemoveAdminDiscount).not.toHaveBeenCalled();
  });

  it("returns 404 when the discount does not exist", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockRemoveAdminDiscount.mockResolvedValueOnce({ ok: false, error: "NOT_FOUND" });
    const response = await DELETE(new Request("http://localhost"), makeParams("nonexistent"));
    expect(response.status).toBe(404);
  });

  it("returns 200 for a successful deletion by an admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockRemoveAdminDiscount.mockResolvedValueOnce({ ok: true });
    const response = await DELETE(new Request("http://localhost"), makeParams("discount-1"));
    expect(response.status).toBe(200);
  });
});
