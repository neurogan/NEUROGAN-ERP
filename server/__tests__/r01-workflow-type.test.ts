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

async function seedUser(email: string, roles: string[], createdById: string | null) {
  const hash = await hashPassword("Neurogan1!Secure");
  return storage.createUser({ email, fullName: "Test", title: null, passwordHash: hash, roles: roles as any, createdByUserId: createdById, grantedByUserId: createdById });
}

async function cleanDb() {
  await db.update(schema.validationDocuments).set({ signatureId: null });
  await db.delete(schema.electronicSignatures);
  await db.delete(schema.receivingRecords);
  await db.delete(schema.approvedMaterials);
  await db.delete(schema.auditTrail);
  await db.delete(schema.passwordHistory);
  await db.delete(schema.userRoles);
  await db.delete(schema.users);
}

async function seedProductAndSupplierAndLot(category: string) {
  const [product] = await db.insert(schema.products).values({
    name: `Test Product ${category}`,
    sku: `TEST-${category}-${Date.now()}`,
    category,
    defaultUom: "g",
    status: "ACTIVE",
  }).returning();

  const [supplier] = await db.insert(schema.suppliers).values({
    name: `Test Supplier ${Date.now()}`,
  }).returning();

  const [lot] = await db.insert(schema.lots).values({
    productId: product!.id,
    lotNumber: `LOT-${Date.now()}`,
    supplierName: supplier!.name,
  }).returning();

  return { product: product!, supplier: supplier!, lot: lot! };
}

describeIfDb("R-01 — workflow type determination", () => {
  let app: Express;
  let adminId: string;
  let receivingUserId: string;

  beforeAll(async () => { app = await buildTestApp(); });

  beforeEach(async () => {
    await cleanDb();
    const admin = await seedUser("admin@workflow.test", ["ADMIN"], null);
    adminId = admin.id;
    const recv = await seedUser("recv@workflow.test", ["RECEIVING"], adminId);
    receivingUserId = recv.id;
  });

  afterAll(async () => { await cleanDb(); });

  it("ACTIVE_INGREDIENT + unknown supplier → FULL_LAB_TEST + requires_qualification", async () => {
    const { product, supplier, lot } = await seedProductAndSupplierAndLot("ACTIVE_INGREDIENT");
    const res = await request(app)
      .post("/api/receiving")
      .set("x-test-user-id", receivingUserId)
      .send({ lotId: lot.id, supplierId: supplier.id, productId: product.id, uniqueIdentifier: `RCV-TEST-001`, quantityReceived: "10", uom: "kg", dateReceived: "2026-04-23" });
    expect(res.status).toBe(201);
    expect((res.body as any).qcWorkflowType).toBe("FULL_LAB_TEST");
    expect((res.body as any).requiresQualification).toBe(true);
  });

  it("ACTIVE_INGREDIENT + approved supplier → IDENTITY_CHECK + no qualification", async () => {
    const { product, supplier, lot } = await seedProductAndSupplierAndLot("ACTIVE_INGREDIENT");
    await db.insert(schema.approvedMaterials).values({ productId: product.id, supplierId: supplier.id, approvedByUserId: adminId });

    const res = await request(app)
      .post("/api/receiving")
      .set("x-test-user-id", receivingUserId)
      .send({ lotId: lot.id, supplierId: supplier.id, productId: product.id, uniqueIdentifier: `RCV-TEST-002`, quantityReceived: "10", uom: "kg", dateReceived: "2026-04-23" });
    expect(res.status).toBe(201);
    expect((res.body as any).qcWorkflowType).toBe("IDENTITY_CHECK");
    expect((res.body as any).requiresQualification).toBe(false);
  });

  it("PRIMARY_PACKAGING → COA_REVIEW regardless of supplier", async () => {
    const { supplier, lot } = await seedProductAndSupplierAndLot("PRIMARY_PACKAGING");
    const res = await request(app)
      .post("/api/receiving")
      .set("x-test-user-id", receivingUserId)
      .send({ lotId: lot.id, supplierId: supplier.id, uniqueIdentifier: `RCV-TEST-003`, quantityReceived: "100", uom: "pcs", dateReceived: "2026-04-23" });
    expect(res.status).toBe(201);
    expect((res.body as any).qcWorkflowType).toBe("COA_REVIEW");
    expect((res.body as any).requiresQualification).toBe(false);
  });

  it("SECONDARY_PACKAGING → EXEMPT", async () => {
    const { supplier, lot } = await seedProductAndSupplierAndLot("SECONDARY_PACKAGING");
    const res = await request(app)
      .post("/api/receiving")
      .set("x-test-user-id", receivingUserId)
      .send({ lotId: lot.id, supplierId: supplier.id, uniqueIdentifier: `RCV-TEST-004`, quantityReceived: "50", uom: "pcs", dateReceived: "2026-04-23" });
    expect(res.status).toBe(201);
    expect((res.body as any).qcWorkflowType).toBe("EXEMPT");
  });
});
