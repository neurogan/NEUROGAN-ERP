import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { Express } from "express";
import request from "supertest";

import { buildTestApp } from "./helpers/test-app";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { db } from "../db";
import * as schema from "@shared/schema";
import {
  assertValidTransition,
  assertNotLocked,
  lotTransitions,
  bprTransitions,
  receivingTransitions,
} from "../state/transitions";
import { AppError } from "../errors";

// F-05: Record lock + state-transition guard.
// Unit tests cover the graph topology; integration tests verify HTTP responses.

// ── Unit Tests ────────────────────────────────────────────────────────────────

describe("F-05 — transition graph (unit)", () => {
  describe("assertValidTransition — lots / receiving_record", () => {
    it("allows QUARANTINED → SAMPLING", () => {
      expect(() => assertValidTransition("lot", "QUARANTINED", "SAMPLING")).not.toThrow();
    });
    it("allows SAMPLING → PENDING_QC", () => {
      expect(() => assertValidTransition("lot", "SAMPLING", "PENDING_QC")).not.toThrow();
    });
    it("allows PENDING_QC → APPROVED", () => {
      expect(() => assertValidTransition("lot", "PENDING_QC", "APPROVED")).not.toThrow();
    });
    it("allows PENDING_QC → REJECTED", () => {
      expect(() => assertValidTransition("lot", "PENDING_QC", "REJECTED")).not.toThrow();
    });
    it("allows PENDING_QC → ON_HOLD", () => {
      expect(() => assertValidTransition("lot", "PENDING_QC", "ON_HOLD")).not.toThrow();
    });
    it("allows ON_HOLD → PENDING_QC", () => {
      expect(() => assertValidTransition("lot", "ON_HOLD", "PENDING_QC")).not.toThrow();
    });
    it("rejects QUARANTINED → APPROVED (skip transition)", () => {
      expect(() => assertValidTransition("lot", "QUARANTINED", "APPROVED"))
        .toThrow(AppError);
    });
    it("rejects APPROVED → PENDING_QC (terminal)", () => {
      expect(() => assertValidTransition("lot", "APPROVED", "PENDING_QC"))
        .toThrow(AppError);
    });
    it("rejects REJECTED → SAMPLING (terminal)", () => {
      expect(() => assertValidTransition("lot", "REJECTED", "SAMPLING"))
        .toThrow(AppError);
    });
    it("rejects nonsense state", () => {
      expect(() => assertValidTransition("lot", "NONSENSE", "APPROVED"))
        .toThrow(AppError);
    });
    it("returns without throwing for unknown entity type", () => {
      expect(() => assertValidTransition("unknown_entity", "ANY", "OTHER")).not.toThrow();
    });
  });

  describe("assertValidTransition — batch_production_record", () => {
    it("allows IN_PROGRESS → PENDING_QC_REVIEW", () => {
      expect(() => assertValidTransition("batch_production_record", "IN_PROGRESS", "PENDING_QC_REVIEW")).not.toThrow();
    });
    it("allows PENDING_QC_REVIEW → APPROVED", () => {
      expect(() => assertValidTransition("batch_production_record", "PENDING_QC_REVIEW", "APPROVED")).not.toThrow();
    });
    it("allows PENDING_QC_REVIEW → REJECTED", () => {
      expect(() => assertValidTransition("batch_production_record", "PENDING_QC_REVIEW", "REJECTED")).not.toThrow();
    });
    it("rejects IN_PROGRESS → APPROVED (skip)", () => {
      expect(() => assertValidTransition("batch_production_record", "IN_PROGRESS", "APPROVED"))
        .toThrow(AppError);
    });
    it("rejects APPROVED → IN_PROGRESS (terminal)", () => {
      expect(() => assertValidTransition("batch_production_record", "APPROVED", "IN_PROGRESS"))
        .toThrow(AppError);
    });
  });

  describe("assertNotLocked", () => {
    it("does not throw for non-terminal lot status", () => {
      expect(() => assertNotLocked("lot", "QUARANTINED")).not.toThrow();
      expect(() => assertNotLocked("lot", "SAMPLING")).not.toThrow();
      expect(() => assertNotLocked("lot", "PENDING_QC")).not.toThrow();
      expect(() => assertNotLocked("lot", "ON_HOLD")).not.toThrow();
    });
    it("throws RECORD_LOCKED for APPROVED lot", () => {
      expect(() => assertNotLocked("lot", "APPROVED")).toThrow(AppError);
      try {
        assertNotLocked("lot", "APPROVED");
      } catch (e) {
        expect((e as AppError).code).toBe("RECORD_LOCKED");
        expect((e as AppError).status).toBe(423);
      }
    });
    it("throws RECORD_LOCKED for REJECTED lot", () => {
      expect(() => assertNotLocked("lot", "REJECTED")).toThrow(AppError);
    });
    it("throws RECORD_LOCKED for APPROVED BPR", () => {
      expect(() => assertNotLocked("batch_production_record", "APPROVED")).toThrow(AppError);
    });
    it("does not throw for unknown entity type", () => {
      expect(() => assertNotLocked("unknown_entity", "APPROVED")).not.toThrow();
    });
  });

  describe("graph completeness", () => {
    it("lotTransitions has all required edges", () => {
      expect(lotTransitions.length).toBeGreaterThanOrEqual(6);
    });
    it("bprTransitions has all required edges", () => {
      expect(bprTransitions.length).toBeGreaterThanOrEqual(3);
    });
    it("receiving extends lot transitions with location-move edges", () => {
      // WH-01: receivingTransitions is now a superset of lotTransitions (adds
      // APPROVED_PENDING_MOVE intermediate step). Verify it contains all lot edges.
      for (const t of lotTransitions) {
        expect(receivingTransitions).toContainEqual(t);
      }
      // And has at least the two new WH-01 edges
      expect(receivingTransitions.length).toBeGreaterThan(lotTransitions.length);
    });
    it("every lot transition specifies at least one required role", () => {
      for (const t of lotTransitions) {
        expect(t.requiredRoles.length).toBeGreaterThan(0);
      }
    });
    it("QC_APPROVE and QC_REJECT on lot require QC_DISPOSITION signature", () => {
      const qcEdges = lotTransitions.filter(
        (t) => t.action === "QC_APPROVE" || t.action === "QC_REJECT",
      );
      expect(qcEdges.length).toBeGreaterThan(0);
      for (const e of qcEdges) {
        expect(e.requiredSignatureMeaning).toBe("QC_DISPOSITION");
      }
    });
  });
});

// ── Integration Tests ─────────────────────────────────────────────────────────

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
    fullName: "Test User",
    title: "QC Reviewer",
    passwordHash: hash,
    roles,
    createdByUserId: null,
    grantedByUserId: null,
  });
}

async function seedProduct() {
  const [row] = await db
    .insert(schema.products)
    .values({ name: "Test Product", sku: `SKU-F05-${Date.now()}`, defaultUom: "kg", isActive: true })
    .returning();
  return row!;
}

async function seedLot(productId: string, quarantineStatus = "QUARANTINED") {
  const [row] = await db
    .insert(schema.lots)
    .values({ productId, lotNumber: `LOT-F05-${Date.now()}`, quarantineStatus })
    .returning();
  return row!;
}

describeIfDb("F-05 — integration: RECORD_LOCKED and ILLEGAL_TRANSITION", () => {
  let app: Express;
  let qaUser: schema.UserResponse;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await cleanDb();
    qaUser = await seedUser("qa@f05.test", ["QA"]);
  });

  // ── RECORD_LOCKED on receiving record ─────────────────────────────────────

  describe("POST /api/receiving/:id/qc-review on locked record", () => {
    it("returns 423 RECORD_LOCKED when record is already APPROVED", async () => {
      const product = await seedProduct();
      const lot = await seedLot(product.id, "APPROVED");
      const [rec] = await db
        .insert(schema.receivingRecords)
        .values({ lotId: lot.id, uniqueIdentifier: `RCV-F05-${Date.now()}`, status: "APPROVED" })
        .returning();

      const res = await request(app)
        .post(`/api/receiving/${rec!.id}/qc-review`)
        .set("x-test-user-id", qaUser.id)
        .send({ disposition: "APPROVED", password: VALID_PASSWORD });

      expect(res.status).toBe(423);
      expect((res.body as { error?: { code?: string } }).error?.code).toBe("RECORD_LOCKED");
    });

    it("returns 423 RECORD_LOCKED when record is already REJECTED", async () => {
      const product = await seedProduct();
      const lot = await seedLot(product.id, "REJECTED");
      const [rec] = await db
        .insert(schema.receivingRecords)
        .values({ lotId: lot.id, uniqueIdentifier: `RCV-F05-${Date.now()}`, status: "REJECTED" })
        .returning();

      const res = await request(app)
        .post(`/api/receiving/${rec!.id}/qc-review`)
        .set("x-test-user-id", qaUser.id)
        .send({ disposition: "APPROVED", password: VALID_PASSWORD });

      expect(res.status).toBe(423);
    });
  });

  // ── ILLEGAL_TRANSITION on receiving record ────────────────────────────────

  describe("POST /api/receiving/:id/qc-review — illegal transition", () => {
    it("returns 409 ILLEGAL_TRANSITION when record is QUARANTINED (not yet PENDING_QC)", async () => {
      const product = await seedProduct();
      const lot = await seedLot(product.id, "QUARANTINED");
      const [rec] = await db
        .insert(schema.receivingRecords)
        .values({ lotId: lot.id, uniqueIdentifier: `RCV-F05-${Date.now()}`, status: "QUARANTINED" })
        .returning();

      const res = await request(app)
        .post(`/api/receiving/${rec!.id}/qc-review`)
        .set("x-test-user-id", qaUser.id)
        .send({ disposition: "APPROVED", password: VALID_PASSWORD });

      expect(res.status).toBe(409);
      expect((res.body as { error?: { code?: string } }).error?.code).toBe("ILLEGAL_TRANSITION");
    });
  });

  // ── RECORD_LOCKED on BPR ──────────────────────────────────────────────────

  describe("POST /api/batch-production-records/:id/qc-review on locked BPR", () => {
    it("returns 423 RECORD_LOCKED when BPR is already APPROVED", async () => {
      const product = await seedProduct();
      const [batch] = await db
        .insert(schema.productionBatches)
        .values({ batchNumber: `BATCH-F05-${Date.now()}`, productId: product.id, plannedQuantity: "100", outputUom: "kg", status: "IN_PROGRESS" })
        .returning();
      const [bpr] = await db
        .insert(schema.batchProductionRecords)
        .values({ productionBatchId: batch!.id, batchNumber: `BPR-F05-${Date.now()}`, productId: product.id, status: "APPROVED" })
        .returning();

      const res = await request(app)
        .post(`/api/batch-production-records/${bpr!.id}/qc-review`)
        .set("x-test-user-id", qaUser.id)
        .send({ disposition: "APPROVED_FOR_DISTRIBUTION", password: VALID_PASSWORD });

      expect(res.status).toBe(423);
      expect((res.body as { error?: { code?: string } }).error?.code).toBe("RECORD_LOCKED");
    });
  });

  // ── ILLEGAL_TRANSITION on BPR ─────────────────────────────────────────────

  describe("POST /api/batch-production-records/:id/qc-review — illegal transition", () => {
    it("returns 409 ILLEGAL_TRANSITION when BPR is IN_PROGRESS (not yet submitted)", async () => {
      const product = await seedProduct();
      const [batch] = await db
        .insert(schema.productionBatches)
        .values({ batchNumber: `BATCH-F05-${Date.now()}`, productId: product.id, plannedQuantity: "100", outputUom: "kg", status: "IN_PROGRESS" })
        .returning();
      const [bpr] = await db
        .insert(schema.batchProductionRecords)
        .values({ productionBatchId: batch!.id, batchNumber: `BPR-F05-${Date.now()}`, productId: product.id, status: "IN_PROGRESS" })
        .returning();

      const res = await request(app)
        .post(`/api/batch-production-records/${bpr!.id}/qc-review`)
        .set("x-test-user-id", qaUser.id)
        .send({ disposition: "APPROVED_FOR_DISTRIBUTION", password: VALID_PASSWORD });

      expect(res.status).toBe(409);
      expect((res.body as { error?: { code?: string } }).error?.code).toBe("ILLEGAL_TRANSITION");
    });
  });
});
