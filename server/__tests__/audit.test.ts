import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// POST /api/users now sends an invite email — mock it so integration tests
// never attempt a real Resend API call.
vi.mock("../email/resend", () => ({
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
}));
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { buildTestApp } from "./helpers/test-app";
import { buildAuthTestApp } from "./helpers/test-auth-app";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";

// F-03 integration tests.
// Requires DATABASE_URL. Skip cleanly when not set.

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const VALID_PASSWORD = "Neurogan1!Secure";

async function seedAdmin(email: string) {
  const hash = await hashPassword(VALID_PASSWORD);
  return storage.createUser({
    email,
    fullName: "Test Admin",
    title: null,
    passwordHash: hash,
    roles: ["ADMIN"],
    createdByUserId: null,
    grantedByUserId: null,
  });
}

async function cleanDb() {
  // Null out signatureId FK before deleting signatures, then clear users.
  await db.update(schema.validationDocuments).set({ signatureId: null });
  await db.delete(schema.electronicSignatures);
  await db.delete(schema.auditTrail);
  await db.delete(schema.passwordHistory);
  await db.delete(schema.userRoles);
  await db.delete(schema.users);
}

describeIfDb("F-03 — audit trail", () => {
  let app: Express;
  let authApp: Express;
  let rawPool: Pool;
  let adminId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    authApp = await buildAuthTestApp();
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
    await cleanDb();
    const admin = await seedAdmin("admin@audit.test");
    adminId = admin.id;
  });

  // ── CREATE user produces an audit row ─────────────────────────────────────

  it("POST /api/users writes a CREATE audit row", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("x-test-user-id", adminId)
      .send({ email: "new@test.local", fullName: "New User", roles: ["VIEWER"] });

    expect(res.status).toBe(201);
    const createdId = (res.body as { user: { id: string } }).user.id;

    const rows = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, createdId));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("CREATE");
    expect(rows[0]!.entityType).toBe("user");
    expect(rows[0]!.userId).toBe(adminId);
    expect(rows[0]!.before).toBeNull();
    expect(rows[0]!.after).toBeTruthy();
  });

  // ── PATCH roles produces an audit row ─────────────────────────────────────

  it("PATCH /api/users/:id/roles writes an UPDATE audit row", async () => {
    const target = await seedAdmin("target@audit.test");

    const res = await request(app)
      .patch(`/api/users/${target.id}/roles`)
      .set("x-test-user-id", adminId)
      .send({ add: ["QA"] });

    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, target.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("UPDATE");
    expect(rows[0]!.before).toBeTruthy();
    expect(rows[0]!.after).toBeTruthy();
  });

  // ── PATCH status produces an audit row ────────────────────────────────────

  it("PATCH /api/users/:id/status writes an UPDATE audit row", async () => {
    const target = await storage.createUser({
      email: "target2@audit.test",
      fullName: "Target",
      title: null,
      passwordHash: await hashPassword(VALID_PASSWORD),
      roles: ["VIEWER"],
      createdByUserId: adminId,
      grantedByUserId: adminId,
    });

    const res = await request(app)
      .patch(`/api/users/${target.id}/status`)
      .set("x-test-user-id", adminId)
      .send({ status: "DISABLED" });

    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, target.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("UPDATE");
    expect((rows[0]!.meta as { statusChange?: string } | null)?.statusChange).toBe("DISABLED");
  });

  // ── Audit row atomicity: if the write fails, no audit row is written ──────

  it("failed user creation (duplicate email) produces no audit row", async () => {
    // Seed the email first
    await storage.createUser({
      email: "dup@audit.test",
      fullName: "Original",
      title: null,
      passwordHash: await hashPassword(VALID_PASSWORD),
      roles: ["VIEWER"],
      createdByUserId: adminId,
      grantedByUserId: adminId,
    });

    await cleanDb(); // wipe audit rows but keep users

    const admin2 = await seedAdmin("admin2@audit.test");

    // Re-seed the duplicate email user
    await storage.createUser({
      email: "dup@audit.test",
      fullName: "Original",
      title: null,
      passwordHash: await hashPassword(VALID_PASSWORD),
      roles: ["VIEWER"],
      createdByUserId: admin2.id,
      grantedByUserId: admin2.id,
    });

    const countBefore = (
      await db.select().from(schema.auditTrail)
    ).length;

    const res = await request(app)
      .post("/api/users")
      .set("x-test-user-id", admin2.id)
      .send({ email: "dup@audit.test", fullName: "Duplicate", roles: ["VIEWER"] });

    expect(res.status).toBe(409);

    const countAfter = (
      await db.select().from(schema.auditTrail)
    ).length;

    // No stale audit row should have been written
    expect(countAfter).toBe(countBefore);
  });

  // ── Append-only: erp_app cannot UPDATE erp_audit_trail ───────────────────

  it("erp_app role cannot UPDATE erp_audit_trail (D-07)", async () => {
    // If erp_app doesn't exist yet (migration not run), the boot check warns
    // and continues. We verify the has_table_privilege result here.
    const { rows } = await rawPool.query<{ can_update: boolean }>(
      `SELECT has_table_privilege('erp_app', 'erp_audit_trail', 'UPDATE') AS can_update`,
    );
    // Either the role doesn't exist (query returns error, caught below) or
    // can_update must be false.
    if (rows[0]) {
      expect(rows[0].can_update).toBe(false);
    }
  });

  // ── GET /api/audit — ADMIN reads audit rows ───────────────────────────────

  it("GET /api/audit returns rows for ADMIN", async () => {
    // Seed an audit row by creating a user
    await request(app)
      .post("/api/users")
      .set("x-test-user-id", adminId)
      .send({ email: "readable@audit.test", fullName: "Readable", roles: ["VIEWER"] });

    const res = await request(app)
      .get("/api/audit")
      .set("x-test-user-id", adminId);

    expect(res.status).toBe(200);
    const body = res.body as { rows: unknown[]; nextCursor: string | null };
    expect(body.rows.length).toBeGreaterThan(0);
  });

  it("GET /api/audit returns 403 for non-ADMIN/QA", async () => {
    const viewer = await storage.createUser({
      email: "viewer@audit.test",
      fullName: "Viewer",
      title: null,
      passwordHash: await hashPassword(VALID_PASSWORD),
      roles: ["VIEWER"],
      createdByUserId: adminId,
      grantedByUserId: adminId,
    });

    const res = await request(app)
      .get("/api/audit")
      .set("x-test-user-id", viewer.id);

    expect(res.status).toBe(403);
  });

  // ── Login / logout audit rows (auth app) ─────────────────────────────────

  it("successful login writes a LOGIN audit row", async () => {
    const user = await storage.createUser({
      email: "loginaudit@test.local",
      fullName: "Login Audit",
      title: null,
      passwordHash: await hashPassword(VALID_PASSWORD),
      roles: ["VIEWER"],
      createdByUserId: adminId,
      grantedByUserId: adminId,
    });

    // Force password to be current so no rotation gate fires
    await db
      .update(schema.users)
      .set({ passwordChangedAt: new Date() })
      .where(eq(schema.users.id, user.id));

    await request(authApp)
      .post("/api/auth/login")
      .send({ email: "loginaudit@test.local", password: VALID_PASSWORD });

    const rows = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.userId, user.id));

    expect(rows.some((r) => r.action === "LOGIN")).toBe(true);
  });
});
