import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

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

type SeededRecord = {
  product: schema.Product;
  supplier: schema.Supplier;
  lot: schema.Lot;
  record: schema.ReceivingRecord;
};

async function seedRecord(adminId: string, workflowType: string, status = "PENDING_QC", requiresQualification = false): Promise<SeededRecord> {
  const ts = Date.now();
  const [product] = await db.insert(schema.products).values({
    name: `R11 Product ${ts}`,
    sku: `R11-${ts}`,
    category: workflowType === "EXEMPT" ? "SECONDARY_PACKAGING" : "ACTIVE_INGREDIENT",
    defaultUom: "g",
    status: "ACTIVE",
  }).returning();
  const [supplier] = await db.insert(schema.suppliers).values({ name: `R11 Supplier ${ts}` }).returning();
  const [lot] = await db.insert(schema.lots).values({
    productId: product!.id,
    lotNumber: `R11-LOT-${ts}`,
    supplierName: supplier!.name,
    quarantineStatus: status,
  }).returning();
  const [record] = await db.insert(schema.receivingRecords).values({
    lotId: lot!.id,
    supplierId: supplier!.id,
    uniqueIdentifier: `RCV-R11-${ts}`,
    status,
    qcWorkflowType: workflowType,
    requiresQualification,
    dateReceived: "2026-05-06",
    quantityReceived: "10",
    uom: "kg",
  }).returning();
  return { product: product!, supplier: supplier!, lot: lot!, record: record! };
}

async function uploadCoa(app: Express, recordId: string, cookie: string, overrides?: Record<string, string>) {
  return request(app)
    .post(`/api/receiving/${recordId}/coa`)
    .set("Cookie", cookie)
    .send({
      fileData: Buffer.from("PDF content").toString("base64"),
      fileName: "test-coa.pdf",
      sourceType: "SUPPLIER",
      overallResult: "PASS",
      ...overrides,
    });
}

async function loginAs(app: Express, email: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password: "Neurogan1!Secure" });
  return res.headers["set-cookie"]?.[0] ?? "";
}

describeIfDb("R-11 — Receiving QC Redesign", () => {
  let app: Express;
  let adminId: string;
  let adminCookie: string;
  let qaCookie: string;

  beforeAll(async () => { app = await buildTestApp(); });
  afterAll(async () => { await cleanDb(); });

  beforeEach(async () => {
    await cleanDb();
    const admin = await storage.createUser({
      email: "admin@r11.test", fullName: "Admin", title: null,
      passwordHash: await hashPassword("Neurogan1!Secure"),
      roles: ["ADMIN"], createdByUserId: null, grantedByUserId: null,
    });
    adminId = admin.id;
    const qa = await storage.createUser({
      email: "qa@r11.test", fullName: "QC Manager", title: "QC Manager",
      passwordHash: await hashPassword("Neurogan1!Secure"),
      roles: ["QA"], createdByUserId: adminId, grantedByUserId: adminId,
    });
    adminCookie = await loginAs(app, "admin@r11.test");
    qaCookie = await loginAs(app, "qa@r11.test");
  });

  // ── POST /api/receiving/:id/coa ──────────────────────────────────────────

  it("uploads a COA for a PENDING_QC non-EXEMPT record", async () => {
    const { record } = await seedRecord(adminId, "COA_REVIEW");
    const res = await uploadCoa(app, record.id, qaCookie);
    expect(res.status).toBe(201);
    expect(res.body.receivingRecordId).toBe(record.id);
    expect(res.body.overallResult).toBe("PASS");
    expect(res.body.sourceType).toBe("SUPPLIER");
  });

  it("rejects COA upload when record is not PENDING_QC", async () => {
    const { record } = await seedRecord(adminId, "COA_REVIEW", "QUARANTINED");
    const res = await uploadCoa(app, record.id, qaCookie);
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/PENDING_QC/i);
  });

  it("rejects COA upload for EXEMPT records", async () => {
    const { record } = await seedRecord(adminId, "EXEMPT");
    const res = await uploadCoa(app, record.id, qaCookie);
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/EXEMPT/i);
  });

  it("rejects SUPPLIER source for first-time supplier (requiresQualification = true)", async () => {
    const { record } = await seedRecord(adminId, "FULL_LAB_TEST", "PENDING_QC", true);
    const res = await uploadCoa(app, record.id, qaCookie, { sourceType: "SUPPLIER" });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/independent testing/i);
  });

  it("allows INTERNAL_LAB source for first-time supplier", async () => {
    const { record } = await seedRecord(adminId, "FULL_LAB_TEST", "PENDING_QC", true);
    const res = await uploadCoa(app, record.id, qaCookie, { sourceType: "INTERNAL_LAB" });
    expect(res.status).toBe(201);
  });

  it("requires fileData, fileName, sourceType, overallResult", async () => {
    const { record } = await seedRecord(adminId, "COA_REVIEW");
    const r1 = await request(app).post(`/api/receiving/${record.id}/coa`).set("Cookie", qaCookie).send({ fileName: "x.pdf", sourceType: "SUPPLIER", overallResult: "PASS" });
    expect(r1.status).toBe(400);
    expect(r1.body.message).toMatch(/fileData/);
    const r2 = await request(app).post(`/api/receiving/${record.id}/coa`).set("Cookie", qaCookie).send({ fileData: "abc", sourceType: "SUPPLIER", overallResult: "PASS" });
    expect(r2.status).toBe(400);
    expect(r2.body.message).toMatch(/fileName/);
  });

  it("allows multiple COA uploads (Replace); all rows are retained", async () => {
    const { record } = await seedRecord(adminId, "COA_REVIEW");
    await uploadCoa(app, record.id, qaCookie);
    const r2 = await uploadCoa(app, record.id, qaCookie, { documentNumber: "COA-SECOND" });
    expect(r2.status).toBe(201);
    const rows = await db.select().from(schema.coaDocuments).where(eq(schema.coaDocuments.receivingRecordId, record.id));
    expect(rows.length).toBe(2);
  });

  // ── GET /api/receiving — coaDocuments joined ─────────────────────────────

  it("GET /api/receiving includes coaDocuments array on each record", async () => {
    const { record } = await seedRecord(adminId, "COA_REVIEW");
    await uploadCoa(app, record.id, qaCookie);
    const res = await request(app).get("/api/receiving").set("Cookie", qaCookie);
    expect(res.status).toBe(200);
    const found = res.body.find((r: { id: string }) => r.id === record.id);
    expect(found).toBeDefined();
    expect(Array.isArray(found.coaDocuments)).toBe(true);
    expect(found.coaDocuments.length).toBe(1);
  });

  // ── QC Sign-off gate ─────────────────────────────────────────────────────

  it("blocks sign-off without COA for non-EXEMPT records", async () => {
    const { record } = await seedRecord(adminId, "COA_REVIEW");
    const res = await request(app)
      .post(`/api/receiving/${record.id}/qc-review`)
      .set("Cookie", qaCookie)
      .send({ disposition: "APPROVED", password: "Neurogan1!Secure", commentary: "" });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/upload a COA/i);
  });

  it("allows sign-off without COA for EXEMPT records", async () => {
    const { record } = await seedRecord(adminId, "EXEMPT");
    const res = await request(app)
      .post(`/api/receiving/${record.id}/qc-review`)
      .set("Cookie", qaCookie)
      .send({ disposition: "APPROVED", password: "Neurogan1!Secure", commentary: "" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");
  });

  it("allows sign-off after COA is uploaded for non-EXEMPT records", async () => {
    const { record } = await seedRecord(adminId, "COA_REVIEW");
    await uploadCoa(app, record.id, qaCookie);
    const res = await request(app)
      .post(`/api/receiving/${record.id}/qc-review`)
      .set("Cookie", qaCookie)
      .send({ disposition: "APPROVED", password: "Neurogan1!Secure", commentary: "" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");
  });

  it("COA gate checks receivingRecordId, not lotId — COA on same lot different record does not satisfy gate", async () => {
    const { record: r1, lot } = await seedRecord(adminId, "COA_REVIEW");
    // Plant a COA row on the same lot but NOT tied to r1
    await db.insert(schema.coaDocuments).values({
      lotId: lot.id,
      receivingRecordId: null,
      sourceType: "SUPPLIER",
      overallResult: "PASS",
      fileName: "other.pdf",
    });
    const res = await request(app)
      .post(`/api/receiving/${r1.id}/qc-review`)
      .set("Cookie", qaCookie)
      .send({ disposition: "APPROVED", password: "Neurogan1!Secure", commentary: "" });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/upload a COA/i);
  });
});
