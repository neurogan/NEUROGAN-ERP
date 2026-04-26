import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { eq } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const VALID_PASSWORD = "Neurogan1!Secure";

let app: Express;
let adminId: string;
let labTechId: string;
let warehouseId: string;
let coaId: string;

const seededResultIds: string[] = [];

beforeAll(async () => {
  if (!dbUrl) return;
  app = await buildTestApp();

  // Seed admin
  const [admin] = await db.insert(schema.users).values({
    email: `t06-results-admin-${Date.now()}@test.com`,
    fullName: "T06 Results Admin",
    passwordHash: await hashPassword(VALID_PASSWORD),
    createdByUserId: null as unknown as string,
  }).returning();
  adminId = admin!.id;
  await db.insert(schema.userRoles).values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });

  // Seed LAB_TECH user
  const [labTech] = await db.insert(schema.users).values({
    email: `t06-labtech-${Date.now()}@test.com`,
    fullName: "T06 Lab Tech",
    passwordHash: await hashPassword(VALID_PASSWORD),
    createdByUserId: adminId,
  }).returning();
  labTechId = labTech!.id;
  await db.insert(schema.userRoles).values({ userId: labTechId, role: "LAB_TECH", grantedByUserId: adminId });

  // Seed WAREHOUSE user
  const [warehouse] = await db.insert(schema.users).values({
    email: `t06-warehouse-${Date.now()}@test.com`,
    fullName: "T06 Warehouse",
    passwordHash: await hashPassword(VALID_PASSWORD),
    createdByUserId: adminId,
  }).returning();
  warehouseId = warehouse!.id;
  await db.insert(schema.userRoles).values({ userId: warehouseId, role: "WAREHOUSE", grantedByUserId: adminId });

  // Seed a product, supplier, lot, and COA document for FK purposes
  const suffix = Date.now();
  const [product] = await db.insert(schema.products).values({
    name: `T06-LR-Product-${suffix}`,
    sku: `T06-LR-SKU-${suffix}`,
    category: "ACTIVE_INGREDIENT",
    defaultUom: "g",
    status: "ACTIVE",
  }).returning();

  const [supplier] = await db.insert(schema.suppliers).values({ name: `T06-LR-Supplier-${suffix}` }).returning();

  const [lot] = await db.insert(schema.lots).values({
    productId: product!.id,
    lotNumber: `T06-LR-LOT-${suffix}`,
    supplierName: supplier!.name,
    quarantineStatus: "PENDING_QC",
  }).returning();

  const [coa] = await db.insert(schema.coaDocuments).values({
    lotId: lot!.id,
    sourceType: "THIRD_PARTY_LAB",
    overallResult: "PASS",
  }).returning();
  coaId = coa!.id;
});

afterAll(async () => {
  if (!dbUrl) return;
  // The OOS hook in addLabTestResult auto-creates investigations + junction
  // rows when pass=false. Clean those first so labTestResults can be deleted.
  await db.delete(schema.oosInvestigationTestResults);
  await db.update(schema.oosInvestigations).set({ closureSignatureId: null });
  await db.delete(schema.oosInvestigations);
  await db.delete(schema.oosInvestigationCounter);
  // Delete lab test results first (FK child)
  for (const id of seededResultIds) {
    await db.delete(schema.labTestResults).where(eq(schema.labTestResults.id, id));
  }
  // Delete any remaining results for this COA (e.g. inserted via storage)
  await db.delete(schema.labTestResults).where(eq(schema.labTestResults.coaDocumentId, coaId));
  await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityType, "lab_test_result"));
  // OOS hook also writes audit rows for oos_investigation entityType — clean those too
  await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityType, "oos_investigation"));
  // And any remaining audit rows for the test users (covers other entityTypes)
  await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, labTechId));
  await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, warehouseId));
  await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, adminId));
  // COA documents, lots, products, suppliers — use a broad cleanup
  await db.delete(schema.coaDocuments).where(eq(schema.coaDocuments.lotId,
    (await db.select({ id: schema.lots.id }).from(schema.lots)
      .where(eq(schema.lots.lotNumber, `T06-LR-LOT-${coaId}`))
      .limit(1))[0]?.id ?? coaId,
  )).catch(() => {});
  // Simpler: just delete the COA we know
  await db.delete(schema.coaDocuments).where(eq(schema.coaDocuments.id, coaId)).catch(() => {});

  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, labTechId));
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, warehouseId));
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, adminId));
  await db.delete(schema.users).where(eq(schema.users.id, labTechId));
  await db.delete(schema.users).where(eq(schema.users.id, warehouseId));
  await db.delete(schema.users).where(eq(schema.users.id, adminId));
});

describeIfDb("T06 — per-analyte lab test results", () => {
  it("happy path: LAB_TECH adds a passing result, COA overallResult unchanged", async () => {
    const result = await storage.addLabTestResult(
      coaId,
      {
        analyteName: "CBD",
        resultValue: "25.3",
        resultUnits: "mg/g",
        specMin: "20",
        specMax: "30",
        pass: true,
      },
      labTechId,
    );
    seededResultIds.push(result.id);
    expect(result.analyteName).toBe("CBD");
    expect(result.pass).toBe(true);
    expect(result.coaDocumentId).toBe(coaId);
    expect(result.testedByUserId).toBe(labTechId);

    // COA overallResult should remain "PASS"
    const coa = await storage.getCoaDocument(coaId);
    expect(coa?.overallResult).toBe("PASS");
  });

  it("failing result: storage sets COA overallResult to FAIL", async () => {
    const result = await storage.addLabTestResult(
      coaId,
      {
        analyteName: "Heavy Metals",
        resultValue: "12",
        resultUnits: "ppm",
        specMin: null,
        specMax: "10",
        pass: false,
      },
      labTechId,
    );
    seededResultIds.push(result.id);
    expect(result.pass).toBe(false);

    // COA overallResult must now be "FAIL"
    const coa = await storage.getCoaDocument(coaId);
    expect(coa?.overallResult).toBe("FAIL");
  });

  it("audit trail records LAB_RESULT_ADDED action via POST /api/coa/:id/results", async () => {
    const res = await request(app)
      .post(`/api/coa/${coaId}/results`)
      .set("x-test-user-id", labTechId)
      .send({ analyteName: "Moisture", resultValue: "4.2", resultUnits: "%", pass: true });
    expect(res.status).toBe(201);
    const resultId = (res.body as { id: string }).id;
    seededResultIds.push(resultId);

    const [auditRow] = await db
      .select({ action: schema.auditTrail.action })
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, resultId))
      .limit(1);
    expect(auditRow?.action).toBe("LAB_RESULT_ADDED");
  });

  it("returns 401 for unauthenticated POST /api/coa/:id/results", async () => {
    const res = await request(app)
      .post(`/api/coa/${coaId}/results`)
      .send({ analyteName: "THC", resultValue: "0.1", pass: true });
    expect(res.status).toBe(401);
  });

  it("returns 403 for WAREHOUSE user POST /api/coa/:id/results", async () => {
    const res = await request(app)
      .post(`/api/coa/${coaId}/results`)
      .set("x-test-user-id", warehouseId)
      .send({ analyteName: "THC", resultValue: "0.1", pass: true });
    expect(res.status).toBe(403);
  });
});
