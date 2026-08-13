import { describe, expect, it } from "vitest";
import { applyUserIdToToken, applyUserIdToSession } from "@/core/auth/session-callbacks";
import type { Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";

/**
 * Regression coverage for the actual Auth.js callback chain
 * (`authorize()` → jwt callback → `token.userId` → session callback →
 * `session.user.id`) — closes CR027-01 / QA-027-T01. `applyUserIdToToken`
 * and `applyUserIdToSession` are the exact functions `auth.ts`'s
 * `callbacks.jwt`/`callbacks.session` delegate to, not a reimplementation
 * of their logic.
 */
describe("applyUserIdToToken", () => {
  it("places the authenticated user's id into token.userId", () => {
    const token = {} as JWT;
    const user: User = { id: "user-123", email: "jane@example.com" };

    const result = applyUserIdToToken(token, user);

    expect(result.userId).toBe("user-123");
    // Same object, mutated and returned — matches what Auth.js expects back.
    expect(result).toBe(token);
  });

  it("never propagates an internal-looking passwordHash field onto the token", () => {
    const token = {} as JWT;
    // Auth.js's real `authorize()` never returns this, but the callback
    // itself must not blindly spread `user` onto `token` regardless.
    const user = {
      id: "user-123",
      email: "jane@example.com",
      passwordHash: "should-never-leak",
    } as User;

    const result = applyUserIdToToken(token, user);

    expect(result.userId).toBe("user-123");
    expect("passwordHash" in result).toBe(false);
  });

  it("leaves token.userId unset when there is no user (existing safe behavior)", () => {
    const token = {} as JWT;

    const result = applyUserIdToToken(token, undefined);

    expect(result.userId).toBeUndefined();
  });
});

describe("applyUserIdToSession", () => {
  it("transfers token.userId to session.user.id", () => {
    const session = { user: {}, expires: "2099-01-01T00:00:00.000Z" } as unknown as Session;
    const token = { userId: "user-123" } as JWT;

    const result = applyUserIdToSession(session, token);

    expect(result.user.id).toBe("user-123");
    expect(result).toBe(session);
  });

  it("never propagates an internal-looking passwordHash field onto the session", () => {
    const session = { user: {}, expires: "2099-01-01T00:00:00.000Z" } as unknown as Session;
    // Simulates a token that somehow picked up an extra claim — the
    // session callback must only ever read `token.userId`, never spread
    // the whole token onto `session.user`.
    const token = { userId: "user-123", passwordHash: "should-never-leak" } as JWT;

    const result = applyUserIdToSession(session, token);

    expect(result.user.id).toBe("user-123");
    expect("passwordHash" in result.user).toBe(false);
    expect("passwordHash" in result).toBe(false);
  });

  it("leaves session.user.id unset when the token has no userId (existing safe behavior)", () => {
    const session = { user: {}, expires: "2099-01-01T00:00:00.000Z" } as unknown as Session;
    const token = {} as JWT;

    const result = applyUserIdToSession(session, token);

    expect("id" in result.user).toBe(false);
  });
});
