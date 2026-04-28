// R-04 label reconciliation storage tests.
//
// Tests reconcileBpr and getReconciliationForBpr.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../auth/password";
import { createArtwork, approveArtwork } from "../storage/label-artwork";
import { receiveSpool } from "../storage/label-spools";
import { issueLabels } from "../storage/label-issuance";
import {
  reconcileBpr,
  getReconciliationForBpr,
  type ReconcileInput,
} from "../storage/label-reconciliations";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const VALID_PASSWORD = "Neurogan1!Secure";

let adminId: string;
let qaId: string;
let productId: string;
let approvedArtworkId: string;
let activeSpoolId: string;
// Each test that calls reconcileBpr needs its own BPR (unique constraint).
// We create separate BPRs per scenario in beforeAll / per-test setup.
let bprId: string; // used for happy-path + double-reconcile tests

// Track IDs for cleanup
const createdBprIds: string[] = [];
const createdSpoolIds: string[] = [];
const createdReconciliationIds: string[] = [];
const createdIssuanceIds: string[] = [];
const createdDeviationIds: string[] = [];

async function makeBpr(sfx: string | number) {
  const [bpr] = await db
    .insert(schema.batchProductionRecords)
    .values({
      productionBatchId: `BATCH-RECON-${sfx}`,
      batchNumber: `BN-RECON-${sfx}`,
      productId,
      status: "IN_PROGRESS",
    })
    .returning();
  createdBprIds.push(bpr!.id);
  return bpr!;
}

beforeAll(async () => {
  if (!dbUrl) return;

  const sfx = Date.now();

  // --- Admin user ---
  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r04recon-adm-${sfx}@t.com`,
      fullName: "R04Recon Admin",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: null as unknown as string,
    })
    .returning();
  adminId = adm!.id;
  await db
    .insert(schema.userRoles)
    .values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });

  // --- QA user ---
  const [qa] = await db
    .insert(schema.users)
    .values({
      email: `r04recon-qa-${sfx}@t.com`,
      fullName: "R04Recon QA",
      title: "QC Manager",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  qaId = qa!.id;
  await db
    .insert(schema.userRoles)
    .values({ userId: qaId, role: "QA", grantedByUserId: adminId });

  // --- Product ---
  const [prod] = await db
    .insert(schema.products)
    .values({ sku: `R04RECON-${sfx}`, name: "R04 Reconciliation Test Product" })
    .returning();
  productId = prod!.id;

  // --- Approved artwork ---
  const draft = await createArtwork(
    {
      productId,
      version: "v1.0",
      artworkFileName: "recon-label-v1.pdf",
      artworkFileData: "base64placeholder",
      artworkMimeType: "application/pdf",
      variableDataSpec: { lotNumber: true, expirationDate: true },
      status: "DRAFT" as const,
    },
    adminId,
    "req-recon-artwork-create",
    "POST /api/label-artwork",
  );
  const approved = await approveArtwork(
    draft.id,
    qaId,
    VALID_PASSWORD,
    "req-recon-artwork-approve",
    "POST /api/label-artwork/:id/approve",
  );
  approvedArtworkId = approved.id;

  // --- Active spool ---
  const spool = await receiveSpool(
    {
      artworkId: approvedArtworkId,
      spoolNumber: `RECON-SPOOL-${sfx}`,
      qtyInitial: 1000,
    },
    qaId,
    VALID_PASSWORD,
    "req-recon-spool-receive",
    "POST /api/label-spools",
  );
  activeSpoolId = spool.id;
  createdSpoolIds.push(spool.id);

  // --- BPR for happy path + double-reconcile tests ---
  const bpr = await makeBpr(sfx);
  bprId = bpr.id;

  // Issue 100 labels to this BPR so qtyIssued = 100.
  const issuance = await issueLabels(
    bprId,
    activeSpoolId,
    100,
    adminId,
    "req-recon-issue",
    "POST /api/label-issuance",
  );
  createdIssuanceIds.push(issuance.id);
});

afterAll(async () => {
  if (!dbUrl) return;

  // 1. Nullify reconciliation FK then delete
  for (const id of createdReconciliationIds) {
    await db
      .update(schema.labelReconciliations)
      .set({ signatureId: null })
      .where(eq(schema.labelReconciliations.id, id))
      .catch(() => {});
    await db
      .delete(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, id))
      .catch(() => {});
    await db
      .delete(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, id))
      .catch(() => {});
    await db
      .delete(schema.labelReconciliations)
      .where(eq(schema.labelReconciliations.id, id))
      .catch(() => {});
  }

  // 2. Issuance log rows
  for (const id of createdIssuanceIds) {
    await db
      .delete(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, id))
      .catch(() => {});
    await db
      .delete(schema.labelIssuanceLog)
      .where(eq(schema.labelIssuanceLog.id, id))
      .catch(() => {});
  }

  // 3. Deviations (FK → BPRs)
  for (const id of createdDeviationIds) {
    await db.delete(schema.bprDeviations).where(eq(schema.bprDeviations.id, id)).catch(() => {});
  }

  // 4. BPRs
  for (const id of createdBprIds) {
    await db
      .delete(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, id))
      .catch(() => {});
    await db
      .delete(schema.batchProductionRecords)
      .where(eq(schema.batchProductionRecords.id, id))
      .catch(() => {});
  }

  // 5. Spools
  for (const id of createdSpoolIds) {
    await db
      .update(schema.labelSpools)
      .set({ receivedBySignatureId: null, disposedBySignatureId: null })
      .where(eq(schema.labelSpools.id, id))
      .catch(() => {});
    await db
      .delete(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, id))
      .catch(() => {});
    await db
      .delete(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, id))
      .catch(() => {});
    await db
      .delete(schema.labelSpools)
      .where(eq(schema.labelSpools.id, id))
      .catch(() => {});
  }

  // 5. Artwork
  if (approvedArtworkId) {
    await db
      .update(schema.labelArtwork)
      .set({ approvedBySignatureId: null, retiredBySignatureId: null })
      .where(eq(schema.labelArtwork.id, approvedArtworkId))
      .catch(() => {});
    await db
      .delete(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, approvedArtworkId))
      .catch(() => {});
    await db
      .delete(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, approvedArtworkId))
      .catch(() => {});
    await db
      .delete(schema.labelArtwork)
      .where(eq(schema.labelArtwork.id, approvedArtworkId))
      .catch(() => {});
  }

  // 6. Product
  if (productId) {
    await db
      .delete(schema.labelArtwork)
      .where(eq(schema.labelArtwork.productId, productId))
      .catch(() => {});
    await db
      .delete(schema.products)
      .where(eq(schema.products.id, productId))
      .catch(() => {});
  }

  // 7. Users
  for (const uid of [adminId, qaId].filter(Boolean)) {
    await db
      .delete(schema.auditTrail)
      .where(eq(schema.auditTrail.userId, uid))
      .catch(() => {});
    await db
      .delete(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.userId, uid))
      .catch(() => {});
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, uid)).catch(() => {});
    await db.delete(schema.users).where(eq(schema.users.id, uid)).catch(() => {});
  }
});

describeIfDb("R-04 label reconciliation storage", () => {
  // ─── reconcileBpr — happy path ────────────────────────────────────────────────

  it("reconcileBpr — happy path: in-tolerance, row inserted, signatureId set, audit written", async () => {
    // qtyIssued = 100, qtyApplied = 95, qtyReturned = 3, qtyDestroyed = 0
    // variance = 100 - 95 - 3 - 0 = 2 (within default tolerance of 5)
    const input: ReconcileInput = {
      bprId,
      qtyApplied: 95,
      qtyReturned: 3,
      qtyDestroyed: 0,
    };

    const recon = await reconcileBpr(
      input,
      qaId,
      VALID_PASSWORD,
      "req-recon-happy",
      "POST /api/label-reconciliations",
    );
    createdReconciliationIds.push(recon.id);

    expect(recon.bprId).toBe(bprId);
    expect(recon.qtyIssued).toBe(100);
    expect(recon.qtyApplied).toBe(95);
    expect(recon.qtyReturned).toBe(3);
    expect(recon.qtyDestroyed).toBe(0);
    expect(recon.variance).toBe(2);
    expect(recon.toleranceExceeded).toBe(false);
    expect(recon.signatureId).toBeTruthy();
    expect(recon.reconciledAt).toBeTruthy();

    // Audit rows should exist
    const audits = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, recon.id));
    expect(audits.some((a) => a.action === "LABEL_RECONCILED")).toBe(true);
    expect(audits.some((a) => a.action === "SIGN")).toBe(true);

    // Signature row should exist
    const sigs = await db
      .select()
      .from(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, recon.id));
    expect(sigs.some((s) => s.meaning === "LABEL_RECONCILED")).toBe(true);
  });

  // ─── reconcileBpr — tolerance exceeded without deviationId → 409 ──────────

  it("reconcileBpr — tolerance exceeded without deviationId → 409 TOLERANCE_EXCEEDED", async () => {
    // Create a fresh BPR and issue 100 labels
    const sfx = `tol-${Date.now()}`;
    const bpr2 = await makeBpr(sfx);
    const issuance2 = await issueLabels(
      bpr2.id,
      activeSpoolId,
      100,
      adminId,
      `req-recon-issue-tol-${sfx}`,
      "POST /api/label-issuance",
    );
    createdIssuanceIds.push(issuance2.id);

    // variance = 100 - 10 - 0 - 0 = 90, which exceeds tolerance 5
    const input: ReconcileInput = {
      bprId: bpr2.id,
      qtyApplied: 10,
      qtyReturned: 0,
      qtyDestroyed: 0,
      // no deviationId
    };

    await expect(
      reconcileBpr(
        input,
        qaId,
        VALID_PASSWORD,
        `req-recon-tol-${sfx}`,
        "POST /api/label-reconciliations",
      ),
    ).rejects.toMatchObject({ status: 409, code: "TOLERANCE_EXCEEDED" });
  });

  // ─── reconcileBpr — tolerance exceeded with deviationId → succeeds ─────────

  it("reconcileBpr — tolerance exceeded with deviationId → succeeds", async () => {
    // Create a fresh BPR and issue 100 labels
    const sfx = `toldev-${Date.now()}`;
    const bpr3 = await makeBpr(sfx);
    const issuance3 = await issueLabels(
      bpr3.id,
      activeSpoolId,
      100,
      adminId,
      `req-recon-issue-toldev-${sfx}`,
      "POST /api/label-issuance",
    );
    createdIssuanceIds.push(issuance3.id);

    // Create a deviation for this BPR
    const [deviation] = await db
      .insert(schema.bprDeviations)
      .values({
        bprId: bpr3.id,
        deviationDescription: "Label variance deviation for test",
        reportedBy: "R04Recon Admin",
      })
      .returning();
    createdDeviationIds.push(deviation!.id);

    const input: ReconcileInput = {
      bprId: bpr3.id,
      qtyApplied: 10,
      qtyReturned: 0,
      qtyDestroyed: 0,
      deviationId: deviation!.id,
    };

    const recon = await reconcileBpr(
      input,
      qaId,
      VALID_PASSWORD,
      `req-recon-toldev-${sfx}`,
      "POST /api/label-reconciliations",
    );
    createdReconciliationIds.push(recon.id);

    expect(recon.toleranceExceeded).toBe(true);
    expect(recon.deviationId).toBe(deviation!.id);
    expect(recon.signatureId).toBeTruthy();

  });

  // ─── reconcileBpr — double reconcile → 409 ALREADY_RECONCILED ────────────

  it("reconcileBpr — double reconcile same bprId → 409 ALREADY_RECONCILED", async () => {
    // bprId already has a reconciliation from the happy-path test above.
    const input: ReconcileInput = {
      bprId,
      qtyApplied: 95,
      qtyReturned: 3,
      qtyDestroyed: 0,
    };

    await expect(
      reconcileBpr(
        input,
        qaId,
        VALID_PASSWORD,
        "req-recon-double",
        "POST /api/label-reconciliations",
      ),
    ).rejects.toMatchObject({ status: 409, code: "ALREADY_RECONCILED" });
  });

  // ─── getReconciliationForBpr ──────────────────────────────────────────────

  it("getReconciliationForBpr — returns row by bprId, undefined for unknown", async () => {
    // bprId was reconciled in happy-path test.
    const found = await getReconciliationForBpr(bprId);
    expect(found).toBeDefined();
    expect(found!.bprId).toBe(bprId);

    const missing = await getReconciliationForBpr("00000000-0000-0000-0000-000000000000");
    expect(missing).toBeUndefined();
  });
});
