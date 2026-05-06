import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

async function seedQaUser(email: string, createdById: string) {
  return storage.createUser({ email, fullName: "QA User", title: "QC Manager", passwordHash: await hashPassword("Neurogan1!Secure"), roles: ["QA"], createdByUserId: createdById, grantedByUserId: createdById });
}

async function cleanDb() {
  await db.update(schema.validationDocuments).set({ signatureId: null });
  await db.delete(schema.electronicSignatures);
  await db.delete(schema.coaDocuments);
  await db.delete(schema.receivingRecords);
  await db.delete(schema.approvedMaterials);
  await db.delete(schema.auditTrail);
  await db.delete(schema.passwordHistory);
  await db.delete(schema.userRoles);
  await db.delete(schema.users);
  await db.delete(schema.lots);
}

async function seedReceivingRecord(adminId: string, status = "QUARANTINED") {
  const [product] = await db.insert(schema.products).values({ name: "Gate Test Product", sku: `GATE-${Date.now()}`, category: "ACTIVE_INGREDIENT", defaultUom: "g", status: "ACTIVE" }).returning();
  const [supplier] = await db.insert(schema.suppliers).values({ name: "Gate Test Supplier" }).returning();
  const [lot] = await db.insert(schema.lots).values({ productId: product!.id, lotNumber: `GATE-LOT-${Date.now()}`, supplierName: supplier!.name, quarantineStatus: status }).returning();
  const [record] = await db.insert(schema.receivingRecords).values({ lotId: lot!.id, supplierId: supplier!.id, uniqueIdentifier: `RCV-GATE-${Date.now()}`, status, qcWorkflowType: "FULL_LAB_TEST", requiresQualification: true, dateReceived: "2026-04-23", quantityReceived: "10", uom: "kg" }).returning();
  return { product: product!, supplier: supplier!, lot: lot!, record: record! };
}

describeIfDb("R-01 — state machine gates", () => {
  let app: Express;
  let adminId: string;
  let qaId: string;

  beforeAll(async () => { app = await buildTestApp(); });

  beforeEach(async () => {
    await cleanDb();
    const admin = await storage.createUser({ email: "admin@gates.test", fullName: "Admin", title: null, passwordHash: await hashPassword("Neurogan1!Secure"), roles: ["ADMIN"], createdByUserId: null, grantedByUserId: null });
    adminId = admin.id;
    const qa = await seedQaUser("qa@gates.test", adminId);
    qaId = qa.id;
  });

  afterAll(async () => { await cleanDb(); });

  it("Gate 1: QUARANTINED→SAMPLING rejected (422) if visual inspection incomplete", async () => {
    const { record } = await seedReceivingRecord(adminId);
    const res = await request(app)
      .put(`/api/receiving/${record.id}`)
      .set("x-test-user-id", adminId)
      .send({ status: "SAMPLING" });
    expect(res.status).toBe(422);
    expect((res.body as { message: string }).message).toMatch(/visual inspection/i);
  });

  it("Gate 1: QUARANTINED→SAMPLING allowed when visual inspection complete", async () => {
    const { record } = await seedReceivingRecord(adminId);
    const res = await request(app)
      .put(`/api/receiving/${record.id}`)
      .set("x-test-user-id", adminId)
      .send({
        status: "SAMPLING",
        containerConditionOk: "true",
        sealsIntact: "true",
        labelsMatch: "true",
        invoiceMatchesPo: "true",
        visualExamAt: new Date().toISOString(),
      });
    expect(res.status).toBe(200);
    const body = res.body as { visualExamBy: { userId: string; fullName: string; title: string | null } };
    expect(typeof body.visualExamBy).toBe("object");
    expect(body.visualExamBy.userId).toBe(adminId);
  });

  it("Gate 2: QUARANTINED→PENDING_QC rejected (422) if visual inspection incomplete (IDENTITY_CHECK)", async () => {
    // Create a receiving record with IDENTITY_CHECK workflow type
    const [product] = await db.insert(schema.products).values({ name: "Gate2 Test Product", sku: `GATE2-${Date.now()}`, category: "ACTIVE_INGREDIENT", defaultUom: "g", status: "ACTIVE" }).returning();
    const [supplier] = await db.insert(schema.suppliers).values({ name: "Gate2 Supplier" }).returning();
    const [lot] = await db.insert(schema.lots).values({ productId: product!.id, lotNumber: `GATE2-LOT-${Date.now()}`, supplierName: supplier!.name, quarantineStatus: "QUARANTINED" }).returning();
    const [record] = await db.insert(schema.receivingRecords).values({ lotId: lot!.id, supplierId: supplier!.id, uniqueIdentifier: `RCV-GATE2-${Date.now()}`, status: "QUARANTINED", qcWorkflowType: "IDENTITY_CHECK", requiresQualification: false, dateReceived: "2026-04-23", quantityReceived: "10", uom: "kg" }).returning();

    // Attempt transition to PENDING_QC without visual inspection
    const res = await request(app)
      .put(`/api/receiving/${record.id}`)
      .set("x-test-user-id", adminId)
      .send({ status: "PENDING_QC" });
    expect(res.status).toBe(422);
    expect((res.body as { message: string }).message).toMatch(/visual inspection/i);
  });

  it("Gate 3: PENDING_QC→APPROVED rejected (422) when no COA linked", async () => {
    const { record, lot } = await seedReceivingRecord(adminId, "PENDING_QC");
    await db.update(schema.lots).set({ quarantineStatus: "PENDING_QC" }).where(eq(schema.lots.id, lot.id));

    const res = await request(app)
      .post(`/api/receiving/${record.id}/qc-review`)
      .set("x-test-user-id", qaId)
      .send({ disposition: "APPROVED", notes: "Looks good", password: "Neurogan1!Secure" });
    expect(res.status).toBe(422);
    expect((res.body as { message: string }).message).toMatch(/COA/i);
  });

  it("Gate 3 side-effect: approval of requires_qualification lot creates approved_materials entry", async () => {
    const { record, lot, product, supplier } = await seedReceivingRecord(adminId, "PENDING_QC");
    await db.update(schema.lots).set({ quarantineStatus: "PENDING_QC" }).where(eq(schema.lots.id, lot.id));

    // Attach a COA to satisfy gate 3 (linked to this receiving record)
    await db.insert(schema.coaDocuments).values({ lotId: lot.id, receivingRecordId: record.id, sourceType: "INTERNAL_LAB", overallResult: "PASS", identityConfirmed: "true" });

    const res = await request(app)
      .post(`/api/receiving/${record.id}/qc-review`)
      .set("x-test-user-id", qaId)
      .send({ disposition: "APPROVED", notes: "First receipt approved", password: "Neurogan1!Secure" });
    expect(res.status).toBe(200);

    const [entry] = await db
      .select()
      .from(schema.approvedMaterials)
      .where(and(eq(schema.approvedMaterials.productId, product.id), eq(schema.approvedMaterials.supplierId, supplier.id)));
    expect(entry).toBeTruthy();
    expect(entry!.approvedByUserId).toBe(qaId);
  });

  it("F-06: qcReviewedBy is stored as identity snapshot with title", async () => {
    const { record, lot } = await seedReceivingRecord(adminId, "PENDING_QC");
    await db.update(schema.lots).set({ quarantineStatus: "PENDING_QC" }).where(eq(schema.lots.id, lot.id));
    await db.insert(schema.coaDocuments).values({ lotId: lot.id, receivingRecordId: record.id, sourceType: "INTERNAL_LAB", overallResult: "PASS", identityConfirmed: "true" });

    await request(app)
      .post(`/api/receiving/${record.id}/qc-review`)
      .set("x-test-user-id", qaId)
      .send({ disposition: "APPROVED", notes: "", password: "Neurogan1!Secure" });

    const [updated] = await db.select().from(schema.receivingRecords).where(eq(schema.receivingRecords.id, record.id));
    const snapshot = updated!.qcReviewedBy as { userId: string; fullName: string; title: string };
    expect(typeof snapshot).toBe("object");
    expect(snapshot.userId).toBe(qaId);
    expect(snapshot.fullName).toBe("QA User");
    expect(snapshot.title).toBe("QC Manager");
  });
});
