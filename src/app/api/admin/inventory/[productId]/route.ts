import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { getCurrentUser, isAdminUser } from "@/modules/identity";
import { getAdminInventoryProduct, setProductTrackInventory } from "@/modules/catalog";

/**
 * Single-product admin inventory boundary (IMP-048 Increment 4).
 *
 * GET   /api/admin/inventory/[productId] — current tracking/on-hand/
 *   reserved/available state for one product.
 * PATCH /api/admin/inventory/[productId] — enable or disable
 *   `trackInventory`. Body: `{ trackInventory: boolean; initialQuantity?:
 *   number; reason?: string }`. `initialQuantity`/`reason` are only
 *   meaningful (and `reason` only required) when enabling AND the
 *   requested initial quantity differs from the product's current
 *   on-hand count — see `setProductTrackInventory`'s own doc comment.
 *   This never writes `stockQuantity` directly: enabling with an initial
 *   quantity is applied through the same `adjustStock` operation the
 *   `/adjust` endpoint uses, so every such change is still an auditable
 *   `StockAdjustment` row.
 *
 * Both independently require an authenticated `ADMIN` session.
 */

type RouteParams = { params: Promise<{ productId: string }> };

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

  const { productId } = await params;
  try {
    const product = await getAdminInventoryProduct(productId);
    if (!product) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ product });
  } catch (error) {
    console.error("[api/admin/inventory/[productId]] failed to load product", error);
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

  const { productId } = await params;

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
    const result = await setProductTrackInventory(productId, rawBody, user.id);
    switch (result.outcome) {
      case "enabled":
        return NextResponse.json({
          trackInventory: true,
          stockQuantity: result.stockQuantity,
          adjustment: result.adjustment,
        });
      case "disabled":
        return NextResponse.json({ trackInventory: false });
      case "alreadyEnabled":
      case "alreadyDisabled":
        return NextResponse.json({ error: result.outcome }, { status: 409 });
      case "activeReservationsExist":
        return NextResponse.json(
          { error: result.outcome, reserved: result.reserved },
          { status: 409 },
        );
      case "productNotFound":
        return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      case "invalidInput":
        return NextResponse.json({ error: result.error }, { status: 400 });
      case "wouldGoNegative":
      case "belowActiveReservations":
        return NextResponse.json({ error: result.outcome }, { status: 400 });
      default:
        return result satisfies never;
    }
  } catch (error) {
    // Finding 6 backstop — see the `/adjust` route's own identical catch
    // for why this exists alongside (not instead of) the application
    // layer's own best-effort bound check.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2020") {
      return NextResponse.json({ error: "INITIAL_QUANTITY_OUT_OF_RANGE" }, { status: 400 });
    }
    console.error("[api/admin/inventory/[productId]] failed to update tracking", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
