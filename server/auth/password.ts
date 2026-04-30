import argon2 from "argon2";
import { randomBytes } from "crypto";

// Password hashing + verification per D-02 of FDA/neurogan-erp-build-spec.md:
//
//   argon2id, memoryCost 64 MiB, timeCost 3, parallelism 2.
//
// These parameters balance GPU-resistance (the argon2 design goal) against
// login latency on Railway's container CPUs. A single hash completes in
// ~80–120ms locally; acceptable for a login endpoint and for signature-
// ceremony re-verify (F-04).
//
// Password policy (length/complexity/rotation) is F-02's responsibility; this
// module only owns the hash primitive. Temporary-password generation for
// admin-created users lives here because F-01 needs it before F-02 ships.

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024, // 64 MiB (argon2 measures memoryCost in KiB)
  timeCost: 3,
  parallelism: 2,
} as const;

// Hash a plaintext password. Always includes a fresh random salt internally.
export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new Error("hashPassword: plain must be a non-empty string");
  }
  return argon2.hash(plain, ARGON2_OPTIONS);
}

// Verify a plaintext password against a stored hash. Returns false for any
// malformed hash rather than throwing — the caller (login flow) treats any
// non-true result as a failed attempt.
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  if (typeof hash !== "string" || typeof plain !== "string" || hash.length === 0) {
    return false;
  }
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // argon2.verify throws on malformed hashes. Treat as non-match.
    return false;
  }
}

// Generate a URL-safe random temporary password. 16 bytes base64url → ~22
// chars, over the 12-char D-02 minimum. No longer called by POST /api/users
// (replaced by invite flow T-09) but retained for direct bootstrap scripts.
export function generateTemporaryPassword(): string {
  return randomBytes(16).toString("base64url");
}

// Generate a cryptographically random invite token. 32 bytes → 64 hex chars.
// Never stored plain — callers hash it with hashPassword before persisting.
export function generateInviteToken(): string {
  return randomBytes(32).toString("hex");
}
