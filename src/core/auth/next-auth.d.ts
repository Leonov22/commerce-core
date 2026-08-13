import type { DefaultSession } from "next-auth";

/**
 * Augments Auth.js's default types with the one extra field this project's
 * JWT/session callbacks (`auth.ts`) actually populate: the identity
 * module's own User id. Nothing else is added — profile/role fields belong
 * to a future milestone.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
  }
}
