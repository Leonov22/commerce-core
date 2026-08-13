import "server-only";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Node's built-in `crypto.scrypt` rather than a third-party hashing
 * library — scrypt is memory-hard and salted per call, and this avoids
 * adding a new dependency for a foundation this minimal.
 */
const scrypt = promisify(scryptCallback);

const KEY_LENGTH = 64;

/** `salt:derivedKey`, both hex-encoded. A fresh random salt every call. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) return false;

  const keyBuffer = Buffer.from(key, "hex");
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;

  // Guards timingSafeEqual's own length-mismatch throw; a corrupt/foreign
  // hash format must fail closed, not crash the caller.
  if (derivedKey.length !== keyBuffer.length) return false;
  return timingSafeEqual(derivedKey, keyBuffer);
}

/**
 * A precomputed, syntactically valid hash of a fixed dummy password —
 * never a real credential. Run through `verifyPassword` when no matching
 * user exists, so a login attempt against an unregistered email takes
 * roughly the same time as one against a real email with a wrong password,
 * closing the timing side-channel that would otherwise let an attacker
 * enumerate registered emails.
 */
export const DUMMY_PASSWORD_HASH =
  "b11e5194bfcc0fd6d867e8c9c155e51e:f017652dee2b57c40ef616b17078ddf825d5027068bf78e66b479f34a393b201431a377dad320841ba55f7a12b1d8307e41f972d92eefa24102d72522d80cd15";
