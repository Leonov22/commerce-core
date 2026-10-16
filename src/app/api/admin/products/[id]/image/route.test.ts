import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `handleUpload` itself is Vercel's own tested SDK code — these tests
 * don't re-test it. They capture the `onBeforeGenerateToken`/
 * `onUploadCompleted` callbacks this route passes to it and invoke them
 * directly, which is exactly the boundary this route owns: authorization,
 * pathname/product-identity verification, the compare-and-set precondition
 * (`baseImageUrl`), and the database write (CR-046-01).
 */
const {
  mockGetCurrentUser,
  mockGetAdminProduct,
  mockConfirmAdminProductImageUpload,
  mockRemoveAdminProductImage,
  mockDeleteProductImageBlob,
  mockHandleUpload,
} = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockGetAdminProduct: vi.fn(),
  mockConfirmAdminProductImageUpload: vi.fn(),
  mockRemoveAdminProductImage: vi.fn(),
  mockDeleteProductImageBlob: vi.fn(),
  mockHandleUpload: vi.fn(),
}));

vi.mock("@/modules/identity", () => ({
  getCurrentUser: mockGetCurrentUser,
  isAdminUser: (user: { role: string } | null) => user?.role === "ADMIN",
}));

vi.mock("@/modules/catalog", () => ({
  getAdminProduct: mockGetAdminProduct,
  confirmAdminProductImageUpload: mockConfirmAdminProductImageUpload,
  removeAdminProductImage: mockRemoveAdminProductImage,
  deleteProductImageBlob: mockDeleteProductImageBlob,
}));

vi.mock("@vercel/blob/client", () => ({
  handleUpload: mockHandleUpload,
}));

const { POST, DELETE } = await import("@/app/api/admin/products/[id]/image/route");

const ADMIN_USER = { id: "admin-1", email: "admin@example.com", role: "ADMIN" };
const CUSTOMER_USER = { id: "customer-1", email: "customer@example.com", role: "CUSTOMER" };

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeTokenRequest(): Request {
  return new Request("http://localhost/api/admin/products/product-1/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "blob.generate-client-token", payload: {} }),
  });
}

/** Extracts the `onBeforeGenerateToken`/`onUploadCompleted` this route passed to `handleUpload`. */
function capturedOptions() {
  const call = mockHandleUpload.mock.calls[0]?.[0];
  if (!call) throw new Error("handleUpload was not called");
  return call as {
    onBeforeGenerateToken: (pathname: string) => Promise<{ tokenPayload: string }>;
    onUploadCompleted: (args: {
      blob: { url: string; pathname: string };
      tokenPayload: string | null;
    }) => Promise<void>;
  };
}

describe("POST /api/admin/products/[id]/image — onBeforeGenerateToken (token issuance)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHandleUpload.mockResolvedValue({
      type: "blob.generate-client-token",
      clientToken: "token",
    });
  });

  it("rejects an unauthenticated token request, never reading the product", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);
    await POST(makeTokenRequest(), makeParams("product-1"));

    const { onBeforeGenerateToken } = capturedOptions();
    await expect(onBeforeGenerateToken("products/product-1/image")).rejects.toThrow(
      "UNAUTHENTICATED",
    );
    expect(mockGetAdminProduct).not.toHaveBeenCalled();
  });

  it("rejects a token request from an authenticated non-admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(CUSTOMER_USER);
    await POST(makeTokenRequest(), makeParams("product-1"));

    const { onBeforeGenerateToken } = capturedOptions();
    await expect(onBeforeGenerateToken("products/product-1/image")).rejects.toThrow("FORBIDDEN");
  });

  it("rejects a pathname that does not match this product's expected path", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    await POST(makeTokenRequest(), makeParams("product-1"));

    const { onBeforeGenerateToken } = capturedOptions();
    await expect(onBeforeGenerateToken("products/some-other-product/image")).rejects.toThrow(
      "INVALID_PATHNAME",
    );
  });

  it("rejects when the product no longer exists", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockGetAdminProduct.mockResolvedValueOnce(null);
    await POST(makeTokenRequest(), makeParams("product-1"));

    const { onBeforeGenerateToken } = capturedOptions();
    await expect(onBeforeGenerateToken("products/product-1/image")).rejects.toThrow("NOT_FOUND");
  });

  it("issues token options restricted to the three allowed image types, a bounded size, and embeds the product's CURRENT imageUrl as baseImageUrl", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockGetAdminProduct.mockResolvedValueOnce({
      id: "product-1",
      imageUrl: "https://example.public.blob.vercel-storage.com/products/product-1/old",
    });
    await POST(makeTokenRequest(), makeParams("product-1"));

    const { onBeforeGenerateToken } = capturedOptions();
    const options = (await onBeforeGenerateToken("products/product-1/image")) as {
      allowedContentTypes: string[];
      maximumSizeInBytes: number;
      tokenPayload: string;
    };

    expect(options.allowedContentTypes).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(options.maximumSizeInBytes).toBeGreaterThan(0);
    expect(JSON.parse(options.tokenPayload)).toEqual({
      productId: "product-1",
      baseImageUrl: "https://example.public.blob.vercel-storage.com/products/product-1/old",
    });
  });

  it("embeds baseImageUrl: null for a product with no current image", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockGetAdminProduct.mockResolvedValueOnce({ id: "product-1", imageUrl: null });
    await POST(makeTokenRequest(), makeParams("product-1"));

    const { onBeforeGenerateToken } = capturedOptions();
    const options = (await onBeforeGenerateToken("products/product-1/image")) as {
      tokenPayload: string;
    };

    expect(JSON.parse(options.tokenPayload)).toEqual({
      productId: "product-1",
      baseImageUrl: null,
    });
  });

  it("returns 400 when handleUpload itself rejects (e.g. a malformed/unsigned request)", async () => {
    mockHandleUpload.mockRejectedValueOnce(new Error("INVALID_SIGNATURE"));
    const response = await POST(makeTokenRequest(), makeParams("product-1"));
    expect(response.status).toBe(400);
  });
});

describe("POST /api/admin/products/[id]/image — onUploadCompleted (confirmation, CR-046-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHandleUpload.mockResolvedValue({
      type: "blob.generate-client-token",
      clientToken: "token",
    });
  });

  const BLOB = {
    url: "https://example.public.blob.vercel-storage.com/products/product-1/image-abc123",
    pathname: "products/product-1/image-abc123",
  };

  it("rejects a completion whose tokenPayload names a different product than the URL, never calling confirmAdminProductImageUpload", async () => {
    await POST(makeTokenRequest(), makeParams("product-1"));
    const { onUploadCompleted } = capturedOptions();

    await expect(
      onUploadCompleted({
        blob: BLOB,
        tokenPayload: JSON.stringify({ productId: "some-other-product", baseImageUrl: null }),
      }),
    ).rejects.toThrow("PRODUCT_MISMATCH");
    expect(mockConfirmAdminProductImageUpload).not.toHaveBeenCalled();
  });

  it("passes baseImageUrl from the tokenPayload through to confirmAdminProductImageUpload", async () => {
    mockConfirmAdminProductImageUpload.mockResolvedValueOnce({
      ok: true,
      applied: true,
      product: { id: "product-1" },
      previousImageUrl: "https://example.public.blob.vercel-storage.com/products/product-1/old",
    });

    await POST(makeTokenRequest(), makeParams("product-1"));
    const { onUploadCompleted } = capturedOptions();
    await onUploadCompleted({
      blob: BLOB,
      tokenPayload: JSON.stringify({
        productId: "product-1",
        baseImageUrl: "https://example.public.blob.vercel-storage.com/products/product-1/old",
      }),
    });

    expect(mockConfirmAdminProductImageUpload).toHaveBeenCalledWith({
      productId: "product-1",
      imageUrl: BLOB.url,
      pathname: BLOB.pathname,
      imageAlt: null,
      baseImageUrl: "https://example.public.blob.vercel-storage.com/products/product-1/old",
    });
  });

  it("deletes the previous blob only when the confirmation reports applied: true", async () => {
    mockConfirmAdminProductImageUpload.mockResolvedValueOnce({
      ok: true,
      applied: true,
      product: { id: "product-1" },
      previousImageUrl: "https://example.public.blob.vercel-storage.com/products/product-1/old",
    });

    await POST(makeTokenRequest(), makeParams("product-1"));
    const { onUploadCompleted } = capturedOptions();
    await onUploadCompleted({
      blob: BLOB,
      tokenPayload: JSON.stringify({ productId: "product-1", baseImageUrl: "old" }),
    });

    expect(mockDeleteProductImageBlob).toHaveBeenCalledWith(
      "https://example.public.blob.vercel-storage.com/products/product-1/old",
    );
  });

  it("does not attempt to delete anything when applied is true but there was no previous image", async () => {
    mockConfirmAdminProductImageUpload.mockResolvedValueOnce({
      ok: true,
      applied: true,
      product: { id: "product-1" },
      previousImageUrl: null,
    });

    await POST(makeTokenRequest(), makeParams("product-1"));
    const { onUploadCompleted } = capturedOptions();
    await onUploadCompleted({
      blob: BLOB,
      tokenPayload: JSON.stringify({ productId: "product-1", baseImageUrl: null }),
    });

    expect(mockDeleteProductImageBlob).not.toHaveBeenCalled();
  });

  it("CR-046-01: never deletes anything when the confirmation reports applied: false (DUPLICATE_CURRENT) — a retry of an already-applied completion", async () => {
    mockConfirmAdminProductImageUpload.mockResolvedValue({
      ok: true,
      applied: false,
      reason: "DUPLICATE_CURRENT",
      product: { id: "product-1", imageUrl: BLOB.url },
    });

    await POST(makeTokenRequest(), makeParams("product-1"));
    const { onUploadCompleted } = capturedOptions();

    await onUploadCompleted({
      blob: BLOB,
      tokenPayload: JSON.stringify({ productId: "product-1", baseImageUrl: null }),
    });
    await onUploadCompleted({
      blob: BLOB,
      tokenPayload: JSON.stringify({ productId: "product-1", baseImageUrl: null }),
    });

    expect(mockDeleteProductImageBlob).not.toHaveBeenCalled();
  });

  it("CR-046-01: never deletes anything when the confirmation reports applied: false (STALE_SUPERSEDED) — a delayed retry of a completion a newer upload already replaced", async () => {
    mockConfirmAdminProductImageUpload.mockResolvedValueOnce({
      ok: true,
      applied: false,
      reason: "STALE_SUPERSEDED",
      product: {
        id: "product-1",
        imageUrl: "https://example.public.blob.vercel-storage.com/products/product-1/image-b",
      },
    });

    await POST(makeTokenRequest(), makeParams("product-1"));
    const { onUploadCompleted } = capturedOptions();

    await onUploadCompleted({
      blob: BLOB,
      tokenPayload: JSON.stringify({ productId: "product-1", baseImageUrl: "old" }),
    });

    expect(mockDeleteProductImageBlob).not.toHaveBeenCalled();
  });

  it("propagates a failed confirmation (e.g. the product was deleted) as a thrown error, never deleting any blob", async () => {
    mockConfirmAdminProductImageUpload.mockResolvedValueOnce({ ok: false, error: "NOT_FOUND" });

    await POST(makeTokenRequest(), makeParams("product-1"));
    const { onUploadCompleted } = capturedOptions();

    await expect(
      onUploadCompleted({
        blob: BLOB,
        tokenPayload: JSON.stringify({ productId: "product-1", baseImageUrl: null }),
      }),
    ).rejects.toThrow("NOT_FOUND");
    expect(mockDeleteProductImageBlob).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/products/[id]/image (CR-046-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects with 401 when there is no session, never calling removeAdminProductImage", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);
    const response = await DELETE(new Request("http://localhost"), makeParams("product-1"));
    expect(response.status).toBe(401);
    expect(mockRemoveAdminProductImage).not.toHaveBeenCalled();
  });

  it("rejects with 403 for an authenticated non-admin, never calling removeAdminProductImage", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(CUSTOMER_USER);
    const response = await DELETE(new Request("http://localhost"), makeParams("product-1"));
    expect(response.status).toBe(403);
    expect(mockRemoveAdminProductImage).not.toHaveBeenCalled();
  });

  it("returns 404 when the product has no matching record", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockRemoveAdminProductImage.mockResolvedValueOnce({ ok: false, error: "NOT_FOUND" });

    const response = await DELETE(new Request("http://localhost"), makeParams("nonexistent"));
    expect(response.status).toBe(404);
  });

  it("clears the image and deletes the blob for an authenticated admin", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockRemoveAdminProductImage.mockResolvedValueOnce({
      ok: true,
      applied: true,
      previousImageUrl:
        "https://example.public.blob.vercel-storage.com/products/product-1/image-abc123",
    });

    const response = await DELETE(new Request("http://localhost"), makeParams("product-1"));

    expect(response.status).toBe(200);
    expect(mockDeleteProductImageBlob).toHaveBeenCalledWith(
      "https://example.public.blob.vercel-storage.com/products/product-1/image-abc123",
    );
  });

  it("is idempotent for a product with no image (ALREADY_CLEARED): 200, without attempting any blob delete", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockRemoveAdminProductImage.mockResolvedValueOnce({
      ok: true,
      applied: false,
      reason: "ALREADY_CLEARED",
    });

    const response = await DELETE(new Request("http://localhost"), makeParams("product-1"));

    expect(response.status).toBe(200);
    expect(mockDeleteProductImageBlob).not.toHaveBeenCalled();
  });

  it("CR-046-01: returns 409 and deletes nothing when the image changed concurrently (CHANGED_CONCURRENTLY) — never deletes a blob a concurrent upload just replaced", async () => {
    mockGetCurrentUser.mockResolvedValueOnce(ADMIN_USER);
    mockRemoveAdminProductImage.mockResolvedValueOnce({
      ok: true,
      applied: false,
      reason: "CHANGED_CONCURRENTLY",
    });

    const response = await DELETE(new Request("http://localhost"), makeParams("product-1"));

    expect(response.status).toBe(409);
    expect(mockDeleteProductImageBlob).not.toHaveBeenCalled();
  });
});
