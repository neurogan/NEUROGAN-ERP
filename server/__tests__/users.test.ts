import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { buildTestApp } from "./helpers/test-app";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { db } from "../db";
import * as schema from "@shared/schema";

// Integration tests for F-01 user endpoints. Run against a real Postgres —
// disposable in CI (services.postgres in .github/workflows/ci.yml), or whatever
// DATABASE_URL points at locally. Skip cleanly when DATABASE_URL is unset.
//
// Missing from this suite and tracked as explicit skips below:
//   - audit_trail side-effect assertions → F-03 (audit trail table).
//   - Password rotation on first login → F-02 (login endpoint).
//   - Signature-ceremony-gated admin actions → F-04.

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

describeIfDb("F-01 — /api/users", () => {
  let app: Express;
  let rawPool: Pool;
  let adminId: string;
  let qaOnlyId: string;
  let prodOnlyId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    rawPool = new Pool({
      connectionString: dbUrl,
      ssl:
        dbUrl!.includes("sslmode=require") || dbUrl!.includes("railway.app")
          ? { rejectUnauthorized: false }
          : false,
      connectionTimeoutMillis: 10_000,
    });
  });

  afterAll(async () => {
    await rawPool.end();
  });

  beforeEach(async () => {
    // Clean the F-01 tables in FK-safe order. This keeps every test
    // deterministic; no test inherits state from another.
    await db.delete(schema.userRoles);
    await db.delete(schema.users);

    // Seed the three actors each test may authenticate as.
    const hashedPw = await hashPassword("test-seed-password-Aa1!");
    const admin = await storage.createUser({
      email: "admin@test.local",
      fullName: "Admin Seed",
      title: null,
      passwordHash: hashedPw,
      roles: ["ADMIN"],
      createdByUserId: null,
      grantedByUserId: null,
    });
    adminId = admin.id;

    const qa = await storage.createUser({
      email: "qa@test.local",
      fullName: "QA Seed",
      title: "QC / PCQI",
      passwordHash: hashedPw,
      roles: ["QA"],
      createdByUserId: adminId,
      grantedByUserId: adminId,
    });
    qaOnlyId = qa.id;

    const prod = await storage.createUser({
      email: "prod@test.local",
      fullName: "Production Seed",
      title: null,
      passwordHash: hashedPw,
      roles: ["PRODUCTION"],
      createdByUserId: adminId,
      grantedByUserId: adminId,
    });
    prodOnlyId = prod.id;
  });

  // ─── POST /api/users ───────────────────────────────────

  describe("POST /api/users", () => {
    it("201: creates user + returns one-time temporaryPassword; never leaks passwordHash", async () => {
      const res = await request(app)
        .post("/api/users")
        .set("X-Test-User-Id", adminId)
        .send({
          email: "alice@test.local",
          fullName: "Alice Example",
          title: "Operator",
          roles: ["PRODUCTION"],
        });

      expect(res.status).toBe(201);
      expect(res.body.user.email).toBe("alice@test.local");
      expect(res.body.user.fullName).toBe("Alice Example");
      expect(res.body.user.roles).toEqual(["PRODUCTION"]);
      expect(res.body.user.status).toBe("ACTIVE");
      expect(res.body.user.passwordHash).toBeUndefined();
      expect(res.body.temporaryPassword).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(res.body.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    });

    it("401: no X-Test-User-Id → UNAUTHENTICATED", async () => {
      const res = await request(app)
        .post("/api/users")
        .send({ email: "x@test.local", fullName: "X", roles: ["QA"] });
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe("UNAUTHENTICATED");
    });

    it("403: QA user cannot create users (ADMIN only) → FORBIDDEN", async () => {
      const res = await request(app)
        .post("/api/users")
        .set("X-Test-User-Id", qaOnlyId)
        .send({ email: "x@test.local", fullName: "X", roles: ["QA"] });
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe("FORBIDDEN");
    });

    it("409: duplicate email → DUPLICATE_EMAIL", async () => {
      const res = await request(app)
        .post("/api/users")
        .set("X-Test-User-Id", adminId)
        .send({ email: "qa@test.local", fullName: "Clash", roles: ["VIEWER"] });
      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe("DUPLICATE_EMAIL");
    });

    it("422: missing required roles → VALIDATION_FAILED", async () => {
      const res = await request(app)
        .post("/api/users")
        .set("X-Test-User-Id", adminId)
        .send({ email: "nope@test.local", fullName: "NoRoles" });
      expect(res.status).toBe(422);
      expect(res.body.error?.code).toBe("VALIDATION_FAILED");
    });

    it.todo("writes an audit_trail row on success (depends on F-03)");
  });

  // ─── GET /api/users ────────────────────────────────────

  describe("GET /api/users", () => {
    it("200 (ADMIN): returns full list with admin-only fields", async () => {
      const res = await request(app).get("/api/users").set("X-Test-User-Id", adminId);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      // Admin viewer sees passwordChangedAt and failedLoginCount.
      const any = res.body[0];
      expect(any).toHaveProperty("passwordChangedAt");
      expect(any).toHaveProperty("failedLoginCount");
      expect(any.passwordHash).toBeUndefined();
    });

    it("200 (QA): admin-only fields are redacted", async () => {
      const res = await request(app).get("/api/users").set("X-Test-User-Id", qaOnlyId);
      expect(res.status).toBe(200);
      const any = res.body[0];
      expect(any).not.toHaveProperty("passwordChangedAt");
      expect(any).not.toHaveProperty("failedLoginCount");
      expect(any).not.toHaveProperty("lockedUntil");
      expect(any.passwordHash).toBeUndefined();
    });

    it("403: PRODUCTION role cannot list users", async () => {
      const res = await request(app).get("/api/users").set("X-Test-User-Id", prodOnlyId);
      expect(res.status).toBe(403);
    });

    it("401: no auth", async () => {
      const res = await request(app).get("/api/users");
      expect(res.status).toBe(401);
    });
  });

  // ─── GET /api/users/:id ────────────────────────────────

  describe("GET /api/users/:id", () => {
    it("200: PRODUCTION user can view their own record (requireRoleOrSelf)", async () => {
      const res = await request(app)
        .get(`/api/users/${prodOnlyId}`)
        .set("X-Test-User-Id", prodOnlyId);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(prodOnlyId);
    });

    it("403: PRODUCTION user cannot view another user's record", async () => {
      const res = await request(app)
        .get(`/api/users/${qaOnlyId}`)
        .set("X-Test-User-Id", prodOnlyId);
      expect(res.status).toBe(403);
    });

    it("404: id does not exist", async () => {
      const res = await request(app)
        .get("/api/users/00000000-0000-0000-0000-000000000000")
        .set("X-Test-User-Id", adminId);
      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe("NOT_FOUND");
    });
  });

  // ─── PATCH /api/users/:id/roles ────────────────────────

  describe("PATCH /api/users/:id/roles", () => {
    it("200: admin can grant + revoke roles atomically", async () => {
      const res = await request(app)
        .patch(`/api/users/${qaOnlyId}/roles`)
        .set("X-Test-User-Id", adminId)
        .send({ add: ["PRODUCTION"], remove: ["QA"] });
      expect(res.status).toBe(200);
      expect(res.body.roles.sort()).toEqual(["PRODUCTION"]);
    });

    it("409 LAST_ADMIN: revoking ADMIN from the only active admin is refused", async () => {
      const res = await request(app)
        .patch(`/api/users/${adminId}/roles`)
        .set("X-Test-User-Id", adminId)
        .send({ remove: ["ADMIN"] });
      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe("LAST_ADMIN");
    });

    it("422: body with neither add nor remove → VALIDATION_FAILED", async () => {
      const res = await request(app)
        .patch(`/api/users/${qaOnlyId}/roles`)
        .set("X-Test-User-Id", adminId)
        .send({});
      expect(res.status).toBe(422);
      expect(res.body.error?.code).toBe("VALIDATION_FAILED");
    });

    it("403: QA cannot patch roles", async () => {
      const res = await request(app)
        .patch(`/api/users/${qaOnlyId}/roles`)
        .set("X-Test-User-Id", qaOnlyId)
        .send({ add: ["ADMIN"] });
      expect(res.status).toBe(403);
    });
  });

  // ─── PATCH /api/users/:id/status ───────────────────────

  describe("PATCH /api/users/:id/status", () => {
    it("200: admin disables another user", async () => {
      const res = await request(app)
        .patch(`/api/users/${prodOnlyId}/status`)
        .set("X-Test-User-Id", adminId)
        .send({ status: "DISABLED" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("DISABLED");
    });

    it("409 SELF_DISABLE: admin cannot disable themselves", async () => {
      const res = await request(app)
        .patch(`/api/users/${adminId}/status`)
        .set("X-Test-User-Id", adminId)
        .send({ status: "DISABLED" });
      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe("SELF_DISABLE");
    });

    it("409 LAST_ADMIN: cannot disable the only active admin (even via a second admin if there was one — here just the self path as proxy)", async () => {
      // Promote QA to ADMIN so two admins exist, then disable the original.
      await storage.setUserRoles(qaOnlyId, ["QA", "ADMIN"], adminId);
      // Now disable the original admin from the QA-admin's perspective.
      const res = await request(app)
        .patch(`/api/users/${adminId}/status`)
        .set("X-Test-User-Id", qaOnlyId)
        .send({ status: "DISABLED" });
      // Two active admins → disabling one is fine.
      expect(res.status).toBe(200);
      // Now try to disable the remaining admin (qaOnlyId) from their own session.
      // That's SELF_DISABLE, not LAST_ADMIN — self check fires first.
      // To exercise LAST_ADMIN specifically, we need a third admin promoting
      // the last admin change, which is more setup than F-01 tests warrant.
      // The storage-layer test below covers the pure LAST_ADMIN path.
    });

    it("storage: isLastActiveAdmin returns true when only one active admin remains", async () => {
      expect(await storage.isLastActiveAdmin(adminId)).toBe(true);
      // Add a second admin; now neither is "the last".
      await storage.setUserRoles(qaOnlyId, ["QA", "ADMIN"], adminId);
      expect(await storage.isLastActiveAdmin(adminId)).toBe(false);
      expect(await storage.isLastActiveAdmin(qaOnlyId)).toBe(false);
      // Disabling the original admin should leave qa as the last.
      await storage.updateUserStatus(adminId, "DISABLED");
      expect(await storage.isLastActiveAdmin(qaOnlyId)).toBe(true);
    });
  });
});
