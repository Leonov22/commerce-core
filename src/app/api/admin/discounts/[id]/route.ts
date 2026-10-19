import { NextResponse } from "next/server";
import { getCurrentUser, isAdminUser } from "@/modules/identity";
import {
  getAdminDiscount,
  updateAdminDiscount,
  setAdminDiscountActive,
  removeAdminDiscount,
} from "@/modules/catalog";

/**
 * Single-discount admin boundary (IMP-047).
 *
 * GET    /api/admin/discounts/[id] — for editing.
 * PATCH  /api/admin/discounts/[id] — either a full edit (type/value/
 *   startsAt/endsAt/isActive, mirroring the product editor's "resend the
 *   whole form" convention) or a one-field `{ isActive }` body, treated
 *   as the activate/deactivate shortcut (§5.2) so toggling a discount
 *   never requires resending its dates.
 * DELETE /api/admin/discounts/[id] — always safe; see
 *   `ProductRepository.deleteProductDiscount`'s own doc comment for why.
 *
 * All three independently require an authenticated `ADMIN` session.
 */

type RouteParams = { params: Promise<{ id: string }> };

function isPlainRequestObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToggleOnlyBody(body: Record<string, unknown>): body is { isActive: boolean } {
  const keys = Object.keys(body);
  return keys.length === 1 && keys[0] === "isActive" && typeof body.isActive === "boolean";
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
    const discount = await getAdminDiscount(id);
    if (!discount) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ discount });
  } catch (error) {
    console.error("[api/admin/discounts/[id]] failed to load discount", error);
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
    if (isToggleOnlyBody(rawBody)) {
      const result = await setAdminDiscountActive(id, rawBody.isActive);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      return NextResponse.json({ discount: result.discount });
    }

    const result = await updateAdminDiscount(id, rawBody);
    if (!result.ok) {
      const status =
        result.error === "NOT_FOUND" || result.error === "PRODUCT_NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ discount: result.discount });
  } catch (error) {
    console.error("[api/admin/discounts/[id]] failed to update discount", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (!isAdminUser(user)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const result = await removeAdminDiscount(id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/admin/discounts/[id]] failed to delete discount", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
