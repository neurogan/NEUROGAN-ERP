import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";
import { eq } from "drizzle-orm";
import { setLabelPrintAdapter, resetLabelPrintAdapter } from "../printing/registry";
import { StubAdapter } from "../printing/stub-adapter";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;
const VALID_PASSWORD = "Neurogan1!Secure";

let app: Express;
let adminId: string, qaId: string;
let productId: string;
let artworkId: string;
let spoolId: string;
let bprId: string;
let issuanceId: string;
const createdPrintJobIds: string[] = [];

beforeAll(async () => {
  if (!dbUrl) return;

  // Inject stub adapter so tests don't need a real printer.
  setLabelPrintAdapter(new StubAdapter());

  app = await buildTestApp();
  const sfx = Date.now();

  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r04pr-adm-${sfx}@t.com`,
      fullName: "R04Print Admin",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: null as unknown as string,
    })
    .returning();
  adminId = adm!.id;
  await db.insert(schema.userRoles).values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });

  const [qa] = await db
    .insert(schema.users)
    .values({
      email: `r04pr-qa-${sfx}@t.com`,
      fullName: "R04Print QA",
      title: "QC Manager",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  qaId = qa!.id;
  await db.insert(schema.userRoles).values({ userId: qaId, role: "QA", grantedByUserId: adminId });

  // Create product.
  const [product] = await db
    .insert(schema.products)
    .values({ sku: `R04PR-${sfx}`, name: "R04 Print Test Product" })
    .returning();
  productId = product!.id;

  // Create and approve artwork.
  const artworkRes = await request(app)
    .post("/api/label-artwork")
    .set("x-test-user-id", qaId)
    .send({
      productId,
      version: `v1.0-pr-${sfx}`,
      artworkFileName: `label-pr-${sfx}.pdf`,
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
      spoolNumber: `SP-PR-${sfx}`,
      qtyInitial: 1000,
      password: VALID_PASSWORD,
    });
  spoolId = (spoolRes.body as { id: string }).id;

  // Create a BPR in IN_PROGRESS status.
  const [bprRow] = await db
    .insert(schema.batchProductionRecords)
    .values({
      productionBatchId: `BATCH-PR-${sfx}`,
      batchNumber: `BN-PR-${sfx}`,
      productId,
      status: "IN_PROGRESS",
    })
    .returning();
  bprId = bprRow!.id;

  // Issue labels (creates the issuance log row that print routes operate on).
  const issuanceRes = await request(app)
    .post(`/api/bpr/${bprId}/label-issuance`)
    .set("x-test-user-id", qaId)
    .send({ spoolId, qty: 100 });
  issuanceId = (issuanceRes.body as { id: string }).id;
});

afterAll(async () => {
  if (!dbUrl) return;

  // Restore real adapter.
  resetLabelPrintAdapter();

  // Clean up print jobs.
  for (const id of createdPrintJobIds) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, id)).catch(() => {});
    await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.entityId, id)).catch(() => {});
    await db.delete(schema.labelPrintJobs).where(eq(schema.labelPrintJobs.id, id)).catch(() => {});
  }

  // Clean up issuance log.
  if (issuanceId) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, issuanceId)).catch(() => {});
    await db.delete(schema.labelIssuanceLog).where(eq(schema.labelIssuanceLog.id, issuanceId)).catch(() => {});
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

  for (const uid of [adminId, qaId].filter(Boolean)) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, uid)).catch(() => {});
    await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.userId, uid)).catch(() => {});
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, uid)).catch(() => {});
    await db.delete(schema.users).where(eq(schema.users.id, uid)).catch(() => {});
  }
});

describeIfDb("R-04 label print job routes", () => {
  const printBody = () => ({
    password: VALID_PASSWORD,
    qty: 25,
    lot: "LOT-2026-001",
    expiry: "2027-12-31T00:00:00.000Z",
    artworkId: "", // filled in per-test
  });

  // ─── POST /api/label-issuance/:id/print ─────────────────────────────────────

  it("POST /api/label-issuance/:id/print — 201, adapter called, print job returned", async () => {
    const res = await request(app)
      .post(`/api/label-issuance/${issuanceId}/print`)
      .set("x-test-user-id", qaId)
      .send({ ...printBody(), artworkId });
    expect(res.status).toBe(201);
    expect((res.body as { issuanceLogId: string }).issuanceLogId).toBe(issuanceId);
    expect((res.body as { adapter: string }).adapter).toBe("STUB");
    expect((res.body as { status: string }).status).toBe("SUCCESS");
    expect((res.body as { qtyPrinted: number }).qtyPrinted).toBe(25);
    createdPrintJobIds.push((res.body as { id: string }).id);
  });

  it("POST /api/label-issuance/:id/print — 400 missing password", async () => {
    const { password: _omit, ...bodyNoPass } = { ...printBody(), artworkId };
    const res = await request(app)
      .post(`/api/label-issuance/${issuanceId}/print`)
      .set("x-test-user-id", qaId)
      .send(bodyNoPass);
    expect(res.status).toBe(400);
  });

  it("POST /api/label-issuance/:id/print — 401 wrong password", async () => {
    const res = await request(app)
      .post(`/api/label-issuance/${issuanceId}/print`)
      .set("x-test-user-id", qaId)
      .send({ ...printBody(), artworkId, password: "wrong-password-definitely" });
    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error?.code).toBe("UNAUTHENTICATED");
  });
});
