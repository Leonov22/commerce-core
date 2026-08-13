import type { Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";

/**
 * The actual token/session shaping logic `auth.ts`'s `callbacks.jwt`/
 * `callbacks.session` delegate to — kept in their own file, separate from
 * `auth.ts`, specifically so they're importable under Vitest: any file that
 * does `import NextAuth from "next-auth"` (as `auth.ts` does) transitively
 * imports `next/server`, which does not resolve outside Next.js's own
 * bundler and makes the importing file impossible to load under plain
 * Node/Vitest. This file only ever imports `next-auth`'s *types*
 * (`import type`, erased at build time), never the package's runtime code,
 * so it has none of that problem. Pure functions: no Prisma, no Auth.js
 * runtime, no side effects beyond mutating and returning the object each
 * is handed, matching exactly what Auth.js's callbacks are expected to do.
 */
export function applyUserIdToToken(token: JWT, user: User | null | undefined): JWT {
  if (user?.id) {
    token.userId = user.id;
  }
  return token;
}

export function applyUserIdToSession(session: Session, token: JWT): Session {
  if (typeof token.userId === "string") {
    session.user.id = token.userId;
  }
  return session;
}
