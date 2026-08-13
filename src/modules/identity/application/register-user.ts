import "server-only";
import type { UserRepository } from "@/modules/identity/repositories/user-repository";
import type { User } from "@/modules/identity/domain/user";
import { hashPassword } from "@/modules/identity/application/password";

// Same shape as Checkout's own convention (`checkout/types/checkout.ts`),
// reused here rather than redefined.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export interface RegisterUserInput {
  email: string;
  password: string;
}

export type RegisterUserResult =
  | { ok: true; user: User }
  | { ok: false; error: "INVALID_EMAIL" }
  | { ok: false; error: "WEAK_PASSWORD" }
  | { ok: false; error: "EMAIL_ALREADY_REGISTERED" };

export async function registerUser(
  repository: UserRepository,
  input: RegisterUserInput,
): Promise<RegisterUserResult> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "INVALID_EMAIL" };
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: "WEAK_PASSWORD" };
  }

  const existing = await repository.findByEmail(email);
  if (existing) {
    return { ok: false, error: "EMAIL_ALREADY_REGISTERED" };
  }

  const passwordHash = await hashPassword(input.password);
  const user = await repository.create({ email, passwordHash });
  return { ok: true, user };
}
