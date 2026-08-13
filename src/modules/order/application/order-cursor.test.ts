import { describe, expect, it } from "vitest";
import { encodeOrderCursor, decodeOrderCursor } from "@/modules/order/application/order-cursor";

describe("encodeOrderCursor / decodeOrderCursor", () => {
  it("round-trips a valid cursor", () => {
    const createdAt = new Date("2026-01-01T12:00:00.000Z");
    const encoded = encodeOrderCursor({ createdAt, id: "cabc123def456ghi789jklmn" });

    const decoded = decodeOrderCursor(encoded);

    expect(decoded).toEqual({ ok: true, cursor: { createdAt, id: "cabc123def456ghi789jklmn" } });
  });

  it("produces an opaque string that does not reveal the raw id", () => {
    const encoded = encodeOrderCursor({ createdAt: new Date(), id: "some-order-id" });
    expect(encoded).not.toContain("some-order-id");
  });

  it("rejects a malformed base64 string", () => {
    expect(decodeOrderCursor("!!!not-valid-base64!!!")).toEqual({
      ok: false,
      error: "INVALID_CURSOR",
    });
  });

  it("rejects a decodable but non-JSON payload", () => {
    const garbage = Buffer.from("not json", "utf8").toString("base64url");
    expect(decodeOrderCursor(garbage)).toEqual({ ok: false, error: "INVALID_CURSOR" });
  });

  it("rejects a JSON payload that isn't a plain object", () => {
    const arrayPayload = Buffer.from(JSON.stringify([1, 2, 3]), "utf8").toString("base64url");
    expect(decodeOrderCursor(arrayPayload)).toEqual({ ok: false, error: "INVALID_CURSOR" });

    const nullPayload = Buffer.from(JSON.stringify(null), "utf8").toString("base64url");
    expect(decodeOrderCursor(nullPayload)).toEqual({ ok: false, error: "INVALID_CURSOR" });
  });

  it("rejects a payload missing id", () => {
    const payload = Buffer.from(
      JSON.stringify({ createdAt: new Date().toISOString() }),
      "utf8",
    ).toString("base64url");
    expect(decodeOrderCursor(payload)).toEqual({ ok: false, error: "INVALID_CURSOR" });
  });

  it("rejects a payload missing createdAt", () => {
    const payload = Buffer.from(JSON.stringify({ id: "order-1" }), "utf8").toString("base64url");
    expect(decodeOrderCursor(payload)).toEqual({ ok: false, error: "INVALID_CURSOR" });
  });

  it("rejects a payload with an invalid timestamp", () => {
    const payload = Buffer.from(
      JSON.stringify({ createdAt: "not-a-date", id: "order1" }),
      "utf8",
    ).toString("base64url");
    expect(decodeOrderCursor(payload)).toEqual({ ok: false, error: "INVALID_CURSOR" });
  });

  it("rejects a payload with an invalid id format", () => {
    const payload = Buffer.from(
      JSON.stringify({ createdAt: new Date().toISOString(), id: "../../etc/passwd" }),
      "utf8",
    ).toString("base64url");
    expect(decodeOrderCursor(payload)).toEqual({ ok: false, error: "INVALID_CURSOR" });
  });

  it("rejects an empty id", () => {
    const payload = Buffer.from(
      JSON.stringify({ createdAt: new Date().toISOString(), id: "" }),
      "utf8",
    ).toString("base64url");
    expect(decodeOrderCursor(payload)).toEqual({ ok: false, error: "INVALID_CURSOR" });
  });

  it("never throws for arbitrary garbage input", () => {
    expect(() => decodeOrderCursor("")).not.toThrow();
    expect(() => decodeOrderCursor("a")).not.toThrow();
    expect(() => decodeOrderCursor("💥not-base64💥")).not.toThrow();
    expect(() => decodeOrderCursor("=".repeat(50))).not.toThrow();
  });
});
