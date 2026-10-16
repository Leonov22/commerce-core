import { NextResponse } from "next/server";
import { getCurrentUser, isAdminUser } from "@/modules/identity";
import { getAdminProduct, updateAdminProduct } from "@/modules/catalog";

/**
 * Single-product admin boundary (IMP-043).
 *
 * GET   /api/admin/products/[id] — any status (DRAFT/ACTIVE/ARCHIVED), for editing.
 * PATCH /api/admin/products/[id] — update, including status changes
 *   (archiving). There is no separate "delete" — archived products are
 *   never hard-deleted, since historical Orders snapshot their own
 *   productName/price independent of the Product row (see
 *   `checkout-order.ts`'s own doc comment) but still reference the
 *   product's existence conceptually; ARCHIVED is this project's existing
 *   lifecycle state for "no longer offered," reused rather than inventing
 *   a new one.
 *
 * Both independently require an authenticated `ADMIN` session.
 */

type RouteParams = { params: Promise<{ id: string }> };

function isPlainRequestObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (!isAdminUser(user)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const product = await getAdminProduct(id);
    if (!product) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ product });
  } catch (error) {
    console.error("[api/admin/products/[id]] failed to load product", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (!isAdminUser(user)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  if (!isPlainRequestObject(rawBody)) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

  try {
    const result = await updateAdminProduct(id, rawBody);
    if (!result.ok) {
      const status = result.error === "NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ product: result.product });
  } catch (error) {
    console.error("[api/admin/products/[id]] failed to update product", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
