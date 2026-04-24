import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { Pool } from "pg";

import { buildTestApp } from "./helpers/test-app";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import { performSignature } from "../signatures/signatures";

// F-04 integration tests.
// Requires DATABASE_URL. Skip cleanly when not set.

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const VALID_PASSWORD = "Neurogan1!Secure";
const WRONG_PASSWORD = "WrongPassword1!";

async function seedUser(email: string, roles: schema.UserRole[] = ["ADMIN"]) {
  const hash = await hashPassword(VALID_PASSWORD);
  return storage.createUser({
    email,
    fullName: "Test Signer",
    title: "QC / PCQI",
    passwordHash: hash,
    roles,
    createdByUserId: null,
    grantedByUserId: null,
  });
}

async function cleanDb() {
  await db.update(schema.validationDocuments).set({ signatureId: null });
  await db.delete(schema.electronicSignatures);
  await db.delete(schema.auditTrail);
  await db.delete(schema.passwordHistory);
  await db.delete(schema.userRoles);
  await db.delete(schema.users);
}

describeIfDb("F-04 — electronic signatures", () => {
  let app: Express;
  let rawPool: Pool;
  let signerUser: schema.UserResponse;

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
    await cleanDb();
    signerUser = await seedUser("signer@sig.test");
  });

  // ── Correct password → signature + audit row created atomically ──────────

  it("performSignature: correct password creates sig row + SIGN audit row", async () => {
    let called = false;
    const result = await performSignature(
      {
        userId: signerUser.id,
        password: VALID_PASSWORD,
        meaning: "APPROVED",
        entityType: "batch",
        entityId: "batch-001",
        commentary: "Looks good",
        recordSnapshot: { batchId: "batch-001", status: "PENDING" },
        route: "PATCH /api/batches/batch-001/status",
        requestId: "req-test-001",
      },
      async (_tx) => {
        called = true;
        return { batchId: "batch-001", status: "APPROVED" };
      },
    );

    expect(called).toBe(true);
    expect(result).toMatchObject({ status: "APPROVED" });

    // Signature row exists
    const sigs = await db
      .select()
      .from(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, "batch-001"));
    expect(sigs).toHaveLength(1);
    expect(sigs[0]!.meaning).toBe("APPROVED");
    expect(sigs[0]!.fullNameAtSigning).toBe("Test Signer");
    expect(sigs[0]!.titleAtSigning).toBe("QC / PCQI");
    expect(sigs[0]!.commentary).toBe("Looks good");
    const mf = sigs[0]!.manifestationJson as { text: string };
    expect(mf.text).toContain("Test Signer");
    expect(mf.text).toContain("approved");

    // Audit SIGN row exists
    const audits = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, "batch-001"));
    expect(audits.some((r) => r.action === "SIGN")).toBe(true);
    const signAudit = audits.find((r) => r.action === "SIGN")!;
    expect((signAudit.meta as { meaning: string } | null)?.meaning).toBe("APPROVED");
  });

  // ── Wrong password → 401, nothing persisted ──────────────────────────────

  it("performSignature: wrong password throws 401 and writes nothing", async () => {
    let fnCalled = false;

    await expect(
      performSignature(
        {
          userId: signerUser.id,
          password: WRONG_PASSWORD,
          meaning: "APPROVED",
          entityType: "batch",
          entityId: "batch-002",
          recordSnapshot: {},
          route: null,
          requestId: "req-test-002",
        },
        async (_tx) => {
          fnCalled = true;
          return {};
        },
      ),
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });

    expect(fnCalled).toBe(false);

    const sigs = await db
      .select()
      .from(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, "batch-002"));
    expect(sigs).toHaveLength(0);
  });

  // ── Atomicity: if fn throws, no sig row is written ───────────────────────

  it("performSignature: if fn throws, signature row is rolled back", async () => {
    await expect(
      performSignature(
        {
          userId: signerUser.id,
          password: VALID_PASSWORD,
          meaning: "REVIEWED",
          entityType: "batch",
          entityId: "batch-003",
          recordSnapshot: {},
          route: null,
          requestId: "req-test-003",
        },
        async (_tx) => {
          throw new Error("state change failed");
        },
      ),
    ).rejects.toThrow("state change failed");

    const sigs = await db
      .select()
      .from(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, "batch-003"));
    expect(sigs).toHaveLength(0);
  });

  // ── 5 wrong passwords → account locked ──────────────────────────────────

  it("5 wrong passwords → account locked (423)", async () => {
    for (let i = 0; i < 5; i++) {
      await performSignature(
        {
          userId: signerUser.id,
          password: WRONG_PASSWORD,
          meaning: "APPROVED",
          entityType: "batch",
          entityId: `batch-lock-${i}`,
          recordSnapshot: {},
          route: null,
          requestId: `req-lock-${i}`,
        },
        async (_tx) => ({}),
      ).catch(() => { /* expected */ });
    }

    await expect(
      performSignature(
        {
          userId: signerUser.id,
          password: VALID_PASSWORD, // correct password, but account is locked
          meaning: "APPROVED",
          entityType: "batch",
          entityId: "batch-after-lock",
          recordSnapshot: {},
          route: null,
          requestId: "req-after-lock",
        },
        async (_tx) => ({}),
      ),
    ).rejects.toMatchObject({ status: 423, code: "ACCOUNT_LOCKED" });
  });

  // ── GET /api/signatures returns rows for ADMIN/QA ────────────────────────

  it("GET /api/signatures returns rows after a successful signature", async () => {
    await performSignature(
      {
        userId: signerUser.id,
        password: VALID_PASSWORD,
        meaning: "AUTHORED",
        entityType: "coa",
        entityId: "coa-001",
        recordSnapshot: { coaId: "coa-001" },
        route: null,
        requestId: "req-get-test",
      },
      async (_tx) => ({ coaId: "coa-001", status: "AUTHORED" }),
    );

    const res = await request(app)
      .get("/api/signatures?entityType=coa&entityId=coa-001")
      .set("x-test-user-id", signerUser.id);

    expect(res.status).toBe(200);
    const body = res.body as { rows: unknown[] };
    expect(body.rows).toHaveLength(1);
  });

  it("GET /api/signatures returns 403 for non-ADMIN/QA", async () => {
    const viewer = await seedUser("viewer@sig.test", ["VIEWER"]);
    const res = await request(app)
      .get("/api/signatures?entityType=coa&entityId=coa-999")
      .set("x-test-user-id", viewer.id);
    expect(res.status).toBe(403);
  });

  it("GET /api/signatures returns 422 when entityType or entityId missing", async () => {
    const res = await request(app)
      .get("/api/signatures?entityType=coa")
      .set("x-test-user-id", signerUser.id);
    expect(res.status).toBe(422);
  });
});
