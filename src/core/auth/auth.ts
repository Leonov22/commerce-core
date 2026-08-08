import NextAuth from "next-auth";

/**
 * Basic Auth.js integration only, per TDR-001-Tech-Stack and IMP-012 scope.
 * Providers, login/registration flows, and session/authorization business
 * logic belong to the identity module and are intentionally not implemented
 * here.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [],
});
