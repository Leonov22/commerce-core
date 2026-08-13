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
export interface User {
  id: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}
