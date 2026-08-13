import type { User } from "@/modules/identity/domain/user";

export interface NewUserInput {
  /** Must already be normalized (trimmed, lowercased) by the caller. */
  email: string;
  passwordHash: string;
}

/**
 * The one internal shape that carries `passwordHash`, returned only by
 * `findByEmail` — the single lookup credential verification actually needs
 * it for. Every other repository method returns the public `User` shape.
 */
export interface UserRecord extends User {
  passwordHash: string;
}

/**
 * Read/write abstraction the Identity application layer depends on. Never
 * depends on the Prisma implementation directly — only on this interface.
 * Deliberately minimal: registration, credential lookup, and by-id lookup
 * (for session resolution) are the only operations this foundation needs.
 */
export interface UserRepository {
  create(input: NewUserInput): Promise<User>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<User | null>;
}
