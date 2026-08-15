/**
 * Public entry point for the identity module. Other modules, the app
 * router, and `@/core/auth` must import identity functionality through
 * here rather than reaching into `@/modules/identity/domain/...`,
 * `.../infrastructure/...`, `.../repositories/...`, or
 * `.../application/...` directly.
 *
 * This is the one module allowed to know Auth.js exists (`getCurrentUser`/
 * `requireAuthenticatedUser` call it internally) — Order, Checkout, and
 * Catalog must depend on this boundary instead, never on `@/core/auth`
 * directly. `@/core/auth/auth.ts`, conversely, depends on this module's
 * `verifyCredentials` (imported dynamically inside its `authorize`
 * callback — see the comment there for why) to check a submitted
 * credential against Identity's own user store.
 */
import "server-only";
import { prismaUserRepository } from "@/modules/identity/infrastructure/prisma-user-repository";
import * as registerUserCommand from "@/modules/identity/application/register-user";
import * as verifyCredentialsCommand from "@/modules/identity/application/verify-credentials";
import * as currentUserCommand from "@/modules/identity/application/current-user";
import type { RegisterUserInput } from "@/modules/identity/application/register-user";
import type { VerifyCredentialsInput } from "@/modules/identity/application/verify-credentials";

export type { User } from "@/modules/identity/domain/user";
export type {
  RegisterUserInput,
  RegisterUserResult,
} from "@/modules/identity/application/register-user";
export type {
  VerifyCredentialsInput,
  VerifyCredentialsResult,
} from "@/modules/identity/application/verify-credentials";
export { UnauthenticatedError } from "@/modules/identity/application/current-user";
export {
  resolveProtectedPageRedirect,
  resolveGuestOnlyPageRedirect,
} from "@/modules/identity/application/account-access";

// Customer-facing account UI (IMP-028) — thin `app/[locale]/account/*`
// pages render these, the same way `checkout/page.tsx` renders
// `CheckoutView` from `@/modules/checkout`.
export { AccountRegisterView } from "@/modules/identity/presentation/account-register-view";
export { AccountLoginView } from "@/modules/identity/presentation/account-login-view";
export { AccountDashboardView } from "@/modules/identity/presentation/account-dashboard-view";
/**
 * The logout action, exported at widget granularity (IMP-036) the same
 * way `@/modules/cart` exports `CartNavLink` — so the app-level layout can
 * compose it into the site header/mobile nav without `shared/` ever
 * importing this module directly.
 */
export { AccountLogoutButton } from "@/modules/identity/components/account-logout-button";

export function registerUser(input: RegisterUserInput) {
  return registerUserCommand.registerUser(prismaUserRepository, input);
}

export function verifyCredentials(input: VerifyCredentialsInput) {
  return verifyCredentialsCommand.verifyCredentials(prismaUserRepository, input);
}

export function getCurrentUser() {
  return currentUserCommand.getCurrentUser(prismaUserRepository);
}

export function requireAuthenticatedUser() {
  return currentUserCommand.requireAuthenticatedUser(prismaUserRepository);
}
