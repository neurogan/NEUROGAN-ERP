import { createHmac, timingSafeEqual } from "crypto";
import type { Request, RequestHandler } from "express";
import type { UserRole } from "@shared/schema";
import { errors } from "../errors";
import { getLatestRecord } from "../storage/training";

// F-01 defines the auth middleware. F-02 populates req.user via
// express-session + passport and mounts requireAuth globally. Until then,
// req.user is always undefined and these guards always short-circuit to 401.
// That's the correct answer — unauthenticated requests to regulated endpoints
// MUST 401 (AGENTS.md §4.4, spec D-10). Regulated endpoints just aren't
// callable at all until F-02 ships.
//
// The req.user type augmentation lives in server/types/express.d.ts.

export type AuthedUser = NonNullable<Request["user"]>;

// Reject requests that have no authenticated user attached. DISABLED users are
// treated as unauthorized — their session should have been terminated on
// status change, but belt-and-suspenders here prevents a stale cookie from
// working.
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(errors.unauthenticated());
  if (req.user.status !== "ACTIVE") {
    return next(errors.forbidden("Your account is disabled."));
  }
  return next();
};

// Allow only users who have AT LEAST ONE of the listed roles. Combine with
// requireAuth (order matters — auth must run first, otherwise the no-user
// case falls through to 403 instead of 401).
//
// Usage:
//   app.post("/api/users", requireAuth, requireRole("ADMIN"), handler)
//   app.get("/api/users/:id", requireAuth, requireRole("ADMIN", "QA"), handler)
export function requireRole(...allowedRoles: readonly UserRole[]): RequestHandler {
  if (allowedRoles.length === 0) {
    throw new Error("requireRole called with no roles; did you mean requireAuth?");
  }
  return (req, _res, next) => {
    if (!req.user) return next(errors.unauthenticated());
    const hasAllowedRole = req.user.roles.some((r) => allowedRoles.includes(r));
    if (!hasAllowedRole) {
      return next(
        errors.forbidden(
          `This endpoint requires one of the following roles: ${allowedRoles.join(", ")}`,
        ),
      );
    }
    return next();
  };
}

// Allow a user to act on their own record OR act in any of the given roles.
// Used by GET /api/users/:id so a user can view themselves without ADMIN/QA.
type SubjectIdGetter = (req: Parameters<RequestHandler>[0]) => string | undefined;

// Reject any request whose body contains fields that carry identity — used on
// regulated endpoints where identity must come from req.user.id (D-10).
// Example: rejectIdentityInBody(["reviewedBy", "performedBy"])
export function rejectIdentityInBody(fields: string[]): RequestHandler {
  return (req, _res, next) => {
    const body = req.body as Record<string, unknown>;
    const present = fields.filter((f) => Object.prototype.hasOwnProperty.call(body, f));
    if (present.length > 0) {
      return next(errors.identityInBody(present));
    }
    return next();
  };
}

// Dual-auth for the HelpCore intake endpoint.
// Accepts either:
//   (a) X-Helpcore-Signature header with a valid HMAC-SHA256, OR
//   (b) an authenticated session with role ADMIN or QA.
// If HELPCORE_INBOUND_SECRET is not set, HMAC path is skipped (manual-only mode).
export const requireHmacOrAuth: RequestHandler = (req, res, next) => {
  const secret = process.env.HELPCORE_INBOUND_SECRET;
  const sigHeader = req.headers["x-helpcore-signature"];

  if (secret && typeof sigHeader === "string") {
    const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const expected = `hmac-sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    try {
      const expectedBuf = Buffer.from(expected);
      const actualBuf = Buffer.from(sigHeader);
      if (expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf)) {
        // HMAC valid — mark as system/HMAC auth for downstream use
        (req as Request & { helpcoreHmacAuth?: boolean }).helpcoreHmacAuth = true;
        return next();
      }
    } catch {
      // fall through to session auth
    }
  }

  // Fall back to session auth
  if (!req.user) return next(errors.unauthenticated());
  if (req.user.status !== "ACTIVE") return next(errors.forbidden("Your account is disabled."));
  const hasRole = req.user.roles.some((r) => r === "ADMIN" || r === "QA");
  if (!hasRole) return next(errors.forbidden("This endpoint requires ADMIN or QA role."));
  return next();
};

// Block regulated actions if the user does not have a current (non-expired)
// training record for the specified program. Returns 409 TRAINING_EXPIRED.
// Apply the same way as requireRole; always combine with requireAuth first.
//
// Usage:
//   app.post("/api/...", requireAuth, requireRole("QA"), requireTraining(CAPA_TRAINING_ID), handler)
export function requireTraining(programId: string): RequestHandler {
  return async (req, _res, next) => {
    if (!req.user) return next(errors.unauthenticated());
    try {
      const record = await getLatestRecord(req.user.id, programId);
      if (!record || record.expiresAt < new Date()) {
        return next(
          Object.assign(new Error("User does not have current training for this program."), {
            status: 409,
            code: "TRAINING_EXPIRED",
          }),
        );
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export function requireRoleOrSelf(
  getSubjectUserId: SubjectIdGetter,
  ...allowedRoles: readonly UserRole[]
): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(errors.unauthenticated());
    const subjectId = getSubjectUserId(req);
    if (subjectId && req.user.id === subjectId) return next();
    const hasAllowedRole = req.user.roles.some((r: UserRole) => allowedRoles.includes(r));
    if (!hasAllowedRole) {
      return next(
        errors.forbidden(
          `This endpoint requires one of the following roles (or being the subject user): ${allowedRoles.join(", ")}`,
        ),
      );
    }
    return next();
  };
}
