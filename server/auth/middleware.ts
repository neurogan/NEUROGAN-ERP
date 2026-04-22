import type { Request, RequestHandler } from "express";
import type { UserRole } from "@shared/schema";
import { errors } from "../errors";

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
