import { NextResponse } from "next/server";
import { registerUser } from "@/modules/identity";
import { parseRegistrationRequestBody } from "@/app/api/auth/register/parse-registration-request";

/**
 * Registration boundary for the Customer authentication surface (IMP-028).
 *
 * POST /api/auth/register
 *
 * Transport only — every registration rule (email format, minimum password
 * length, duplicate email, password hashing) lives in `registerUser()` (see
 * `@/modules/identity`). This route never touches Prisma, never
 * re-implements Identity's validation, and never returns a password hash.
 *
 * Does not itself establish a session: the client re-authenticates through
 * Auth.js's existing Credentials sign-in immediately after a successful
 * response, the same flow `/account/login` uses — this endpoint's only job
 * is creating the User row.
 */
export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

  const parsed = parseRegistrationRequestBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await registerUser({ email: parsed.email, password: parsed.password });

    if (!result.ok) {
      switch (result.error) {
        case "INVALID_EMAIL":
          return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
        case "WEAK_PASSWORD":
          return NextResponse.json({ error: "WEAK_PASSWORD" }, { status: 400 });
        case "EMAIL_ALREADY_REGISTERED":
          return NextResponse.json({ error: "EMAIL_ALREADY_REGISTERED" }, { status: 400 });
        default:
          return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
      }
    }

    const { user } = result;
    return NextResponse.json({ user: { id: user.id, email: user.email } }, { status: 201 });
  } catch (error) {
    // Never leak raw database/Prisma errors to the client.
    console.error("[api/auth/register] failed to register user", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
