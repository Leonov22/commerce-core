import "server-only";
import type { UserRepository } from "@/modules/identity/repositories/user-repository";
import type { User } from "@/modules/identity/domain/user";
import { verifyPassword, DUMMY_PASSWORD_HASH } from "@/modules/identity/application/password";

export interface VerifyCredentialsInput {
  email: string;
  password: string;
}

export type VerifyCredentialsResult =
  { ok: true; user: User } | { ok: false; error: "INVALID_CREDENTIALS" };

/**
 * One generic failure for both "no such email" and "wrong password" —
 * never distinguished, so a caller (or an attacker probing the sign-in
 * form) cannot enumerate which emails are registered.
 */
export async function verifyCredentials(
  repository: UserRepository,
  input: VerifyCredentialsInput,
): Promise<VerifyCredentialsResult> {
  const email = input.email.trim().toLowerCase();
  const record = await repository.findByEmail(email);

  if (!record) {
    // Runs a real scrypt derivation against a fixed dummy hash so this
    // path takes about as long as the "email exists, password wrong"
    // path below — closes the timing side-channel that would otherwise
    // leak which emails are registered.
    await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
    return { ok: false, error: "INVALID_CREDENTIALS" };
  }

  const isValid = await verifyPassword(input.password, record.passwordHash);
  if (!isValid) {
    return { ok: false, error: "INVALID_CREDENTIALS" };
  }

  const user: User = {
    id: record.id,
    email: record.email,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  return { ok: true, user };
}
