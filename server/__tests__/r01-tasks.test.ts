import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { db } from "../db";
import * as schema from "@shared/schema";

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
  await db.delete(schema.products);
  await db.delete(schema.suppliers);
}

async function seedReceivingRecord(opts: { status: string; qcWorkflowType: string; requiresQualification?: boolean; productName?: string }) {
  const [product] = await db.insert(schema.products).values({ name: opts.productName ?? "Tasks Test Product", sku: `TASK-${Date.now()}-${Math.random()}`, category: "ACTIVE_INGREDIENT", defaultUom: "g", status: "ACTIVE" }).returning();
  const [supplier] = await db.insert(schema.suppliers).values({ name: "Tasks Test Supplier" }).returning();
  const [lot] = await db.insert(schema.lots).values({ productId: product!.id, lotNumber: `TASK-LOT-${Date.now()}`, supplierName: supplier!.name, quarantineStatus: opts.status }).returning();
  const [record] = await db.insert(schema.receivingRecords).values({
    lotId: lot!.id,
    supplierId: supplier!.id,
    uniqueIdentifier: `RCV-TASK-${Date.now()}`,
    status: opts.status,
    qcWorkflowType: opts.qcWorkflowType,
    requiresQualification: opts.requiresQualification ?? false,
    dateReceived: "2026-04-23",
    quantityReceived: "10",
    uom: "kg",
  }).returning();
  return record!;
}

describeIfDb("R-01 — tasks endpoint", () => {
  let app: Express;
  let adminId: string;
  let qaId: string;
  let receivingId: string;
  let productionId: string;

  beforeAll(async () => { app = await buildTestApp(); });

  beforeEach(async () => {
    await cleanDb();
    const admin = await storage.createUser({ email: "admin@tasks.test", fullName: "Admin", title: null, passwordHash: await hashPassword("Neurogan1!Secure"), roles: ["ADMIN"], createdByUserId: null, grantedByUserId: null });
    adminId = admin.id;
    const qa = await storage.createUser({ email: "qa@tasks.test", fullName: "QA User", title: "QC Manager", passwordHash: await hashPassword("Neurogan1!Secure"), roles: ["QA"], createdByUserId: adminId, grantedByUserId: adminId });
    qaId = qa.id;
    const recv = await storage.createUser({ email: "recv@tasks.test", fullName: "Warehouse User", title: null, passwordHash: await hashPassword("Neurogan1!Secure"), roles: ["RECEIVING"], createdByUserId: adminId, grantedByUserId: adminId });
    receivingId = recv.id;
    const prod = await storage.createUser({ email: "prod@tasks.test", fullName: "Production User", title: null, passwordHash: await hashPassword("Neurogan1!Secure"), roles: ["PRODUCTION"], createdByUserId: adminId, grantedByUserId: adminId });
    productionId = prod.id;
  });

  afterAll(async () => { await cleanDb(); });

  it("GET /api/tasks returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/tasks");
    expect(res.status).toBe(401);
  });

  it("QA user sees FULL_LAB_TEST and PENDING_QC tasks", async () => {
    await seedReceivingRecord({ status: "QUARANTINED", qcWorkflowType: "FULL_LAB_TEST", requiresQualification: true, productName: "Hemp Extract" });
    await seedReceivingRecord({ status: "PENDING_QC", qcWorkflowType: "COA_REVIEW", productName: "Bottles" });

    const res = await request(app).get("/api/tasks").set("x-test-user-id", qaId);
    expect(res.status).toBe(200);
    const tasks = res.body as Array<{ taskType: string }>;
    expect(tasks.some((t) => t.taskType === "LAB_TEST_REQUIRED" || t.taskType === "QUALIFICATION_REQUIRED")).toBe(true);
    expect(tasks.some((t) => t.taskType === "PENDING_QC")).toBe(true);
  });

  it("RECEIVING user sees IDENTITY_CHECK tasks", async () => {
    await seedReceivingRecord({ status: "QUARANTINED", qcWorkflowType: "IDENTITY_CHECK", productName: "MCT Oil" });

    const res = await request(app).get("/api/tasks").set("x-test-user-id", receivingId);
    expect(res.status).toBe(200);
    const tasks = res.body as Array<{ taskType: string }>;
    expect(tasks.some((t) => t.taskType === "IDENTITY_CHECK_REQUIRED")).toBe(true);
  });

  it("PRODUCTION user sees empty tasks", async () => {
    await seedReceivingRecord({ status: "QUARANTINED", qcWorkflowType: "FULL_LAB_TEST" });
    const res = await request(app).get("/api/tasks").set("x-test-user-id", productionId);
    expect(res.status).toBe(200);
    expect((res.body as unknown[]).length).toBe(0);
  });
});
