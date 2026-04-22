import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { buildAuthTestApp } from "./helpers/test-auth-app";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";

// Integration tests for F-02 — authentication, sessions, password policy.
// Requires DATABASE_URL (disposable Postgres in CI or local).

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

// A password meeting the F-02 complexity policy.
const VALID_PASSWORD = "Neurogan1!Secure";

describeIfDb("F-02 — /api/auth", () => {
  let app: Express;
  let rawPool: Pool;
  let adminId: string;
  let adminEmail: string;

  beforeAll(async () => {
    app = await buildAuthTestApp();
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
    // Clean tables in FK-safe order.
    await db.delete(schema.passwordHistory);
    await db.delete(schema.userRoles);
    await db.delete(schema.users);

    adminEmail = "admin@test.local";
    const hash = await hashPassword(VALID_PASSWORD);
    const admin = await storage.createUser({
      email: adminEmail,
      fullName: "Admin Seed",
      title: null,
      passwordHash: hash,
      roles: ["ADMIN"],
      createdByUserId: null,
      grantedByUserId: null,
    });
    adminId = admin.id;

    // Reset passwordChangedAt to NOW so login tests don't get mustRotatePassword=true
    // unless the test intentionally sets an expired date.
    await db
      .update(schema.users)
      .set({ passwordChangedAt: new Date() })
      .where(eq(schema.users.id, adminId));
  });

  // ─── POST /api/auth/login ──────────────────────────────

  describe("POST /api/auth/login", () => {
    it("returns 200 + user + session cookie on valid credentials", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: adminEmail, password: VALID_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(adminEmail);
      expect(res.body.user.roles).toContain("ADMIN");
      expect(res.body.user.mustRotatePassword).toBe(false);
      expect(res.headers["set-cookie"]).toBeDefined();
    });

    it("returns 401 on wrong password", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: adminEmail, password: "WrongPassword1!" });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("returns 401 on unknown email", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "nobody@test.local", password: VALID_PASSWORD });

      expect(res.status).toBe(401);
    });

    it("returns 423 ACCOUNT_LOCKED after 5 failed attempts", async () => {
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post("/api/auth/login")
          .send({ email: adminEmail, password: "Wrong1!" });
      }
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: adminEmail, password: "Wrong1!" });

      expect(res.status).toBe(423);
      expect(res.body.error.code).toBe("ACCOUNT_LOCKED");
      expect(res.body.error.details.lockedUntil).toBeDefined();
    });

    it("correct password after lockout also returns 423", async () => {
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post("/api/auth/login")
          .send({ email: adminEmail, password: "Wrong1!" });
      }
      // Even the correct password should be locked out.
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: adminEmail, password: VALID_PASSWORD });

      expect(res.status).toBe(423);
    });

    it("resets failed counter on successful login", async () => {
      // 2 failures, then 1 success — counter should reset.
      for (let i = 0; i < 2; i++) {
        await request(app)
          .post("/api/auth/login")
          .send({ email: adminEmail, password: "Wrong1!" });
      }
      await request(app)
        .post("/api/auth/login")
        .send({ email: adminEmail, password: VALID_PASSWORD });

      const user = await storage.getUserByEmail(adminEmail);
      expect(user?.failedLoginCount).toBe(0);
    });

    it("returns mustRotatePassword: true when password is expired (>90 days)", async () => {
      const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
      await db
        .update(schema.users)
        .set({ passwordChangedAt: ninetyOneDaysAgo })
        .where(eq(schema.users.id, adminId));

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: adminEmail, password: VALID_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.user.mustRotatePassword).toBe(true);
    });
  });

  // ─── POST /api/auth/logout ─────────────────────────────

  describe("POST /api/auth/logout", () => {
    it("returns 204 and clears session", async () => {
      const agent = request.agent(app);
      await agent
        .post("/api/auth/login")
        .send({ email: adminEmail, password: VALID_PASSWORD });

      const logoutRes = await agent.post("/api/auth/logout");
      expect(logoutRes.status).toBe(204);

      // Session should be gone — /api/auth/me should return 401
      const meRes = await agent.get("/api/auth/me");
      expect(meRes.status).toBe(401);
    });
  });

  // ─── GET /api/auth/me ──────────────────────────────────

  describe("GET /api/auth/me", () => {
    it("returns 401 without a session", async () => {
      const res = await request(app).get("/api/auth/me");
      expect(res.status).toBe(401);
    });

    it("returns user + roles + mustRotatePassword after login", async () => {
      const agent = request.agent(app);
      await agent
        .post("/api/auth/login")
        .send({ email: adminEmail, password: VALID_PASSWORD });

      const res = await agent.get("/api/auth/me");
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(adminEmail);
      expect(res.body.roles).toContain("ADMIN");
      expect(typeof res.body.mustRotatePassword).toBe("boolean");
    });
  });

  // ─── POST /api/auth/rotate-password ───────────────────

  describe("POST /api/auth/rotate-password", () => {
    it("returns 401 without a session", async () => {
      const res = await request(app)
        .post("/api/auth/rotate-password")
        .send({ currentPassword: VALID_PASSWORD, newPassword: "NewSecure1!Pass" });
      expect(res.status).toBe(401);
    });

    it("rotates password successfully and resets passwordChangedAt", async () => {
      const agent = request.agent(app);
      await agent
        .post("/api/auth/login")
        .send({ email: adminEmail, password: VALID_PASSWORD });

      const before = await storage.getUserByEmail(adminEmail);
      const NEW_PASSWORD = "NewSecure1!Pass#2";

      const res = await agent
        .post("/api/auth/rotate-password")
        .send({ currentPassword: VALID_PASSWORD, newPassword: NEW_PASSWORD });

      expect(res.status).toBe(204);

      const after = await storage.getUserByEmail(adminEmail);
      expect(after!.passwordChangedAt.getTime()).toBeGreaterThan(before!.passwordChangedAt.getTime());

      // Can log in with new password
      const loginRes = await request(app)
        .post("/api/auth/login")
        .send({ email: adminEmail, password: NEW_PASSWORD });
      expect(loginRes.status).toBe(200);
    });

    it("returns 422 when current password is wrong", async () => {
      const agent = request.agent(app);
      await agent
        .post("/api/auth/login")
        .send({ email: adminEmail, password: VALID_PASSWORD });

      const res = await agent
        .post("/api/auth/rotate-password")
        .send({ currentPassword: "WrongCurrent1!", newPassword: "NewSecure1!Pass" });

      expect(res.status).toBe(422);
      expect(res.body.error.message).toMatch(/current password/i);
    });

    it("returns 422 when new password fails complexity", async () => {
      const agent = request.agent(app);
      await agent
        .post("/api/auth/login")
        .send({ email: adminEmail, password: VALID_PASSWORD });

      const res = await agent
        .post("/api/auth/rotate-password")
        .send({ currentPassword: VALID_PASSWORD, newPassword: "short" });

      expect(res.status).toBe(422);
      expect(res.body.error.details.violations).toBeDefined();
    });

    it("returns 422 on password reuse (same as current)", async () => {
      const agent = request.agent(app);
      await agent
        .post("/api/auth/login")
        .send({ email: adminEmail, password: VALID_PASSWORD });

      const res = await agent
        .post("/api/auth/rotate-password")
        .send({ currentPassword: VALID_PASSWORD, newPassword: VALID_PASSWORD });

      expect(res.status).toBe(422);
      expect(res.body.error.message).toMatch(/used recently/i);
    });
  });

  // ─── Global /api/* auth gate ───────────────────────────

  describe("Global /api/* auth gate", () => {
    it("GET /api/products returns 401 without a session", async () => {
      const res = await request(app).get("/api/products");
      expect(res.status).toBe(401);
    });

    it("GET /api/health returns 200 without a session (public)", async () => {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
    });

    it("GET /api/products returns 200 with valid session", async () => {
      const agent = request.agent(app);
      await agent
        .post("/api/auth/login")
        .send({ email: adminEmail, password: VALID_PASSWORD });

      const res = await agent.get("/api/products");
      expect(res.status).toBe(200);
    });
  });
});
