// Structured error codes per FDA/neurogan-erp-build-spec.md §2.2.
//
// Route handlers throw AppError; the Express error middleware (server/index.ts)
// catches and renders `{ error: { code, message, details? } }` with the right
// HTTP status. The code is the stable contract — clients match on code, not
// message. Messages may evolve; codes do not.
//
// When later tickets introduce new codes (e.g. SIGNATURE_REQUIRED in F-04,
// ILLEGAL_TRANSITION in F-05), add them here rather than scattering string
// literals through the codebase.

export type ErrorCode =
  // Foundation (F-01 – F-06)
  | "UNAUTHENTICATED" // F-02: no session
  | "FORBIDDEN" // F-01/F-02: wrong role
  | "VALIDATION_FAILED" // F-01+: Zod parse failed
  | "NOT_FOUND" // F-01+: regulated record missing
  | "DUPLICATE_EMAIL" // F-01: POST /api/users with an email already taken
  | "LAST_ADMIN" // F-01: cannot revoke the last active ADMIN role
  | "SELF_DISABLE" // F-01: cannot disable your own account
  | "IDENTITY_IN_BODY" // F-02: regulated endpoint received an identity field in req.body
  // State machines + signatures (F-04 / F-05)
  | "ILLEGAL_TRANSITION"
  | "SIGNATURE_REQUIRED"
  | "RECORD_LOCKED"
  // Module-specific (filled in by later tickets)
  | "CALIBRATION_OVERDUE"
  | "TRAINING_EXPIRED"
  | "DISQUALIFIED_LAB"
  | "NOT_ON_APPROVED_REGISTRY"
  | "IDENTITY_SAME";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// Convenience constructors — keep call sites short and make the status/code
// pairing discoverable.

export const errors = {
  unauthenticated: (message = "Authentication required") =>
    new AppError("UNAUTHENTICATED", message, 401),

  forbidden: (message = "You do not have permission to perform this action") =>
    new AppError("FORBIDDEN", message, 403),

  validation: (message: string, details?: Record<string, unknown>) =>
    new AppError("VALIDATION_FAILED", message, 422, details),

  notFound: (resource: string) =>
    new AppError("NOT_FOUND", `${resource} not found`, 404),

  duplicateEmail: (email: string) =>
    new AppError("DUPLICATE_EMAIL", `A user with email "${email}" already exists`, 409),

  lastAdmin: () =>
    new AppError(
      "LAST_ADMIN",
      "Cannot remove the ADMIN role from the last active administrator",
      409,
    ),

  selfDisable: () =>
    new AppError("SELF_DISABLE", "You cannot disable your own account", 409),

  identityInBody: (fields: string[]) =>
    new AppError(
      "IDENTITY_IN_BODY",
      `Identity fields are not allowed in the request body: ${fields.join(", ")}`,
      400,
      { fields },
    ),

  illegalTransition: (entityType: string, from: string, to: string) =>
    new AppError(
      "ILLEGAL_TRANSITION",
      `Cannot transition ${entityType} from ${from} to ${to}.`,
      409,
      { entityType, from, to },
    ),

  recordLocked: (entityType: string, currentStatus: string) =>
    new AppError(
      "RECORD_LOCKED",
      `${entityType} is in a terminal state (${currentStatus}) and cannot be modified.`,
      423,
      { entityType, currentStatus },
    ),
};
