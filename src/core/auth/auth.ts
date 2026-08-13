import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

/**
 * Auth.js integration, per TDR-001-Tech-Stack. Login/registration business
 * logic itself lives in the identity module (IMP-027) — this file only
 * wires Auth.js to it and shapes the JWT/session payload.
 *
 * `verifyCredentials` is imported dynamically inside `authorize`, not
 * statically at the top of this file. Identity's own session boundary
 * (`getCurrentUser`) needs to call `auth()` from this exact file, which
 * would make a static top-level import here of `@/modules/identity` a
 * genuine circular module reference. Both directions only ever *call* the
 * other side's export from inside a callback — never at module-evaluation
 * time — so the cycle is safe either way, but resolving Identity's
 * `verifyCredentials` dynamically (only when a sign-in actually happens)
 * avoids relying on that and keeps this file's own static import graph a
 * plain DAG.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const { verifyCredentials } = await import("@/modules/identity");
        const result = await verifyCredentials({ email, password });
        if (!result.ok) {
          return null;
        }

        return { id: result.user.id, email: result.user.email };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.userId === "string") {
        session.user.id = token.userId;
      }
      return session;
    },
  },
});
