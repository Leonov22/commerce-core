/**
 * Identity domain entity. Framework independent: no Prisma, React, Next.js,
 * or persistence details.
 *
 * Deliberately does not include `passwordHash` — this is the shape handed
 * to callers outside Identity's own repository/application layers (session
 * resolution, future modules), and a credential must never be reachable
 * through it. See `UserRecord` in the repository abstraction for the one
 * internal shape that does carry it.
 */
export type UserRole = "CUSTOMER" | "ADMIN";

export interface User {
  id: string;
  email: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The one place that decides "is this an administrator" (IMP-043) — never
 * inlined as `user.role === "ADMIN"` at call sites, so a future additional
 * admin-like role (if one is ever approved) has exactly one function to
 * change.
 */
export function isAdminUser(user: User): boolean {
  return user.role === "ADMIN";
}
