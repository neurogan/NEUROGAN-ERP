import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";
import { eq } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;
const VALID_PASSWORD = "Neurogan1!Secure";

let app: Express;
let adminId: string, qaId: string, prodId: string;
let productId: string;
let artworkId: string;
let spoolId: string;
let bprId: string;
const createdIssuanceIds: string[] = [];

beforeAll(async () => {
  if (!dbUrl) return;
  app = await buildTestApp();
  const sfx = Date.now();

  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r04is-adm-${sfx}@t.com`,
      fullName: "R04Issuance Admin",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: null as unknown as string,
    })
    .returning();
  adminId = adm!.id;
  await db.insert(schema.userRoles).values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });

  const [qa] = await db
    .insert(schema.users)
    .values({
      email: `r04is-qa-${sfx}@t.com`,
      fullName: "R04Issuance QA",
      title: "QC Manager",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  qaId = qa!.id;
  await db.insert(schema.userRoles).values({ userId: qaId, role: "QA", grantedByUserId: adminId });

  const [prod] = await db
    .insert(schema.users)
    .values({
      email: `r04is-prod-${sfx}@t.com`,
      fullName: "R04Issuance Production",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  prodId = prod!.id;
  await db.insert(schema.userRoles).values({ userId: prodId, role: "PRODUCTION", grantedByUserId: adminId });

  // Create product.
  const [product] = await db
    .insert(schema.products)
    .values({ sku: `R04IS-${sfx}`, name: "R04 Issuance Test Product" })
    .returning();
  productId = product!.id;

  // Create and approve artwork.
  const artworkRes = await request(app)
    .post("/api/label-artwork")
    .set("x-test-user-id", qaId)
    .send({
      productId,
      version: `v1.0-is-${sfx}`,
      artworkFileName: `label-is-${sfx}.pdf`,
      artworkFileData: "base64dataplaceholder",
      artworkMimeType: "application/pdf",
      variableDataSpec: { lotNumber: true },
    });
  artworkId = (artworkRes.body as { id: string }).id;
  await request(app)
    .post(`/api/label-artwork/${artworkId}/approve`)
    .set("x-test-user-id", qaId)
    .send({ password: VALID_PASSWORD });

  // Create an active spool.
  const spoolRes = await request(app)
    .post("/api/label-spools")
    .set("x-test-user-id", qaId)
    .send({
      artworkId,
      spoolNumber: `SP-IS-${sfx}`,
      qtyInitial: 1000,
      password: VALID_PASSWORD,
    });
  spoolId = (spoolRes.body as { id: string }).id;

  // Create a BPR in IN_PROGRESS status.
  const [bprRow] = await db
    .insert(schema.batchProductionRecords)
    .values({
      productionBatchId: `BATCH-IS-${sfx}`,
      batchNumber: `BN-IS-${sfx}`,
      productId,
      status: "IN_PROGRESS",
    })
    .returning();
  bprId = bprRow!.id;
});

afterAll(async () => {
  if (!dbUrl) return;

  // Clean up issuance logs (print jobs already deleted via issuance FK cascade or manually).
  for (const id of createdIssuanceIds) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, id)).catch(() => {});
    await db.delete(schema.labelIssuanceLog).where(eq(schema.labelIssuanceLog.id, id)).catch(() => {});
  }

  // Clean up BPR.
  if (bprId) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, bprId)).catch(() => {});
    await db.delete(schema.batchProductionRecords).where(eq(schema.batchProductionRecords.id, bprId)).catch(() => {});
  }

  // Clean up spool.
  if (spoolId) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, spoolId)).catch(() => {});
    await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.entityId, spoolId)).catch(() => {});
    await db.delete(schema.labelSpools).where(eq(schema.labelSpools.id, spoolId)).catch(() => {});
  }

  // Clean up artwork.
  if (artworkId) {
    await db
      .update(schema.labelArtwork)
      .set({ approvedBySignatureId: null, retiredBySignatureId: null })
      .where(eq(schema.labelArtwork.id, artworkId))
      .catch(() => {});
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, artworkId)).catch(() => {});
    await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.entityId, artworkId)).catch(() => {});
    await db.delete(schema.labelArtwork).where(eq(schema.labelArtwork.id, artworkId)).catch(() => {});
  }

  if (productId) {
    await db.delete(schema.products).where(eq(schema.products.id, productId)).catch(() => {});
  }

  for (const uid of [adminId, qaId, prodId].filter(Boolean)) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, uid)).catch(() => {});
    await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.userId, uid)).catch(() => {});
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, uid)).catch(() => {});
    await db.delete(schema.users).where(eq(schema.users.id, uid)).catch(() => {});
  }
});

describeIfDb("R-04 label issuance routes", () => {
  // ─── POST /api/bpr/:id/label-issuance ───────────────────────────────────────

  it("POST /api/bpr/:id/label-issuance — 201, issuance row returned", async () => {
    const res = await request(app)
      .post(`/api/bpr/${bprId}/label-issuance`)
      .set("x-test-user-id", prodId)
      .send({ spoolId, qty: 50 });
    expect(res.status).toBe(201);
    expect((res.body as { bprId: string }).bprId).toBe(bprId);
    expect((res.body as { spoolId: string }).spoolId).toBe(spoolId);
    expect((res.body as { quantityIssued: number }).quantityIssued).toBe(50);
    createdIssuanceIds.push((res.body as { id: string }).id);
  });

  it("POST /api/bpr/:id/label-issuance — 409 INSUFFICIENT_SPOOL_QTY", async () => {
    // Issue more than available (spool started at 1000, issued 50 above, request 1000 more).
    const res = await request(app)
      .post(`/api/bpr/${bprId}/label-issuance`)
      .set("x-test-user-id", prodId)
      .send({ spoolId, qty: 1000 });
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe("INSUFFICIENT_SPOOL_QTY");
  });

  // ─── GET /api/bpr/:id/label-issuance ────────────────────────────────────────

  it("GET /api/bpr/:id/label-issuance — 200 array with joined print jobs", async () => {
    const res = await request(app)
      .get(`/api/bpr/${bprId}/label-issuance`)
      .set("x-test-user-id", qaId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect((res.body as unknown[]).length).toBeGreaterThan(0);
    // Each entry should have issuance and printJobs array.
    const first = (res.body as { issuance: { bprId: string }; printJobs: unknown[] }[])[0]!;
    expect(first.issuance.bprId).toBe(bprId);
    expect(Array.isArray(first.printJobs)).toBe(true);
  });
});
