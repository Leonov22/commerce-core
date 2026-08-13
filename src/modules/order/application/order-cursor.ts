/**
 * Encodes/decodes the customer order-history pagination cursor (CR029-01
 * fix). Customer orders are ordered `createdAt DESC, id DESC`; a cursor
 * that only encodes `id` cannot correctly represent a position in that
 * *composite* ordering — this module encodes the full position
 * (`createdAt` + `id`) so the repository can build an exact keyset (seek)
 * WHERE clause instead of relying on Prisma's single-field `cursor` option
 * against a multi-column `orderBy`.
 *
 * Deliberately opaque to the client: the encoded string is base64url, not
 * a raw/inspectable id or timestamp. It carries no `userId` and never
 * will — ownership is applied separately, from server-derived context,
 * every time a page is queried; the cursor only ever represents "how far
 * through this already-scoped list have we gotten."
 */

export interface OrderCursor {
  createdAt: Date;
  id: string;
}

export type DecodeOrderCursorResult =
  { ok: true; cursor: OrderCursor } | { ok: false; error: "INVALID_CURSOR" };

// Loose, forward-compatible shape check for Order ids (Prisma `cuid()`):
// lowercase alphanumeric, bounded length. Not pinned to one exact cuid
// version/algorithm, but still rejects obviously-wrong values (path
// fragments, whitespace, empty strings, absurd lengths).
const ID_PATTERN = /^[a-z0-9]{1,64}$/i;

export function encodeOrderCursor(cursor: OrderCursor): string {
  const payload = JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id });
  return Buffer.from(payload, "utf8").toString("base64url");
}

/**
 * Never throws — any malformed input (bad base64, bad JSON, wrong shape,
 * unparsable timestamp, malformed id) deterministically returns
 * `{ ok: false, error: "INVALID_CURSOR" }` rather than propagating a raw
 * parsing exception up into a database query or an API response.
 */
export function decodeOrderCursor(raw: string): DecodeOrderCursorResult {
  let json: string;
  try {
    json = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return { ok: false, error: "INVALID_CURSOR" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "INVALID_CURSOR" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "INVALID_CURSOR" };
  }

  const { createdAt, id } = parsed as Record<string, unknown>;
  if (typeof createdAt !== "string" || typeof id !== "string") {
    return { ok: false, error: "INVALID_CURSOR" };
  }
  if (!ID_PATTERN.test(id)) {
    return { ok: false, error: "INVALID_CURSOR" };
  }

  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: "INVALID_CURSOR" };
  }

  return { ok: true, cursor: { createdAt: date, id } };
}
