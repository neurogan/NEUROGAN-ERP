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

const VALID_PASSWORD = "Neurogan1!Secure";

async function seedAdmin(email: string) {
  const hash = await hashPassword(VALID_PASSWORD);
  return storage.createUser({ email, fullName: "Admin", title: null, passwordHash: hash, roles: ["ADMIN"], createdByUserId: null, grantedByUserId: null });
}

async function cleanDb() {
  await db.update(schema.validationDocuments).set({ signatureId: null });
  await db.delete(schema.electronicSignatures);
  await db.delete(schema.approvedMaterials);
  await db.delete(schema.auditTrail);
  await db.delete(schema.passwordHistory);
  await db.delete(schema.userRoles);
  await db.delete(schema.users);
}

async function seedApprovedMaterial(productId: string, supplierId: string, adminId: string) {
  const [row] = await db.insert(schema.approvedMaterials).values({
    productId,
    supplierId,
    approvedByUserId: adminId,
  }).returning();
  return row!;
}

describeIfDb("R-01 — approved materials", () => {
  let app: Express;
  let adminId: string;

  beforeAll(async () => { app = await buildTestApp(); });
  beforeEach(async () => {
    await cleanDb();
    const admin = await seedAdmin("admin@approved.test");
    adminId = admin.id;
  });
  afterAll(async () => { await cleanDb(); });

  it("GET /api/approved-materials returns list for ADMIN", async () => {
    const res = await request(app)
      .get("/api/approved-materials")
      .set("x-test-user-id", adminId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/approved-materials returns 403 for non-ADMIN/QA", async () => {
    const viewer = await storage.createUser({ email: "viewer@approved.test", fullName: "Viewer", title: null, passwordHash: await hashPassword(VALID_PASSWORD), roles: ["VIEWER"], createdByUserId: adminId, grantedByUserId: adminId });
    const res = await request(app).get("/api/approved-materials").set("x-test-user-id", viewer.id);
    expect(res.status).toBe(403);
  });

  it("DELETE /api/approved-materials/:id sets isActive=false", async () => {
    // Need real product+supplier from DB for FK constraint
    const products = await db.select().from(schema.products).limit(1);
    const suppliers = await db.select().from(schema.suppliers).limit(1);
    if (!products[0] || !suppliers[0]) return; // skip if no seed data

    const entry = await seedApprovedMaterial(products[0].id, suppliers[0].id, adminId);
    const res = await request(app)
      .delete(`/api/approved-materials/${entry.id}`)
      .set("x-test-user-id", adminId);
    expect(res.status).toBe(200);

    const [updated] = await db.select().from(schema.approvedMaterials).where(eq(schema.approvedMaterials.id, entry.id));
    expect(updated?.isActive).toBe(false);
  });
});
