import type { UserRepository } from "@/modules/identity/repositories/user-repository";
import type { User } from "@/modules/identity/domain/user";

/**
 * IMP-048 Increment 4: the Admin Panel's stock-history view needs to
 * display which administrator made a given `StockAdjustment` — the
 * repository-level `UserRepository.findById` this wraps already existed
 * (for session resolution, see `current-user.ts`), but had no public,
 * display-purpose entry point of its own. This is that entry point: a
 * plain by-id lookup, never exposing `passwordHash` (the `User` shape
 * already excludes it).
 */
export async function getUserById(repository: UserRepository, id: string): Promise<User | null> {
  return repository.findById(id);
}
