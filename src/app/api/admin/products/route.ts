import { NextResponse } from "next/server";
import { getCurrentUser, isAdminUser } from "@/modules/identity";
import { listAdminProducts, createAdminProduct } from "@/modules/catalog";
import type { AdminProductListFilter, AdminProductSortField } from "@/modules/catalog";

/**
 * Admin Product listing/creation boundary (IMP-043).
 *
 * GET  /api/admin/products — paginated, searchable, filterable list.
 * POST /api/admin/products — create a new product.
 *
 * Both require an authenticated session belonging to an `ADMIN` user,
 * checked independently of whether the request ever went through an
 * `/admin` page — a page redirect is a UI affordance, not an authorization
 * boundary. Never accepts or trusts a client-supplied currency: this store
 * has exactly one currency (EUR, IMP-042), fixed server-side in
 * `admin-product-commands.ts`, never read from the request body.
 */

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const VALID_SORT_FIELDS: readonly AdminProductSortField[] = [
  "updatedAt",
  "priceAmountMinor",
  "sortOrder",
];

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
  const query = url.searchParams;

  const pageParam = Number.parseInt(query.get("page") ?? "1", 10);
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

  const pageSizeParam = Number.parseInt(query.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10);
  const pageSize =
    Number.isInteger(pageSizeParam) && pageSizeParam > 0 && pageSizeParam <= MAX_PAGE_SIZE
      ? pageSizeParam
      : DEFAULT_PAGE_SIZE;

  const status = query.get("status");
  const categoryId = query.get("categoryId");
  const search = query.get("search");
  const sortField = query.get("sortField");
  const sortDirection = query.get("sortDirection") === "asc" ? "asc" : "desc";

  const filter: AdminProductListFilter = {
    ...(status === "DRAFT" || status === "ACTIVE" || status === "ARCHIVED" ? { status } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(search ? { search } : {}),
  };

  const sort =
    sortField && VALID_SORT_FIELDS.includes(sortField as AdminProductSortField)
      ? { field: sortField as AdminProductSortField, direction: sortDirection as "asc" | "desc" }
      : undefined;

  try {
    const result = await listAdminProducts({ filter, sort, page, pageSize });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/admin/products] failed to list products", error);
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
    const result = await createAdminProduct(rawBody);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ product: result.product }, { status: 201 });
  } catch (error) {
    console.error("[api/admin/products] failed to create product", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
