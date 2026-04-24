import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { Pool } from "pg";

import { buildTestApp } from "./helpers/test-app";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { db } from "../db";
import * as schema from "@shared/schema";

// F-06 integration tests: no body-supplied identity fields on regulated endpoints.
// Requires DATABASE_URL. Skip cleanly when not set.

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const VALID_PASSWORD = "Neurogan1!Secure";

async function cleanDb() {
  await db.delete(schema.electronicSignatures);
  await db.delete(schema.auditTrail);
  await db.delete(schema.coaDocuments);
  await db.delete(schema.receivingRecords);
  await db.delete(schema.batchProductionRecords);
  await db.delete(schema.productionBatches);
  await db.delete(schema.lots);
  await db.delete(schema.products);
  await db.delete(schema.passwordHistory);
  await db.delete(schema.userRoles);
  await db.delete(schema.users);
}

async function seedUser(email: string, roles: schema.UserRole[] = ["QA"]) {
  const hash = await hashPassword(VALID_PASSWORD);
  return storage.createUser({
    email,
    fullName: "Test QA",
    title: "QC Reviewer",
    passwordHash: hash,
    roles,
    createdByUserId: null,
    grantedByUserId: null,
  });
}

async function seedProduct(suffix: string) {
  const [row] = await db
    .insert(schema.products)
    .values({ name: `Test Product ${suffix}`, sku: `SKU-${suffix}`, defaultUom: "kg", isActive: true })
    .returning();
  return row!;
}

async function seedLot(productId: string, suffix: string) {
  const [row] = await db
    .insert(schema.lots)
    .values({ productId, lotNumber: `LOT-${suffix}` })
    .returning();
  return row!;
}

describeIfDb("F-06 — no body-supplied identity fields", () => {
  let app: Express;
  let rawPool: Pool;
  let qaUser: schema.UserResponse;
  let viewerUser: schema.UserResponse;

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
    qaUser = await seedUser("qa@f06.test", ["QA"]);
    viewerUser = await seedUser("viewer@f06.test", ["VIEWER"]);
  });

  // ── /api/receiving/:id/qc-review ─────────────────────────────────────────

  describe("POST /api/receiving/:id/qc-review", () => {
    async function makeReceivingRecord() {
      const product = await seedProduct("RCV");
      const lot = await seedLot(product.id, "RCV-001");
      const [rec] = await db
        .insert(schema.receivingRecords)
        .values({ lotId: lot.id, uniqueIdentifier: "RCV-F06-001", status: "PENDING_QC" })
        .returning();
      // Gate 3 requires at least one COA before APPROVED
      await db.insert(schema.coaDocuments).values({ lotId: lot.id, sourceType: "SUPPLIER", overallResult: "PASS" });
      return rec!;
    }

    it("rejects reviewedBy in body → 400 IDENTITY_IN_BODY", async () => {
      const rec = await makeReceivingRecord();
      const res = await request(app)
        .post(`/api/receiving/${rec.id}/qc-review`)
        .set("x-test-user-id", qaUser.id)
        .send({ disposition: "APPROVED", reviewedBy: "Alice", password: VALID_PASSWORD });
      expect(res.status).toBe(400);
      expect((res.body as { error?: { code?: string } }).error?.code).toBe("IDENTITY_IN_BODY");
    });

    it("returns 401 without auth", async () => {
      const res = await request(app)
        .post("/api/receiving/fake-id/qc-review")
        .send({ disposition: "APPROVED", password: VALID_PASSWORD });
      expect(res.status).toBe(401);
    });

    it("returns 403 for VIEWER role", async () => {
      const rec = await makeReceivingRecord();
      const res = await request(app)
        .post(`/api/receiving/${rec.id}/qc-review`)
        .set("x-test-user-id", viewerUser.id)
        .send({ disposition: "APPROVED", password: VALID_PASSWORD });
      expect(res.status).toBe(403);
    });

    it("returns 400 when password is missing", async () => {
      const rec = await makeReceivingRecord();
      const res = await request(app)
        .post(`/api/receiving/${rec.id}/qc-review`)
        .set("x-test-user-id", qaUser.id)
        .send({ disposition: "APPROVED" });
      expect(res.status).toBe(400);
    });

    it("returns 200 and creates signature row with correct creds", async () => {
      const rec = await makeReceivingRecord();
      const res = await request(app)
        .post(`/api/receiving/${rec.id}/qc-review`)
        .set("x-test-user-id", qaUser.id)
        .send({ disposition: "APPROVED", password: VALID_PASSWORD });
      expect(res.status).toBe(200);
      const rows = await storage.listSignatures("receiving_record", rec.id);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]!.meaning).toBe("QC_DISPOSITION");
    });
  });

  // ── /api/coa/:id/qc-review ───────────────────────────────────────────────

  describe("POST /api/coa/:id/qc-review", () => {
    async function makeCoaDocument() {
      const product = await seedProduct("COA");
      const lot = await seedLot(product.id, "COA-001");
      const [doc] = await db
        .insert(schema.coaDocuments)
        .values({ lotId: lot.id, sourceType: "SUPPLIER" })
        .returning();
      return doc!;
    }

    it("rejects reviewedBy in body → 400 IDENTITY_IN_BODY", async () => {
      const coa = await makeCoaDocument();
      const res = await request(app)
        .post(`/api/coa/${coa.id}/qc-review`)
        .set("x-test-user-id", qaUser.id)
        .send({ accepted: true, reviewedBy: "Alice", password: VALID_PASSWORD });
      expect(res.status).toBe(400);
      expect((res.body as { error?: { code?: string } }).error?.code).toBe("IDENTITY_IN_BODY");
    });

    it("returns 401 without auth", async () => {
      const res = await request(app)
        .post("/api/coa/fake-id/qc-review")
        .send({ accepted: true, password: VALID_PASSWORD });
      expect(res.status).toBe(401);
    });

    it("returns 403 for VIEWER role", async () => {
      const coa = await makeCoaDocument();
      const res = await request(app)
        .post(`/api/coa/${coa.id}/qc-review`)
        .set("x-test-user-id", viewerUser.id)
        .send({ accepted: true, password: VALID_PASSWORD });
      expect(res.status).toBe(403);
    });

    it("returns 400 when accepted is not boolean", async () => {
      const coa = await makeCoaDocument();
      const res = await request(app)
        .post(`/api/coa/${coa.id}/qc-review`)
        .set("x-test-user-id", qaUser.id)
        .send({ accepted: "yes", password: VALID_PASSWORD });
      expect(res.status).toBe(400);
    });

    it("returns 200 and creates signature row with correct creds", async () => {
      const coa = await makeCoaDocument();
      const res = await request(app)
        .post(`/api/coa/${coa.id}/qc-review`)
        .set("x-test-user-id", qaUser.id)
        .send({ accepted: true, password: VALID_PASSWORD });
      expect(res.status).toBe(200);
      const rows = await storage.listSignatures("coa_document", coa.id);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]!.meaning).toBe("QC_DISPOSITION");
    });
  });

  // ── /api/batch-production-records/:id/qc-review ──────────────────────────

  describe("POST /api/batch-production-records/:id/qc-review", () => {
    async function makeBprPendingReview() {
      const product = await seedProduct("BPR");
      const [batch] = await db
        .insert(schema.productionBatches)
        .values({
          batchNumber: "BATCH-F06-001",
          productId: product.id,
          plannedQuantity: "100",
          outputUom: "kg",
          status: "IN_PROGRESS",
        })
        .returning();
      const [bpr] = await db
        .insert(schema.batchProductionRecords)
        .values({
          productionBatchId: batch!.id,
          batchNumber: "BPR-F06-001",
          productId: product.id,
          status: "PENDING_QC_REVIEW",
        })
        .returning();
      return bpr!;
    }

    it("rejects reviewedBy in body → 400 IDENTITY_IN_BODY", async () => {
      const bpr = await makeBprPendingReview();
      const res = await request(app)
        .post(`/api/batch-production-records/${bpr.id}/qc-review`)
        .set("x-test-user-id", qaUser.id)
        .send({ disposition: "APPROVED_FOR_DISTRIBUTION", reviewedBy: "Alice", password: VALID_PASSWORD });
      expect(res.status).toBe(400);
      expect((res.body as { error?: { code?: string } }).error?.code).toBe("IDENTITY_IN_BODY");
    });

    it("returns 401 without auth", async () => {
      const res = await request(app)
        .post("/api/batch-production-records/fake-id/qc-review")
        .send({ disposition: "APPROVED_FOR_DISTRIBUTION", password: VALID_PASSWORD });
      expect(res.status).toBe(401);
    });

    it("returns 403 for VIEWER role", async () => {
      const bpr = await makeBprPendingReview();
      const res = await request(app)
        .post(`/api/batch-production-records/${bpr.id}/qc-review`)
        .set("x-test-user-id", viewerUser.id)
        .send({ disposition: "APPROVED_FOR_DISTRIBUTION", password: VALID_PASSWORD });
      expect(res.status).toBe(403);
    });

    it("returns 200 and creates signature row with correct creds", async () => {
      const bpr = await makeBprPendingReview();
      const res = await request(app)
        .post(`/api/batch-production-records/${bpr.id}/qc-review`)
        .set("x-test-user-id", qaUser.id)
        .send({ disposition: "APPROVED_FOR_DISTRIBUTION", password: VALID_PASSWORD });
      expect(res.status).toBe(200);
      const rows = await storage.listSignatures("batch_production_record", bpr.id);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]!.meaning).toBe("QC_DISPOSITION");
    });
  });

  // ── /api/transactions/po-receipt ─────────────────────────────────────────

  describe("POST /api/transactions/po-receipt", () => {
    it("rejects performedBy in body → 400 IDENTITY_IN_BODY", async () => {
      const res = await request(app)
        .post("/api/transactions/po-receipt")
        .set("x-test-user-id", qaUser.id)
        .send({
          lotNumber: "LOT-R-001", productId: "fake", locationId: "fake",
          quantity: "10", uom: "kg", performedBy: "Alice",
        });
      expect(res.status).toBe(400);
      expect((res.body as { error?: { code?: string } }).error?.code).toBe("IDENTITY_IN_BODY");
    });

    it("returns 401 without auth", async () => {
      const res = await request(app)
        .post("/api/transactions/po-receipt")
        .send({ lotNumber: "LOT-R-001", productId: "fake", locationId: "fake", quantity: "10", uom: "kg" });
      expect(res.status).toBe(401);
    });
  });

  // ── /api/production-batches/:id/complete ────────────────────────────────

  describe("POST /api/production-batches/:id/complete", () => {
    it("rejects qcReviewedBy in body → 400 IDENTITY_IN_BODY", async () => {
      const res = await request(app)
        .post("/api/production-batches/fake-id/complete")
        .set("x-test-user-id", qaUser.id)
        .send({
          actualQuantity: "10", outputLotNumber: "FG-001", locationId: "fake",
          qcReviewedBy: "Alice",
        });
      expect(res.status).toBe(400);
      expect((res.body as { error?: { code?: string } }).error?.code).toBe("IDENTITY_IN_BODY");
    });

    it("returns 401 without auth", async () => {
      const res = await request(app)
        .post("/api/production-batches/fake-id/complete")
        .send({ actualQuantity: "10", outputLotNumber: "FG-001", locationId: "fake" });
      expect(res.status).toBe(401);
    });
  });
});
