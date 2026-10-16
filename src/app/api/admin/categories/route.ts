import { NextResponse } from "next/server";
import { getCurrentUser, isAdminUser } from "@/modules/identity";
import { listCategories, createAdminCategory } from "@/modules/catalog";

/**
 * Admin Category listing/creation boundary (IMP-043). Deliberately
 * minimal — see `admin-category-commands.ts`'s own doc comment for why
 * editing/deleting is out of this milestone's scope. Both methods require
 * an authenticated `ADMIN` session, checked independently of any page.
 */

function isPlainRequestObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (!isAdminUser(user)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  try {
    const categories = await listCategories("en");
    return NextResponse.json({ categories });
  } catch (error) {
    console.error("[api/admin/categories] failed to list categories", error);
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
    const result = await createAdminCategory(rawBody);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ category: result.category }, { status: 201 });
  } catch (error) {
    console.error("[api/admin/categories] failed to create category", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
