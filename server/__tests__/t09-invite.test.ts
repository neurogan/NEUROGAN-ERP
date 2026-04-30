import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";
import { buildTestApp } from "./helpers/test-app";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { sendInviteEmail } from "../email/resend";

// Mock the Resend email module so tests never hit the real API.
vi.mock("../email/resend", () => ({
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
}));

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

describeIfDb("T-09 — invite lifecycle", () => {
  let app: Express;
  let adminId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    vi.mocked(sendInviteEmail).mockClear();

    await db.delete(schema.auditTrail);
    await db.delete(schema.passwordHistory);
    await db.delete(schema.userRoles);
    await db.delete(schema.users);

    const hashedPw = await hashPassword("SeedPassword1!");
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
  });

  // Helper: create an invited user and capture the rawToken from the mock
  async function createInvitedUser(email: string): Promise<string> {
    await request(app)
      .post("/api/users")
      .set("X-Test-User-Id", adminId)
      .send({ email, fullName: "Test User", roles: ["VIEWER"] });
    const rawToken = vi.mocked(sendInviteEmail).mock.calls.at(-1)![1] as string;
    vi.mocked(sendInviteEmail).mockClear();
    return rawToken;
  }

  // ─── POST /api/users ───────────────────────────────────────────────────

  describe("POST /api/users", () => {
    it("201: creates PENDING_INVITE user; calls sendInviteEmail; no temporaryPassword", async () => {
      const res = await request(app)
        .post("/api/users")
        .set("X-Test-User-Id", adminId)
        .send({ email: "alice@test.local", fullName: "Alice", roles: ["PRODUCTION"] });

      expect(res.status).toBe(201);
      expect(res.body.user.status).toBe("PENDING_INVITE");
      expect(res.body.temporaryPassword).toBeUndefined();
      expect(vi.mocked(sendInviteEmail)).toHaveBeenCalledOnce();
      expect(vi.mocked(sendInviteEmail).mock.calls[0][0]).toBe("alice@test.local");
    });
  });

    it("502: returns EMAIL_DELIVERY_FAILED when Resend throws; no user created", async () => {
      vi.mocked(sendInviteEmail).mockRejectedValueOnce(new Error("Resend unavailable"));

      const res = await request(app)
        .post("/api/users")
        .set("X-Test-User-Id", adminId)
        .send({ email: "ghost@test.local", fullName: "Ghost", roles: ["VIEWER"] });

      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe("EMAIL_DELIVERY_FAILED");

      // Confirm no user row was written
      const users = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, "ghost@test.local"));
      expect(users).toHaveLength(0);
    });
  });

  // ─── POST /api/auth/login (PENDING_INVITE block) ───────────────────────

  describe("POST /api/auth/login — PENDING_INVITE block", () => {
    it("401 INVITE_PENDING: pending-invite user cannot log in", async () => {
      await createInvitedUser("bob@test.local");

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "bob@test.local", password: "anything" });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVITE_PENDING");
    });
  });

  // ─── POST /api/auth/accept-invite ─────────────────────────────────────

  describe("POST /api/auth/accept-invite", () => {
    it("200: valid token → status=ACTIVE, token columns cleared", async () => {
      const rawToken = await createInvitedUser("carol@test.local");

      const res = await request(app)
        .post("/api/auth/accept-invite")
        .send({ token: rawToken, email: "carol@test.local", password: "MyNewPass1!" });

      expect(res.status).toBe(200);
      expect(res.body.user.status).toBe("ACTIVE");
      expect(res.body.user.email).toBe("carol@test.local");

      // Verify token columns are NULL in DB
      const [dbRow] = await db
        .select({ hash: schema.users.inviteTokenHash, exp: schema.users.inviteTokenExpiresAt })
        .from(schema.users)
        .where(eq(schema.users.email, "carol@test.local"))
        .limit(1);
      expect(dbRow.hash).toBeNull();
      expect(dbRow.exp).toBeNull();
    });

    it("400 INVITE_INVALID: token cannot be reused after acceptance", async () => {
      const rawToken = await createInvitedUser("carol2@test.local");
      await request(app)
        .post("/api/auth/accept-invite")
        .send({ token: rawToken, email: "carol2@test.local", password: "MyNewPass1!" });

      const reuse = await request(app)
        .post("/api/auth/accept-invite")
        .send({ token: rawToken, email: "carol2@test.local", password: "AnotherPass1!" });
      expect(reuse.status).toBe(400);
      expect(reuse.body.error.code).toBe("INVITE_INVALID");
    });

    it("400 INVITE_INVALID: wrong token", async () => {
      await createInvitedUser("dave@test.local");

      const res = await request(app)
        .post("/api/auth/accept-invite")
        .send({ token: "a".repeat(64), email: "dave@test.local", password: "MyNewPass1!" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVITE_INVALID");
    });

    it("400 INVITE_INVALID: unknown email", async () => {
      const res = await request(app)
        .post("/api/auth/accept-invite")
        .send({ token: "sometoken", email: "nobody@test.local", password: "MyNewPass1!" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVITE_INVALID");
    });

    it("422 VALIDATION_FAILED: password too weak", async () => {
      const rawToken = await createInvitedUser("eve@test.local");

      const res = await request(app)
        .post("/api/auth/accept-invite")
        .send({ token: rawToken, email: "eve@test.local", password: "short" });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_FAILED");
    });
  });

  // ─── POST /api/users/:id/resend-invite ────────────────────────────────

  describe("POST /api/users/:id/resend-invite", () => {
    it("204: resends with new token; old token no longer works", async () => {
      const firstToken = await createInvitedUser("frank@test.local");

      // Get frank's id
      const listRes = await request(app).get("/api/users").set("X-Test-User-Id", adminId);
      const frank = (listRes.body as Array<{ email: string; id: string }>).find(
        (u) => u.email === "frank@test.local",
      );
      expect(frank).toBeDefined();

      const resendRes = await request(app)
        .post(`/api/users/${frank!.id}/resend-invite`)
        .set("X-Test-User-Id", adminId);
      expect(resendRes.status).toBe(204);
      expect(vi.mocked(sendInviteEmail)).toHaveBeenCalledOnce();

      const secondToken = vi.mocked(sendInviteEmail).mock.calls.at(-1)![1] as string;
      expect(secondToken).not.toBe(firstToken);

      // Old token fails
      const oldRes = await request(app)
        .post("/api/auth/accept-invite")
        .send({ token: firstToken, email: "frank@test.local", password: "MyNewPass1!" });
      expect(oldRes.status).toBe(400);

      // New token works
      const newRes = await request(app)
        .post("/api/auth/accept-invite")
        .send({ token: secondToken, email: "frank@test.local", password: "MyNewPass1!" });
      expect(newRes.status).toBe(200);
    });

    it("400: cannot resend to already-active user", async () => {
      const res = await request(app)
        .post(`/api/users/${adminId}/resend-invite`)
        .set("X-Test-User-Id", adminId);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("403: non-admin cannot resend invite", async () => {
      const hashedPw = await hashPassword("SeedPassword1!");
      const qa = await storage.createUser({
        email: "qa@test.local",
        fullName: "QA",
        title: null,
        passwordHash: hashedPw,
        roles: ["QA"],
        createdByUserId: adminId,
        grantedByUserId: adminId,
      });

      const res = await request(app)
        .post(`/api/users/${adminId}/resend-invite`)
        .set("X-Test-User-Id", qa.id);
      expect(res.status).toBe(403);
    });

    it("404: user not found", async () => {
      const res = await request(app)
        .post("/api/users/00000000-0000-0000-0000-000000000000/resend-invite")
        .set("X-Test-User-Id", adminId);
      expect(res.status).toBe(404);
    });
  });
});
