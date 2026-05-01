import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../email/resend", () => ({
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
}));

import request from "supertest";
import type { Express } from "express";
import { eq, and } from "drizzle-orm";

import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const VALID_PASSWORD = "Neurogan1!Secure";

describeIfDb("R-09 — FG QC Release Gate", () => {
  let app: Express;

  // User IDs
  let qaUserId: string;
  let labTechUserId: string;
  let adminUserId: string;

  // Seeded entities
  let fgProductId: string;
  let noSpecProductId: string;
  let testLabId: string;

  // Track rows to clean up in afterAll
  const toDelete = {
    users: [] as string[],
    products: [] as string[],
    labs: [] as string[],
    labQualifications: [] as string[],
    batches: [] as string[],
    bprs: [] as string[],
    fgSpecs: [] as string[],
    fgSpecVersions: [] as string[],
    fgSpecAttributes: [] as string[],
    fgQcTests: [] as string[],
    oosInvestigations: [] as string[],
  };

  // ─── beforeAll: seed baseline data ───────────────────────────────────────────

  beforeAll(async () => {
    app = await buildTestApp();

    // --- Users ---
    const [qa] = await db
      .insert(schema.users)
      .values({
        email: `r09-qa-${Date.now()}@test.com`,
        fullName: "R09 QA User",
        passwordHash: await hashPassword(VALID_PASSWORD),
        createdByUserId: null as unknown as string,
        status: "ACTIVE",
      })
      .returning();
    qaUserId = qa!.id;
    toDelete.users.push(qaUserId);
    await db.insert(schema.userRoles).values({ userId: qaUserId, role: "QA", grantedByUserId: qaUserId });
    await db.update(schema.users).set({ passwordChangedAt: new Date() }).where(eq(schema.users.id, qaUserId));

    const [labTech] = await db
      .insert(schema.users)
      .values({
        email: `r09-labtech-${Date.now()}@test.com`,
        fullName: "R09 Lab Tech",
        passwordHash: await hashPassword(VALID_PASSWORD),
        createdByUserId: null as unknown as string,
        status: "ACTIVE",
      })
      .returning();
    labTechUserId = labTech!.id;
    toDelete.users.push(labTechUserId);
    await db.insert(schema.userRoles).values({ userId: labTechUserId, role: "LAB_TECH", grantedByUserId: qaUserId });
    await db.update(schema.users).set({ passwordChangedAt: new Date() }).where(eq(schema.users.id, labTechUserId));

    const [admin] = await db
      .insert(schema.users)
      .values({
        email: `r09-admin-${Date.now()}@test.com`,
        fullName: "R09 Admin",
        passwordHash: await hashPassword(VALID_PASSWORD),
        createdByUserId: null as unknown as string,
        status: "ACTIVE",
      })
      .returning();
    adminUserId = admin!.id;
    toDelete.users.push(adminUserId);
    await db.insert(schema.userRoles).values({ userId: adminUserId, role: "ADMIN", grantedByUserId: qaUserId });
    await db.update(schema.users).set({ passwordChangedAt: new Date() }).where(eq(schema.users.id, adminUserId));

    // --- Products ---
    const sfx = Date.now();
    const [fgProd] = await db
      .insert(schema.products)
      .values({
        name: `R09-FG-Product-${sfx}`,
        sku: `R09-FG-${sfx}`,
        category: "FINISHED_GOOD",
        defaultUom: "units",
      })
      .returning();
    fgProductId = fgProd!.id;
    toDelete.products.push(fgProductId);

    const [noSpecProd] = await db
      .insert(schema.products)
      .values({
        name: `R09-NoSpec-Product-${sfx}`,
        sku: `R09-NS-${sfx}`,
        category: "FINISHED_GOOD",
        defaultUom: "units",
      })
      .returning();
    noSpecProductId = noSpecProd!.id;
    toDelete.products.push(noSpecProductId);

    // --- Lab ---
    const [lab] = await db
      .insert(schema.labs)
      .values({
        name: `R09-Test-Lab-${sfx}`,
        type: "THIRD_PARTY",
        status: "ACTIVE",
      })
      .returning();
    testLabId = lab!.id;
    toDelete.labs.push(testLabId);

    // Qualify the lab well in the past so it's accredited for all test dates
    const [qual] = await db
      .insert(schema.labQualifications)
      .values({
        labId: testLabId,
        eventType: "QUALIFIED",
        performedByUserId: qaUserId,
        performedAt: new Date(2020, 0, 1),
      })
      .returning();
    toDelete.labQualifications.push(qual!.id);
  });

  // ─── afterAll: clean up in reverse FK order ───────────────────────────────────

  afterAll(async () => {
    // FG QC test results are cascade-deleted when fgQcTests are deleted,
    // but we still need to clean up OOS investigations separately
    for (const id of toDelete.fgQcTests) {
      await db.delete(schema.finishedGoodsQcTests).where(eq(schema.finishedGoodsQcTests.id, id)).catch(() => {});
    }
    for (const id of toDelete.oosInvestigations) {
      await db.delete(schema.oosInvestigations).where(eq(schema.oosInvestigations.id, id)).catch(() => {});
    }
    for (const id of toDelete.fgSpecAttributes) {
      await db.delete(schema.finishedGoodsSpecAttributes).where(eq(schema.finishedGoodsSpecAttributes.id, id)).catch(() => {});
    }
    for (const id of toDelete.fgSpecVersions) {
      await db.delete(schema.finishedGoodsSpecVersions).where(eq(schema.finishedGoodsSpecVersions.id, id)).catch(() => {});
    }
    for (const id of toDelete.fgSpecs) {
      await db.delete(schema.finishedGoodsSpecs).where(eq(schema.finishedGoodsSpecs.id, id)).catch(() => {});
    }
    for (const id of toDelete.bprs) {
      await db.delete(schema.batchProductionRecords).where(eq(schema.batchProductionRecords.id, id)).catch(() => {});
    }
    for (const id of toDelete.batches) {
      await db.delete(schema.productionBatches).where(eq(schema.productionBatches.id, id)).catch(() => {});
    }
    for (const id of toDelete.labQualifications) {
      await db.delete(schema.labQualifications).where(eq(schema.labQualifications.id, id)).catch(() => {});
    }
    for (const id of toDelete.labs) {
      await db.delete(schema.labs).where(eq(schema.labs.id, id)).catch(() => {});
    }
    for (const id of toDelete.products) {
      await db.delete(schema.products).where(eq(schema.products.id, id)).catch(() => {});
    }
    for (const id of toDelete.users) {
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, id)).catch(() => {});
      await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.userId, id)).catch(() => {});
      await db.delete(schema.users).where(eq(schema.users.id, id)).catch(() => {});
    }
  });

  // ─── Helper: seed a BPR in PENDING_QC_REVIEW directly ────────────────────────

  async function seedPendingQcBpr(productId: string): Promise<{ batchId: string; bprId: string }> {
    const sfx = Date.now() + Math.random();
    const [batch] = await db
      .insert(schema.productionBatches)
      .values({
        batchNumber: `R09-BATCH-${sfx}`,
        productId,
        status: "IN_PROGRESS",
        plannedQuantity: "100",
        outputUom: "units",
      })
      .returning();
    toDelete.batches.push(batch!.id);

    const [bpr] = await db
      .insert(schema.batchProductionRecords)
      .values({
        productionBatchId: batch!.id,
        batchNumber: batch!.batchNumber,
        productId,
        status: "PENDING_QC_REVIEW",
        cleaningLogId: null,
      })
      .returning();
    toDelete.bprs.push(bpr!.id);

    return { batchId: batch!.id, bprId: bpr!.id };
  }

  // ─── 1. Spec creation ──────────────────────────────────────────────────────────

  describe("POST /api/finished-goods-specs — spec creation", () => {
    it("creates a spec with v1 PENDING_APPROVAL version (QA user)", async () => {
      const res = await request(app)
        .post("/api/finished-goods-specs")
        .set("X-Test-User-Id", qaUserId)
        .send({
          productId: fgProductId,
          name: `R09 Spec ${Date.now()}`,
          description: "Integration test spec",
        });

      expect(res.status).toBe(201);
      expect(res.body.productId).toBe(fgProductId);
      expect(Array.isArray(res.body.versions)).toBe(true);
      expect(res.body.versions).toHaveLength(1);
      expect(res.body.versions[0].status).toBe("PENDING_APPROVAL");
      expect(res.body.versions[0].version).toBe(1);

      // Track for cleanup
      toDelete.fgSpecs.push(res.body.id as string);
      toDelete.fgSpecVersions.push(res.body.versions[0].id as string);
    });
  });

  // ─── 2. Add attribute ──────────────────────────────────────────────────────────

  describe("POST .../attributes — add attribute to PENDING_APPROVAL version", () => {
    it("adds an attribute to a PENDING_APPROVAL version", async () => {
      // Create a fresh spec
      const specRes = await request(app)
        .post("/api/finished-goods-specs")
        .set("X-Test-User-Id", qaUserId)
        .send({
          productId: fgProductId,
          name: `R09 AttrTest Spec ${Date.now()}`,
        });
      expect(specRes.status).toBe(201);
      const specId = specRes.body.id as string;
      const vId = specRes.body.versions[0].id as string;
      toDelete.fgSpecs.push(specId);
      toDelete.fgSpecVersions.push(vId);

      const attrRes = await request(app)
        .post(`/api/finished-goods-specs/${specId}/versions/${vId}/attributes`)
        .set("X-Test-User-Id", qaUserId)
        .send({
          analyte: "CBD",
          category: "NUTRIENT_CONTENT",
          minValue: "10",
          maxValue: "30",
          unit: "mg/serving",
          required: true,
        });

      expect(attrRes.status).toBe(201);
      expect(attrRes.body.analyte).toBe("CBD");
      expect(attrRes.body.minValue).toBe("10");
      expect(attrRes.body.maxValue).toBe("30");
      expect(attrRes.body.specVersionId).toBe(vId);
      toDelete.fgSpecAttributes.push(attrRes.body.id as string);
    });
  });

  // ─── 3. Approve spec (Part-11) ────────────────────────────────────────────────

  describe("POST .../approve — Part-11 spec approval", () => {
    let specId: string;
    let vId: string;

    beforeAll(async () => {
      const specRes = await request(app)
        .post("/api/finished-goods-specs")
        .set("X-Test-User-Id", qaUserId)
        .send({
          productId: fgProductId,
          name: `R09 ApprovalTest Spec ${Date.now()}`,
        });
      expect(specRes.status).toBe(201);
      specId = specRes.body.id as string;
      vId = specRes.body.versions[0].id as string;
      toDelete.fgSpecs.push(specId);
      toDelete.fgSpecVersions.push(vId);
    });

    it("approves a PENDING_APPROVAL version with correct password → APPROVED", async () => {
      const res = await request(app)
        .post(`/api/finished-goods-specs/${specId}/versions/${vId}/approve`)
        .set("X-Test-User-Id", qaUserId)
        .send({ password: VALID_PASSWORD, commentary: "Approved in test" });

      expect(res.status).toBe(200);

      // The version should now be APPROVED
      const updatedVersion = res.body.versions.find((v: { id: string }) => v.id === vId);
      expect(updatedVersion).toBeDefined();
      expect(updatedVersion.status).toBe("APPROVED");
      expect(updatedVersion.approvedByUserId).toBe(qaUserId);
    });

    it("returns 400 when attempting to approve an already-APPROVED version", async () => {
      const res = await request(app)
        .post(`/api/finished-goods-specs/${specId}/versions/${vId}/approve`)
        .set("X-Test-User-Id", qaUserId)
        .send({ password: VALID_PASSWORD });

      expect(res.status).toBe(400);
    });
  });

  // ─── 4–5. Enter FG QC tests ────────────────────────────────────────────────────
  //
  // These tests require an approved spec with attributes, a qualified lab, and a BPR.

  describe("POST /api/batch-production-records/:bprId/finished-goods-tests — test entry", () => {
    let testSpecId: string;
    let testSpecVersionId: string;
    let cbdAttributeId: string;
    let thcAttributeId: string;
    let bprId: string;

    beforeAll(async () => {
      // Create spec with two attributes
      const specRes = await request(app)
        .post("/api/finished-goods-specs")
        .set("X-Test-User-Id", qaUserId)
        .send({
          productId: fgProductId,
          name: `R09 TestEntry Spec ${Date.now()}`,
        });
      expect(specRes.status).toBe(201);
      testSpecId = specRes.body.id as string;
      testSpecVersionId = specRes.body.versions[0].id as string;
      toDelete.fgSpecs.push(testSpecId);
      toDelete.fgSpecVersions.push(testSpecVersionId);

      const cbdAttr = await request(app)
        .post(`/api/finished-goods-specs/${testSpecId}/versions/${testSpecVersionId}/attributes`)
        .set("X-Test-User-Id", qaUserId)
        .send({ analyte: "CBD", category: "NUTRIENT_CONTENT", minValue: "10", maxValue: "30", unit: "mg", required: true });
      expect(cbdAttr.status).toBe(201);
      cbdAttributeId = cbdAttr.body.id as string;
      toDelete.fgSpecAttributes.push(cbdAttributeId);

      const thcAttr = await request(app)
        .post(`/api/finished-goods-specs/${testSpecId}/versions/${testSpecVersionId}/attributes`)
        .set("X-Test-User-Id", qaUserId)
        .send({ analyte: "THC", category: "CONTAMINANT", maxValue: "0.3", unit: "%", required: true });
      expect(thcAttr.status).toBe(201);
      thcAttributeId = thcAttr.body.id as string;
      toDelete.fgSpecAttributes.push(thcAttributeId);

      // Approve the spec
      const approveRes = await request(app)
        .post(`/api/finished-goods-specs/${testSpecId}/versions/${testSpecVersionId}/approve`)
        .set("X-Test-User-Id", qaUserId)
        .send({ password: VALID_PASSWORD });
      expect(approveRes.status).toBe(200);

      // Seed a BPR
      const seeded = await seedPendingQcBpr(fgProductId);
      bprId = seeded.bprId;
    });

    it("enters test with all-PASS results → no OOS created", async () => {
      const res = await request(app)
        .post(`/api/batch-production-records/${bprId}/finished-goods-tests`)
        .set("X-Test-User-Id", labTechUserId)
        .send({
          labId: testLabId,
          testedAt: "2024-06-15",
          results: [
            { specAttributeId: cbdAttributeId, reportedValue: "20", reportedUnit: "mg" },
            { specAttributeId: thcAttributeId, reportedValue: "0.1", reportedUnit: "%" },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.bprId).toBe(bprId);
      expect(Array.isArray(res.body.results)).toBe(true);
      expect(res.body.results).toHaveLength(2);

      // All results should be PASS, no OOS
      for (const result of res.body.results as Array<{ passFail: string; oosInvestigationId: string | null }>) {
        expect(result.passFail).toBe("PASS");
        expect(result.oosInvestigationId).toBeNull();
      }

      toDelete.fgQcTests.push(res.body.id as string);
    });

    it("enters test with a FAIL result → OOS investigation auto-created, linked via oosInvestigationId", async () => {
      const res = await request(app)
        .post(`/api/batch-production-records/${bprId}/finished-goods-tests`)
        .set("X-Test-User-Id", labTechUserId)
        .send({
          labId: testLabId,
          testedAt: "2024-06-16",
          results: [
            // CBD below min (10) → FAIL
            { specAttributeId: cbdAttributeId, reportedValue: "5", reportedUnit: "mg" },
            { specAttributeId: thcAttributeId, reportedValue: "0.1", reportedUnit: "%" },
          ],
        });

      expect(res.status).toBe(201);

      const cbdResult = (res.body.results as Array<{ analyteName: string; passFail: string; oosInvestigationId: string | null }>)
        .find((r) => r.analyteName === "CBD");
      const thcResult = (res.body.results as Array<{ analyteName: string; passFail: string; oosInvestigationId: string | null }>)
        .find((r) => r.analyteName === "THC");

      expect(cbdResult?.passFail).toBe("FAIL");
      expect(cbdResult?.oosInvestigationId).toBeTruthy();
      expect(thcResult?.passFail).toBe("PASS");
      expect(thcResult?.oosInvestigationId).toBeNull();

      toDelete.fgQcTests.push(res.body.id as string);
      if (cbdResult?.oosInvestigationId) {
        toDelete.oosInvestigations.push(cbdResult.oosInvestigationId);
      }
    });
  });

  // ─── 6–9. QC review gate ──────────────────────────────────────────────────────

  describe("POST /api/batch-production-records/:id/qc-review — R-09 gate", () => {
    // Test 6: FG_TESTS_INCOMPLETE — no test results for a BPR that has an approved spec
    it("409 FG_TESTS_INCOMPLETE: BPR with approved spec but no test results", async () => {
      // Need a fresh approved spec for fgProductId (or reuse existing).
      // Create a dedicated product for this test to isolate state.
      const sfx = Date.now();
      const [isolatedProd] = await db
        .insert(schema.products)
        .values({ name: `R09-Isolated-${sfx}`, sku: `R09-ISO-${sfx}`, category: "FINISHED_GOOD", defaultUom: "units" })
        .returning();
      toDelete.products.push(isolatedProd!.id);

      // Create and approve a spec for the isolated product
      const specRes = await request(app)
        .post("/api/finished-goods-specs")
        .set("X-Test-User-Id", qaUserId)
        .send({ productId: isolatedProd!.id, name: `R09-Gate1-Spec-${sfx}` });
      expect(specRes.status).toBe(201);
      const gateSpecId = specRes.body.id as string;
      const gateVersionId = specRes.body.versions[0].id as string;
      toDelete.fgSpecs.push(gateSpecId);
      toDelete.fgSpecVersions.push(gateVersionId);

      const attrRes = await request(app)
        .post(`/api/finished-goods-specs/${gateSpecId}/versions/${gateVersionId}/attributes`)
        .set("X-Test-User-Id", qaUserId)
        .send({ analyte: "Lead", category: "CONTAMINANT", maxValue: "0.1", unit: "ppm", required: true });
      expect(attrRes.status).toBe(201);
      toDelete.fgSpecAttributes.push(attrRes.body.id as string);

      await request(app)
        .post(`/api/finished-goods-specs/${gateSpecId}/versions/${gateVersionId}/approve`)
        .set("X-Test-User-Id", qaUserId)
        .send({ password: VALID_PASSWORD });

      // BPR with no test results
      const { bprId: gateBprId } = await seedPendingQcBpr(isolatedProd!.id);

      const res = await request(app)
        .post(`/api/batch-production-records/${gateBprId}/qc-review`)
        .set("X-Test-User-Id", qaUserId)
        .send({ disposition: "APPROVED_FOR_DISTRIBUTION", password: VALID_PASSWORD });

      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe("FG_TESTS_INCOMPLETE");
      expect(Array.isArray(res.body.error?.details?.missingAttributes)).toBe(true);
      expect(res.body.error.details.missingAttributes.length).toBeGreaterThan(0);
    });

    // Test 7: FG_TESTS_INCOMPLETE — BPR with a FAIL result
    it("409 FG_TESTS_INCOMPLETE: BPR with a FAIL result blocks gate", async () => {
      const sfx = Date.now();
      const [isolatedProd] = await db
        .insert(schema.products)
        .values({ name: `R09-Fail-${sfx}`, sku: `R09-FAIL-${sfx}`, category: "FINISHED_GOOD", defaultUom: "units" })
        .returning();
      toDelete.products.push(isolatedProd!.id);

      const specRes = await request(app)
        .post("/api/finished-goods-specs")
        .set("X-Test-User-Id", qaUserId)
        .send({ productId: isolatedProd!.id, name: `R09-Gate2-Spec-${sfx}` });
      expect(specRes.status).toBe(201);
      const gateSpecId = specRes.body.id as string;
      const gateVersionId = specRes.body.versions[0].id as string;
      toDelete.fgSpecs.push(gateSpecId);
      toDelete.fgSpecVersions.push(gateVersionId);

      const attrRes = await request(app)
        .post(`/api/finished-goods-specs/${gateSpecId}/versions/${gateVersionId}/attributes`)
        .set("X-Test-User-Id", qaUserId)
        .send({ analyte: "Moisture", category: "NUTRIENT_CONTENT", maxValue: "5", unit: "%", required: true });
      expect(attrRes.status).toBe(201);
      const failAttrId = attrRes.body.id as string;
      toDelete.fgSpecAttributes.push(failAttrId);

      await request(app)
        .post(`/api/finished-goods-specs/${gateSpecId}/versions/${gateVersionId}/approve`)
        .set("X-Test-User-Id", qaUserId)
        .send({ password: VALID_PASSWORD });

      const { bprId: failBprId } = await seedPendingQcBpr(isolatedProd!.id);

      // Enter a FAIL result (moisture > 5%)
      const testRes = await request(app)
        .post(`/api/batch-production-records/${failBprId}/finished-goods-tests`)
        .set("X-Test-User-Id", labTechUserId)
        .send({
          labId: testLabId,
          testedAt: "2024-07-01",
          results: [{ specAttributeId: failAttrId, reportedValue: "8", reportedUnit: "%" }],
        });
      expect(testRes.status).toBe(201);
      toDelete.fgQcTests.push(testRes.body.id as string);
      const failOosId = (testRes.body.results as Array<{ oosInvestigationId: string | null }>)[0]?.oosInvestigationId;
      if (failOosId) toDelete.oosInvestigations.push(failOosId);

      const res = await request(app)
        .post(`/api/batch-production-records/${failBprId}/qc-review`)
        .set("X-Test-User-Id", qaUserId)
        .send({ disposition: "APPROVED_FOR_DISTRIBUTION", password: VALID_PASSWORD });

      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe("FG_TESTS_INCOMPLETE");
      expect(Array.isArray(res.body.error?.details?.failingAttributes)).toBe(true);
      expect(res.body.error.details.failingAttributes.length).toBeGreaterThan(0);
    });

    // Test 8: FG_SPEC_MISSING — product with no approved spec
    it("409 FG_SPEC_MISSING: BPR for product with no approved spec", async () => {
      const { bprId: noSpecBprId } = await seedPendingQcBpr(noSpecProductId);

      const res = await request(app)
        .post(`/api/batch-production-records/${noSpecBprId}/qc-review`)
        .set("X-Test-User-Id", qaUserId)
        .send({ disposition: "APPROVED_FOR_DISTRIBUTION", password: VALID_PASSWORD });

      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe("FG_SPEC_MISSING");
    });

    // Test 9: All PASS from accredited lab → Part-11 succeeds → BPR → APPROVED
    it("200: all PASS from accredited lab → BPR advances to APPROVED", async () => {
      const sfx = Date.now();
      const [passProd] = await db
        .insert(schema.products)
        .values({ name: `R09-AllPass-${sfx}`, sku: `R09-PASS-${sfx}`, category: "FINISHED_GOOD", defaultUom: "units" })
        .returning();
      toDelete.products.push(passProd!.id);

      // Create + approve spec with one attribute
      const specRes = await request(app)
        .post("/api/finished-goods-specs")
        .set("X-Test-User-Id", qaUserId)
        .send({ productId: passProd!.id, name: `R09-AllPass-Spec-${sfx}` });
      expect(specRes.status).toBe(201);
      const passSpecId = specRes.body.id as string;
      const passVersionId = specRes.body.versions[0].id as string;
      toDelete.fgSpecs.push(passSpecId);
      toDelete.fgSpecVersions.push(passVersionId);

      const attrRes = await request(app)
        .post(`/api/finished-goods-specs/${passSpecId}/versions/${passVersionId}/attributes`)
        .set("X-Test-User-Id", qaUserId)
        .send({ analyte: "Potency", category: "NUTRIENT_CONTENT", minValue: "25", maxValue: "35", unit: "mg", required: true });
      expect(attrRes.status).toBe(201);
      const passAttrId = attrRes.body.id as string;
      toDelete.fgSpecAttributes.push(passAttrId);

      await request(app)
        .post(`/api/finished-goods-specs/${passSpecId}/versions/${passVersionId}/approve`)
        .set("X-Test-User-Id", qaUserId)
        .send({ password: VALID_PASSWORD });

      const { bprId: passBprId } = await seedPendingQcBpr(passProd!.id);

      // Enter PASS result
      const testRes = await request(app)
        .post(`/api/batch-production-records/${passBprId}/finished-goods-tests`)
        .set("X-Test-User-Id", labTechUserId)
        .send({
          labId: testLabId,
          testedAt: "2024-08-01",
          results: [{ specAttributeId: passAttrId, reportedValue: "30", reportedUnit: "mg" }],
        });
      expect(testRes.status).toBe(201);
      toDelete.fgQcTests.push(testRes.body.id as string);

      // QC review — should succeed
      const res = await request(app)
        .post(`/api/batch-production-records/${passBprId}/qc-review`)
        .set("X-Test-User-Id", qaUserId)
        .send({ disposition: "APPROVED_FOR_DISTRIBUTION", notes: "All tests passed", password: VALID_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("APPROVED");
      expect(res.body.qcDisposition).toBe("APPROVED_FOR_DISTRIBUTION");
    });

    // Test 10: Re-test after FAIL → latest result wins → gate passes
    it("latest result wins: FAIL then PASS for same analyte → gate sees PASS", async () => {
      const sfx = Date.now();
      const [retestProd] = await db
        .insert(schema.products)
        .values({ name: `R09-Retest-${sfx}`, sku: `R09-RT-${sfx}`, category: "FINISHED_GOOD", defaultUom: "units" })
        .returning();
      toDelete.products.push(retestProd!.id);

      const specRes = await request(app)
        .post("/api/finished-goods-specs")
        .set("X-Test-User-Id", qaUserId)
        .send({ productId: retestProd!.id, name: `R09-Retest-Spec-${sfx}` });
      expect(specRes.status).toBe(201);
      const retestSpecId = specRes.body.id as string;
      const retestVersionId = specRes.body.versions[0].id as string;
      toDelete.fgSpecs.push(retestSpecId);
      toDelete.fgSpecVersions.push(retestVersionId);

      const attrRes = await request(app)
        .post(`/api/finished-goods-specs/${retestSpecId}/versions/${retestVersionId}/attributes`)
        .set("X-Test-User-Id", qaUserId)
        .send({ analyte: "CBD", category: "NUTRIENT_CONTENT", minValue: "10", maxValue: "30", unit: "mg", required: true });
      expect(attrRes.status).toBe(201);
      const retestAttrId = attrRes.body.id as string;
      toDelete.fgSpecAttributes.push(retestAttrId);

      await request(app)
        .post(`/api/finished-goods-specs/${retestSpecId}/versions/${retestVersionId}/approve`)
        .set("X-Test-User-Id", qaUserId)
        .send({ password: VALID_PASSWORD });

      const { bprId: retestBprId } = await seedPendingQcBpr(retestProd!.id);

      // First test: FAIL (CBD = 5, below min of 10)
      const failRes = await request(app)
        .post(`/api/batch-production-records/${retestBprId}/finished-goods-tests`)
        .set("X-Test-User-Id", labTechUserId)
        .send({
          labId: testLabId,
          testedAt: "2024-09-01",
          results: [{ specAttributeId: retestAttrId, reportedValue: "5", reportedUnit: "mg" }],
        });
      expect(failRes.status).toBe(201);
      toDelete.fgQcTests.push(failRes.body.id as string);
      const failOos = (failRes.body.results as Array<{ oosInvestigationId: string | null }>)[0]?.oosInvestigationId;
      if (failOos) toDelete.oosInvestigations.push(failOos);

      // qc-review now should block (FAIL result is latest)
      const gateBlock = await request(app)
        .post(`/api/batch-production-records/${retestBprId}/qc-review`)
        .set("X-Test-User-Id", qaUserId)
        .send({ disposition: "APPROVED_FOR_DISTRIBUTION", password: VALID_PASSWORD });
      expect(gateBlock.status).toBe(409);
      expect(gateBlock.body.error?.code).toBe("FG_TESTS_INCOMPLETE");

      // Second test: PASS (CBD = 20, within range) — later date wins
      const passRes = await request(app)
        .post(`/api/batch-production-records/${retestBprId}/finished-goods-tests`)
        .set("X-Test-User-Id", labTechUserId)
        .send({
          labId: testLabId,
          testedAt: "2024-09-15",
          results: [{ specAttributeId: retestAttrId, reportedValue: "20", reportedUnit: "mg" }],
        });
      expect(passRes.status).toBe(201);
      toDelete.fgQcTests.push(passRes.body.id as string);

      // qc-review now should succeed (latest result is PASS)
      const res = await request(app)
        .post(`/api/batch-production-records/${retestBprId}/qc-review`)
        .set("X-Test-User-Id", qaUserId)
        .send({ disposition: "APPROVED_FOR_DISTRIBUTION", notes: "Re-test passed", password: VALID_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("APPROVED");
    });
  });
});
