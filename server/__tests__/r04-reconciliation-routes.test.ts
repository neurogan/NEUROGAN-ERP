import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";
import { eq } from "drizzle-orm";
import { createArtwork, approveArtwork } from "../storage/label-artwork";
import { receiveSpool } from "../storage/label-spools";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;
const VALID_PASSWORD = "Neurogan1!Secure";

let app: Express;
let adminId: string, qaId: string;
let productId: string;
let approvedArtworkId: string;
let activeSpoolId: string;

const createdBprIds: string[] = [];
const createdIssuanceIds: string[] = [];
const createdReconciliationIds: string[] = [];
const createdDeviationIds: string[] = [];
const createdSpoolIds: string[] = [];

async function makeBpr(sfx: string | number) {
  const [bpr] = await db
    .insert(schema.batchProductionRecords)
    .values({
      productionBatchId: `BATCH-RECONRT-${sfx}`,
      batchNumber: `BN-RECONRT-${sfx}`,
      productId,
      status: "IN_PROGRESS",
    })
    .returning();
  createdBprIds.push(bpr!.id);
  return bpr!;
}

async function issueLabels(bprId: string, qty: number) {
  const [row] = await db
    .insert(schema.labelIssuanceLog)
    .values({
      bprId,
      spoolId: activeSpoolId,
      artworkId: approvedArtworkId,
      quantityIssued: qty,
      issuedByUserId: adminId,
    })
    .returning();
  createdIssuanceIds.push(row!.id);
  return row!;
}

beforeAll(async () => {
  if (!dbUrl) return;
  app = await buildTestApp();
  const sfx = Date.now();

  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r04reconrt-adm-${sfx}@t.com`,
      fullName: "R04ReconRt Admin",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: null as unknown as string,
    })
    .returning();
  adminId = adm!.id;
  await db.insert(schema.userRoles).values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });

  const [qa] = await db
    .insert(schema.users)
    .values({
      email: `r04reconrt-qa-${sfx}@t.com`,
      fullName: "R04ReconRt QA",
      title: "QC Manager",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  qaId = qa!.id;
  await db.insert(schema.userRoles).values({ userId: qaId, role: "QA", grantedByUserId: adminId });

  const [prod] = await db
    .insert(schema.products)
    .values({ sku: `R04RECONRT-${sfx}`, name: "R04 Recon Routes Product" })
    .returning();
  productId = prod!.id;

  const draft = await createArtwork(
    {
      productId,
      version: "v1.0",
      artworkFileName: "reconrt-label.pdf",
      artworkFileData: "base64placeholder",
      artworkMimeType: "application/pdf",
      variableDataSpec: { lotNumber: true, expirationDate: true },
      status: "DRAFT" as const,
    },
    adminId,
    "req-reconrt-aw-create",
    "POST /api/label-artwork",
  );
  const approved = await approveArtwork(
    draft.id,
    qaId,
    VALID_PASSWORD,
    "req-reconrt-aw-approve",
    "POST /api/label-artwork/:id/approve",
  );
  approvedArtworkId = approved.id;

  const spool = await receiveSpool(
    {
      artworkId: approvedArtworkId,
      spoolNumber: `RECONRT-SPOOL-${sfx}`,
      qtyInitial: 5000,
    },
    qaId,
    VALID_PASSWORD,
    "req-reconrt-spool-receive",
    "POST /api/label-spools",
  );
  activeSpoolId = spool.id;
  createdSpoolIds.push(spool.id);
});

afterAll(async () => {
  if (!dbUrl) return;

  for (const id of createdReconciliationIds) {
    await db.update(schema.labelReconciliations).set({ signatureId: null }).where(eq(schema.labelReconciliations.id, id)).catch(() => {});
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, id)).catch(() => {});
    await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.entityId, id)).catch(() => {});
    await db.delete(schema.labelReconciliations).where(eq(schema.labelReconciliations.id, id)).catch(() => {});
  }

  for (const id of createdIssuanceIds) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, id)).catch(() => {});
    await db.delete(schema.labelIssuanceLog).where(eq(schema.labelIssuanceLog.id, id)).catch(() => {});
  }

  for (const id of createdDeviationIds) {
    await db.delete(schema.bprDeviations).where(eq(schema.bprDeviations.id, id)).catch(() => {});
  }

  for (const id of createdBprIds) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, id)).catch(() => {});
    await db.delete(schema.batchProductionRecords).where(eq(schema.batchProductionRecords.id, id)).catch(() => {});
  }

  for (const id of createdSpoolIds) {
    await db.update(schema.labelSpools).set({ receivedBySignatureId: null, disposedBySignatureId: null }).where(eq(schema.labelSpools.id, id)).catch(() => {});
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, id)).catch(() => {});
    await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.entityId, id)).catch(() => {});
    await db.delete(schema.labelSpools).where(eq(schema.labelSpools.id, id)).catch(() => {});
  }

  if (approvedArtworkId) {
    await db.update(schema.labelArtwork).set({ approvedBySignatureId: null, retiredBySignatureId: null }).where(eq(schema.labelArtwork.id, approvedArtworkId)).catch(() => {});
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, approvedArtworkId)).catch(() => {});
    await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.entityId, approvedArtworkId)).catch(() => {});
    await db.delete(schema.labelArtwork).where(eq(schema.labelArtwork.id, approvedArtworkId)).catch(() => {});
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

describeIfDb("R-04 label reconciliation API routes", () => {
  // ─── POST /api/bpr/:id/label-reconciliation ──────────────────────────────────

  it("POST — 400 when password missing", async () => {
    const bpr = await makeBpr(`nopass-${Date.now()}`);
    await issueLabels(bpr.id, 100);

    const res = await request(app)
      .post(`/api/bpr/${bpr.id}/label-reconciliation`)
      .set("x-test-user-id", qaId)
      .send({ qtyApplied: 95, qtyReturned: 3, qtyDestroyed: 0 });
    expect(res.status).toBe(400);
  });

  it("POST — 401 for wrong password", async () => {
    const bpr = await makeBpr(`badpass-${Date.now()}`);
    await issueLabels(bpr.id, 100);

    const res = await request(app)
      .post(`/api/bpr/${bpr.id}/label-reconciliation`)
      .set("x-test-user-id", qaId)
      .send({ password: "wrong-password", qtyApplied: 95, qtyReturned: 3, qtyDestroyed: 0 });
    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error?.code).toBe("UNAUTHENTICATED");
  });

  it("POST — 201 happy path (in-tolerance)", async () => {
    const bpr = await makeBpr(`happy-${Date.now()}`);
    await issueLabels(bpr.id, 100);

    // variance = 100 - 95 - 3 - 0 = 2 (within default tolerance 5)
    const res = await request(app)
      .post(`/api/bpr/${bpr.id}/label-reconciliation`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD, qtyApplied: 95, qtyReturned: 3, qtyDestroyed: 0 });
    expect(res.status).toBe(201);
    const body = res.body as { id: string; bprId: string; toleranceExceeded: boolean; signatureId: string | null };
    expect(body.bprId).toBe(bpr.id);
    expect(body.toleranceExceeded).toBe(false);
    expect(body.signatureId).toBeTruthy();
    createdReconciliationIds.push(body.id);
  });

  it("POST — 409 ALREADY_RECONCILED on double-submit", async () => {
    const bpr = await makeBpr(`dup-${Date.now()}`);
    await issueLabels(bpr.id, 100);

    const first = await request(app)
      .post(`/api/bpr/${bpr.id}/label-reconciliation`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD, qtyApplied: 95, qtyReturned: 3, qtyDestroyed: 0 });
    expect(first.status).toBe(201);
    createdReconciliationIds.push((first.body as { id: string }).id);

    const second = await request(app)
      .post(`/api/bpr/${bpr.id}/label-reconciliation`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD, qtyApplied: 95, qtyReturned: 3, qtyDestroyed: 0 });
    expect(second.status).toBe(409);
    expect((second.body as { code: string }).code).toBe("ALREADY_RECONCILED");
  });

  it("POST — 409 TOLERANCE_EXCEEDED when variance large and no deviationId", async () => {
    const bpr = await makeBpr(`tol-${Date.now()}`);
    await issueLabels(bpr.id, 100);

    // variance = 100 - 10 - 0 - 0 = 90, exceeds tolerance 5
    const res = await request(app)
      .post(`/api/bpr/${bpr.id}/label-reconciliation`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD, qtyApplied: 10, qtyReturned: 0, qtyDestroyed: 0 });
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe("TOLERANCE_EXCEEDED");
  });

  it("POST — 201 out-of-tolerance with deviationId", async () => {
    const bpr = await makeBpr(`toldev-${Date.now()}`);
    await issueLabels(bpr.id, 100);

    const [deviation] = await db
      .insert(schema.bprDeviations)
      .values({ bprId: bpr.id, deviationDescription: "Label variance", reportedBy: "Test" })
      .returning();
    createdDeviationIds.push(deviation!.id);

    // variance = 90, out of tolerance, but deviationId provided → should succeed
    const res = await request(app)
      .post(`/api/bpr/${bpr.id}/label-reconciliation`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD, qtyApplied: 10, qtyReturned: 0, qtyDestroyed: 0, deviationId: deviation!.id });
    expect(res.status).toBe(201);
    const body = res.body as { id: string; toleranceExceeded: boolean; deviationId: string };
    expect(body.toleranceExceeded).toBe(true);
    expect(body.deviationId).toBe(deviation!.id);
    createdReconciliationIds.push(body.id);
  });

  // ─── GET /api/bpr/:id/label-reconciliation ───────────────────────────────────

  it("GET — 200 returns existing reconciliation", async () => {
    const bpr = await makeBpr(`get-ok-${Date.now()}`);
    await issueLabels(bpr.id, 100);

    const postRes = await request(app)
      .post(`/api/bpr/${bpr.id}/label-reconciliation`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD, qtyApplied: 95, qtyReturned: 3, qtyDestroyed: 0 });
    expect(postRes.status).toBe(201);
    const reconId = (postRes.body as { id: string }).id;
    createdReconciliationIds.push(reconId);

    const res = await request(app)
      .get(`/api/bpr/${bpr.id}/label-reconciliation`)
      .set("x-test-user-id", adminId);
    expect(res.status).toBe(200);
    expect((res.body as { id: string }).id).toBe(reconId);
  });

  it("GET — 404 for BPR with no reconciliation", async () => {
    const bpr = await makeBpr(`get-miss-${Date.now()}`);

    const res = await request(app)
      .get(`/api/bpr/${bpr.id}/label-reconciliation`)
      .set("x-test-user-id", adminId);
    expect(res.status).toBe(404);
  });
});
