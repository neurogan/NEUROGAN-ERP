import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { requireAuth, requireRole, requireRoleOrSelf, type AuthedUser } from "./middleware";
import { AppError } from "../errors";

// Helper: build a minimal mock Request. Only needs `.user` for these tests.
function mockReq(user?: AuthedUser, overrides: Partial<Request> = {}): Request {
  return { user, ...overrides } as unknown as Request;
}

// Minimal mock Response + next() — middleware only calls next().
function mockRes(): Response {
  return {} as unknown as Response;
}

function captureNext(): { next: NextFunction; calledWith: () => unknown } {
  let err: unknown = "NOT_CALLED";
  const fn: NextFunction = (e?: unknown) => {
    err = e ?? undefined;
  };
  return {
    next: fn,
    calledWith: () => err,
  };
}

const activeAdmin: AuthedUser = {
  id: "u-1",
  email: "admin@neurogan.com",
  roles: ["ADMIN"],
  status: "ACTIVE",
};

const activeQaAdmin: AuthedUser = {
  id: "u-2",
  email: "carrie@neurogan.com",
  roles: ["QA", "ADMIN"],
  status: "ACTIVE",
};

const activeProd: AuthedUser = {
  id: "u-3",
  email: "prod@neurogan.com",
  roles: ["PRODUCTION"],
  status: "ACTIVE",
};

const disabledAdmin: AuthedUser = {
  id: "u-4",
  email: "old-admin@neurogan.com",
  roles: ["ADMIN"],
  status: "DISABLED",
};

describe("requireAuth", () => {
  it("calls next() with UNAUTHENTICATED when no req.user", () => {
    const cap = captureNext();
    requireAuth(mockReq(undefined), mockRes(), cap.next);
    const err = cap.calledWith();
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("UNAUTHENTICATED");
    expect((err as AppError).status).toBe(401);
  });

  it("calls next() with FORBIDDEN when user is DISABLED", () => {
    const cap = captureNext();
    requireAuth(mockReq(disabledAdmin), mockRes(), cap.next);
    const err = cap.calledWith();
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("FORBIDDEN");
    expect((err as AppError).status).toBe(403);
  });

  it("calls next() with no error when user is ACTIVE", () => {
    const cap = captureNext();
    requireAuth(mockReq(activeAdmin), mockRes(), cap.next);
    expect(cap.calledWith()).toBeUndefined();
  });
});

describe("requireRole", () => {
  it("throws at construction time when no roles passed", () => {
    expect(() => requireRole()).toThrow(/no roles/);
  });

  it("401 when no req.user", () => {
    const cap = captureNext();
    requireRole("ADMIN")(mockReq(undefined), mockRes(), cap.next);
    expect((cap.calledWith() as AppError).code).toBe("UNAUTHENTICATED");
  });

  it("403 when user has none of the allowed roles", () => {
    const cap = captureNext();
    requireRole("ADMIN", "QA")(mockReq(activeProd), mockRes(), cap.next);
    const err = cap.calledWith();
    expect((err as AppError).code).toBe("FORBIDDEN");
    expect((err as AppError).status).toBe(403);
  });

  it("passes when user has the required role", () => {
    const cap = captureNext();
    requireRole("ADMIN")(mockReq(activeAdmin), mockRes(), cap.next);
    expect(cap.calledWith()).toBeUndefined();
  });

  it("passes when user has one of several allowed roles", () => {
    const cap = captureNext();
    requireRole("ADMIN", "QA")(mockReq(activeQaAdmin), mockRes(), cap.next);
    expect(cap.calledWith()).toBeUndefined();
  });

  it("passes when user has ANY overlap with allowed roles (multi-role user)", () => {
    const cap = captureNext();
    // QA + ADMIN user; endpoint needs QA only
    requireRole("QA")(mockReq(activeQaAdmin), mockRes(), cap.next);
    expect(cap.calledWith()).toBeUndefined();
  });
});

describe("requireRoleOrSelf", () => {
  const getId = (req: Request) => req.params?.id as string | undefined;

  it("401 when no req.user", () => {
    const cap = captureNext();
    requireRoleOrSelf(getId, "ADMIN")(
      mockReq(undefined, { params: { id: "u-1" } }),
      mockRes(),
      cap.next,
    );
    expect((cap.calledWith() as AppError).code).toBe("UNAUTHENTICATED");
  });

  it("passes when subject id matches req.user.id", () => {
    const cap = captureNext();
    requireRoleOrSelf(getId, "ADMIN")(
      mockReq(activeProd, { params: { id: activeProd.id } }),
      mockRes(),
      cap.next,
    );
    expect(cap.calledWith()).toBeUndefined();
  });

  it("passes when user lacks role but IS the subject", () => {
    const cap = captureNext();
    requireRoleOrSelf(getId, "ADMIN")(
      mockReq(activeProd, { params: { id: activeProd.id } }),
      mockRes(),
      cap.next,
    );
    expect(cap.calledWith()).toBeUndefined();
  });

  it("passes when user has the role (even if not subject)", () => {
    const cap = captureNext();
    requireRoleOrSelf(getId, "ADMIN")(
      mockReq(activeAdmin, { params: { id: "different-id" } }),
      mockRes(),
      cap.next,
    );
    expect(cap.calledWith()).toBeUndefined();
  });

  it("403 when user lacks role AND is not subject", () => {
    const cap = captureNext();
    requireRoleOrSelf(getId, "ADMIN")(
      mockReq(activeProd, { params: { id: "different-id" } }),
      mockRes(),
      cap.next,
    );
    expect((cap.calledWith() as AppError).code).toBe("FORBIDDEN");
  });
});

// Silence vitest's warning that vi is imported but currently unused
void vi;
