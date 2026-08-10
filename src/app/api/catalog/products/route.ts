import { NextResponse } from "next/server";
import { getProductsByIds, toStorefrontProductSummary } from "@/modules/catalog";
import { routing } from "@/core/i18n/routing";

/**
 * Read-only Catalog transport for Client Components (Cart, Checkout).
 *
 * GET /api/catalog/products?ids=1,2,3&locale=en
 *
 * - Returns only storefront-safe fields (see `StorefrontProductSummary`) —
 *   never Prisma objects, never draft/archived products, never internal
 *   infrastructure details.
 * - Client-provided IDs/locale are validated; nothing here is trusted as an
 *   authoritative price for future checkout/order processing.
 * - No mutation endpoints exist. This is intentionally read-only.
 */

const MAX_IDS_PER_REQUEST = 50;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawIds = url.searchParams.get("ids");
  const rawLocale = url.searchParams.get("locale");

  if (!rawIds) {
    return NextResponse.json({ error: "IDS_REQUIRED" }, { status: 400 });
  }

  const ids = Array.from(
    new Set(
      rawIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  );

  if (ids.length === 0 || ids.length > MAX_IDS_PER_REQUEST) {
    return NextResponse.json({ error: "INVALID_IDS" }, { status: 400 });
  }

  const locale = routing.locales.includes(rawLocale as (typeof routing.locales)[number])
    ? (rawLocale as string)
    : routing.defaultLocale;

  try {
    const products = await getProductsByIds(ids, locale);
    return NextResponse.json({
      products: products.map(toStorefrontProductSummary),
    });
  } catch (error) {
    // Never leak raw database/Prisma errors to the client.
    console.error("[api/catalog/products] failed to resolve products", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
