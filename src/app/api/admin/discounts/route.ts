import { NextResponse } from "next/server";
import { getCurrentUser, isAdminUser } from "@/modules/identity";
import { listAdminDiscounts, createAdminDiscount } from "@/modules/catalog";

/**
 * Admin discount listing/creation boundary (IMP-047).
 *
 * GET  /api/admin/discounts — paginated list, every discount across every
 *   product, joined with the product's name for display.
 * POST /api/admin/discounts — create a new discount.
 *
 * Both require an authenticated session belonging to an `ADMIN` user,
 * checked independently of any admin page — a page redirect is a UI
 * affordance, not an authorization boundary. Never accepts or trusts a
 * client-supplied `isEffectiveNow`/computed price — that is always
 * resolved server-side by `resolveEffectivePrice`.
 */

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function isPlainRequestObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (!isAdminUser(user)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(request.url);
  const pageParam = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const pageSizeParam = Number.parseInt(
    url.searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE),
    10,
  );
  const pageSize =
    Number.isInteger(pageSizeParam) && pageSizeParam > 0 && pageSizeParam <= MAX_PAGE_SIZE
      ? pageSizeParam
      : DEFAULT_PAGE_SIZE;

  try {
    const result = await listAdminDiscounts({ page, pageSize });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/admin/discounts] failed to list discounts", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (!isAdminUser(user)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

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
    const result = await createAdminDiscount(rawBody);
    if (!result.ok) {
      const status = result.error === "PRODUCT_NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ discount: result.discount }, { status: 201 });
  } catch (error) {
    console.error("[api/admin/discounts] failed to create discount", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
