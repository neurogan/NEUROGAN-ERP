// F-10: Integration tests for validation document endpoints.
//
// Endpoint coverage:
//   GET  /api/validation-documents              — list (no content), QA/ADMIN only
//   GET  /api/validation-documents/:id          — detail with content, QA/ADMIN only
//   POST /api/validation-documents/:id/sign     — e-sig ceremony, QA/ADMIN only
//   GET  /api/validation-documents/:id/signature — signature block or 404
//
// Sign test ordering inside the POST suite is intentional:
//   wrong-password → 403 PRODUCTION → correct password → 409 re-sign
// This ensures the VSR doc is unsigned for the first two cases and signed for
// the last one.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";

import { buildTestApp } from "./helpers/test-app";
import { seedOnce } from "../seed/test";
import { seedIds } from "../seed/ids";
import { hashPassword } from "../auth/password";
import { db } from "../db";
import * as schema from "@shared/schema";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

// Seeded user IDs (from server/seed/ids.ts)
const QA_USER_ID = seedIds.users.carrieTreat;   // roles: QA + ADMIN

// Seeded passwords (from server/seed/test/fixtures/users.ts)
const QA_PASSWORD = "Change_Me_Now!4";

// Production-only user created inline (not seeded) so f10 has no placeholder dependency
let prodUserId: string;

// The VSR document is used for all sign tests; the other 3 stay in DRAFT.
const DOC_ID      = seedIds.validationDocuments.vsrPlatform;
const UNKNOWN_ID  = "00000000-ffff-ffff-ffff-ffffffffffff";

// Reset the VSR document to DRAFT so the sign tests can run deterministically
// regardless of prior runs. Deletes any existing signature rows for the doc
// and clears the signatureId FK before resetting status.
async function resetVsrDocument() {
  // Clear the FK on the document first (avoids FK violation when deleting sig row)
  await db
    .update(schema.validationDocuments)
    .set({ status: "DRAFT", signatureId: null, updatedAt: new Date() })
    .where(eq(schema.validationDocuments.id, DOC_ID));

  // Delete any signature rows that reference this document entity
  await db
    .delete(schema.electronicSignatures)
    .where(eq(schema.electronicSignatures.entityId, DOC_ID));
}

describeIfDb("F-10 — Validation Documents", () => {
  let app: Express;

  beforeAll(async () => {
    await seedOnce();
    app = await buildTestApp();
    // Reset the VSR doc to DRAFT in case a prior test run already signed it.
    await resetVsrDocument();
    // Create a throwaway PRODUCTION-only user for 403 tests.
    const [prodUser] = await db.insert(schema.users).values({
      email: `f10-prod-${Date.now()}@test.com`,
      fullName: "F10 Production",
      passwordHash: await hashPassword("Change_Me_Now!5"),
      createdByUserId: seedIds.users.frederik,
    }).returning();
    prodUserId = prodUser!.id;
    await db.insert(schema.userRoles).values({ userId: prodUserId, role: "PRODUCTION", grantedByUserId: seedIds.users.frederik });
  });

  afterAll(async () => {
    // Clean up carrieTreat's signature so subsequent tests can delete seed users
    await resetVsrDocument();
    if (prodUserId) {
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, prodUserId));
      await db.delete(schema.users).where(eq(schema.users.id, prodUserId));
    }
  });

  // ─── GET /api/validation-documents ─────────────────────────────────────────

  describe("GET /api/validation-documents", () => {
    it("returns 200 list for QA role", async () => {
      const res = await request(app)
        .get("/api/validation-documents")
        .set("x-test-user-id", QA_USER_ID);

      expect(res.status).toBe(200);
      const body = res.body as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(4); // IQ + OQ + PQ + VSR seeded
    });

    it("does not include content field in list response", async () => {
      const res = await request(app)
        .get("/api/validation-documents")
        .set("x-test-user-id", QA_USER_ID);

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>[];
      for (const doc of body) {
        expect(doc).not.toHaveProperty("content");
      }
    });

    it("returns 403 for PRODUCTION role", async () => {
      const res = await request(app)
        .get("/api/validation-documents")
        .set("x-test-user-id", prodUserId);

      expect(res.status).toBe(403);
    });
  });

  // ─── GET /api/validation-documents/:id ─────────────────────────────────────

  describe("GET /api/validation-documents/:id", () => {
    it("returns 200 with content field for QA", async () => {
      const res = await request(app)
        .get(`/api/validation-documents/${DOC_ID}`)
        .set("x-test-user-id", QA_USER_ID);

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body).toHaveProperty("content");
      expect(typeof body.content).toBe("string");
      expect((body.content as string).length).toBeGreaterThan(0);
    });

    it("returns 404 for unknown id", async () => {
      const res = await request(app)
        .get(`/api/validation-documents/${UNKNOWN_ID}`)
        .set("x-test-user-id", QA_USER_ID);

      expect(res.status).toBe(404);
    });

    it("returns 403 for PRODUCTION role", async () => {
      const res = await request(app)
        .get(`/api/validation-documents/${DOC_ID}`)
        .set("x-test-user-id", prodUserId);

      expect(res.status).toBe(403);
    });
  });

  // ─── GET /api/validation-documents/:id/signature — before signing ──────────

  describe("GET /api/validation-documents/:id/signature — before signing", () => {
    it("returns 404 when document is not yet signed", async () => {
      const res = await request(app)
        .get(`/api/validation-documents/${DOC_ID}/signature`)
        .set("x-test-user-id", QA_USER_ID);

      expect(res.status).toBe(404);
    });
  });

  // ─── POST /api/validation-documents/:id/sign ───────────────────────────────
  //
  // Order matters: wrong-password and PRODUCTION-403 run first (doc still DRAFT),
  // then correct-password signs the doc, then re-sign gets 409.

  describe("POST /api/validation-documents/:id/sign", () => {
    it("returns 401 on wrong password and document remains DRAFT", async () => {
      const res = await request(app)
        .post(`/api/validation-documents/${DOC_ID}/sign`)
        .set("x-test-user-id", QA_USER_ID)
        .send({ password: "WrongPassword1!" });

      expect(res.status).toBe(401);

      // Status must still be DRAFT
      const [row] = await db
        .select({ status: schema.validationDocuments.status })
        .from(schema.validationDocuments)
        .where(eq(schema.validationDocuments.id, DOC_ID));
      expect(row?.status).toBe("DRAFT");
    });

    it("returns 403 for PRODUCTION role", async () => {
      const res = await request(app)
        .post(`/api/validation-documents/${DOC_ID}/sign`)
        .set("x-test-user-id", prodUserId)
        .send({ password: "Change_Me_Now!5" });

      expect(res.status).toBe(403);
    });

    it("signs document with correct password: status SIGNED, signature row in DB", async () => {
      const res = await request(app)
        .post(`/api/validation-documents/${DOC_ID}/sign`)
        .set("x-test-user-id", QA_USER_ID)
        .send({ password: QA_PASSWORD, commentary: "VSR sign-off" });

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.status).toBe("SIGNED");

      // Signature row must exist in erp_electronic_signatures
      const sigs = await db
        .select()
        .from(schema.electronicSignatures)
        .where(eq(schema.electronicSignatures.entityId, DOC_ID));
      expect(sigs).toHaveLength(1);
      expect(sigs[0]!.meaning).toBe("APPROVED");
    });

    it("returns 409 ALREADY_SIGNED on re-sign", async () => {
      const res = await request(app)
        .post(`/api/validation-documents/${DOC_ID}/sign`)
        .set("x-test-user-id", QA_USER_ID)
        .send({ password: QA_PASSWORD });

      expect(res.status).toBe(409);
      const body = res.body as { error?: { code?: string } };
      expect(body.error?.code).toBe("ALREADY_SIGNED");
    });
  });

  // ─── GET /api/validation-documents/:id/signature — after signing ───────────

  describe("GET /api/validation-documents/:id/signature — after signing", () => {
    it("returns 200 signature block for signed document", async () => {
      const res = await request(app)
        .get(`/api/validation-documents/${DOC_ID}/signature`)
        .set("x-test-user-id", QA_USER_ID);

      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body).toHaveProperty("id");
      expect(body).toHaveProperty("meaning");
      expect(body).toHaveProperty("signedAt");
    });

    it("returns 403 for PRODUCTION role", async () => {
      const res = await request(app)
        .get(`/api/validation-documents/${DOC_ID}/signature`)
        .set("x-test-user-id", prodUserId);
      expect(res.status).toBe(403);
    });
  });
});
