// Password policy per D-02 of FDA/neurogan-erp-build-spec.md and NIST 800-63B:
//   ≥ 8 characters, ≥ 1 uppercase, ≥ 1 lowercase, ≥ 1 digit, ≥ 1 symbol.
//   90-day rotation window (soft-gate on login; hard-gate on rotate endpoint).
//   No reuse of previous 5 hashes (checked at the storage layer — this module
//   owns only the synchronous policy logic).

export interface PolicyViolation {
  code: string;
  message: string;
}

export interface PolicyResult {
  valid: boolean;
  violations: PolicyViolation[];
}

const MIN_LENGTH = 8;
const ROTATION_DAYS = 90;

export function validatePasswordComplexity(password: string): PolicyResult {
  const violations: PolicyViolation[] = [];

  if (password.length < MIN_LENGTH) {
    violations.push({
      code: "TOO_SHORT",
      message: `Password must be at least ${MIN_LENGTH} characters.`,
    });
  }
  if (!/[A-Z]/.test(password)) {
    violations.push({ code: "NO_UPPERCASE", message: "Password must contain at least one uppercase letter." });
  }
  if (!/[a-z]/.test(password)) {
    violations.push({ code: "NO_LOWERCASE", message: "Password must contain at least one lowercase letter." });
  }
  if (!/[0-9]/.test(password)) {
    violations.push({ code: "NO_DIGIT", message: "Password must contain at least one digit." });
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    violations.push({ code: "NO_SYMBOL", message: "Password must contain at least one symbol." });
  }

  return { valid: violations.length === 0, violations };
}

export function isPasswordExpired(passwordChangedAt: Date): boolean {
  const cutoff = new Date(Date.now() - ROTATION_DAYS * 24 * 60 * 60 * 1000);
  return passwordChangedAt < cutoff;
}
