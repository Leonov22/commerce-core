import { NextResponse } from "next/server";
import { getCurrentUser, isAdminUser } from "@/modules/identity";
import { listAdminInventory } from "@/modules/catalog";

/**
 * Admin inventory listing boundary (IMP-048 Increment 4).
 *
 * GET /api/admin/inventory — paginated, searchable list of every product
 *   with its current tracking/on-hand/reserved/available state, joined
 *   at read time from `getProductAvailability` (never recomputed here).
 *
 * Requires an authenticated session belonging to an `ADMIN` user, checked
 * independently of the `/admin/inventory` page — a page redirect is a UI
 * affordance, not an authorization boundary.
 */

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (!isAdminUser(user)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(request.url);
  const search = url.searchParams.get("search") ?? undefined;
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
    const result = await listAdminInventory({ search, page, pageSize });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/admin/inventory] failed to list inventory", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
