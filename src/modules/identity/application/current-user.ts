import "server-only";
import { auth } from "@/core/auth/auth";
import type { UserRepository } from "@/modules/identity/repositories/user-repository";
import type { User } from "@/modules/identity/domain/user";

/**
 * Thrown by `requireAuthenticatedUser` so a caller (a future protected API
 * route) can catch this one specific type and map it to a 401, without
 * needing to know anything about Auth.js or session shapes.
 */
export class UnauthenticatedError extends Error {
  constructor() {
    super("No authenticated user.");
    this.name = "UnauthenticatedError";
  }
}

/**
 * The session (`auth()`) is read directly from `@/core/auth/auth`, not
 * injected — the same treatment `checkout-order.ts` gives its one
 * non-injectable external boundary (Catalog's `getProductsByIds`). Tests
 * cover this the same way that file's tests do: mocking `@/core/auth/auth`
 * rather than passing a fake session in.
 */
export async function getCurrentUser(repository: UserRepository): Promise<User | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (typeof userId !== "string" || !userId) {
    return null;
  }
  return repository.findById(userId);
}

export async function requireAuthenticatedUser(repository: UserRepository): Promise<User> {
  const user = await getCurrentUser(repository);
  if (!user) {
    throw new UnauthenticatedError();
  }
  return user;
}
