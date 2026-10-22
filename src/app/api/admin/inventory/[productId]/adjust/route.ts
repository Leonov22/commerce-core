import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { getCurrentUser, isAdminUser } from "@/modules/identity";
import { adjustProductStock } from "@/modules/catalog";

/**
 * Admin-initiated stock adjustment boundary (IMP-048 Increment 4).
 *
 * POST /api/admin/inventory/[productId]/adjust — body:
 *   `{ quantityChange: number; reason: string }`. Delegates entirely to
 *   `InventoryRepository.adjustStock` through `adjustProductStock` — this
 *   route never writes `stockQuantity` itself, and every existing
 *   protection (row lock, non-negative floor, active-reservation floor)
 *   applies exactly as it does for every other caller of that operation.
 *
 * Requires an authenticated `ADMIN` session. Never reachable from the
 * public storefront — this whole route tree lives under `api/admin`,
 * which the storefront never links to or calls.
 */

type RouteParams = { params: Promise<{ productId: string }> };

function isPlainRequestObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request, { params }: RouteParams) {
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
    const validated = await adjustProductStock({ ...rawBody, productId }, user.id);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const result = validated.result;
    switch (result.outcome) {
      case "applied":
        return NextResponse.json({
          adjustment: result.adjustment,
          stockQuantity: result.stockQuantity,
        });
      case "wouldGoNegative":
        return NextResponse.json(
          { error: result.outcome, currentStockQuantity: result.currentStockQuantity },
          { status: 400 },
        );
      case "belowActiveReservations":
        return NextResponse.json(
          {
            error: result.outcome,
            currentStockQuantity: result.currentStockQuantity,
            activeReserved: result.activeReserved,
          },
          { status: 400 },
        );
      case "productNotFound":
        return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      case "noOp":
        return NextResponse.json({ error: "INVALID_QUANTITY_CHANGE" }, { status: 400 });
      default:
        return result satisfies never;
    }
  } catch (error) {
    // Finding 6 backstop: the application layer already validates both
    // the requested delta and (when the product's current count is
    // readable) the resulting total against Postgres's `integer` range
    // before ever calling the repository — this only catches whatever
    // that best-effort, necessarily non-atomic check could not, so a
    // genuine database-level range violation still reports a clean 400
    // rather than leaking as a generic 500.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2020") {
      return NextResponse.json({ error: "RESULTING_STOCK_QUANTITY_OUT_OF_RANGE" }, { status: 400 });
    }
    console.error("[api/admin/inventory/[productId]/adjust] failed to adjust stock", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
