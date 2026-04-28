// R-04 label issuance + print-job storage tests.
//
// Tests issueLabels, recordPrintJob, listIssuanceForBpr, sumIssuedForBpr.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { hashPassword } from "../auth/password";
import { createArtwork, approveArtwork } from "../storage/label-artwork";
import { receiveSpool } from "../storage/label-spools";
import {
  issueLabels,
  recordPrintJob,
  listIssuanceForBpr,
  sumIssuedForBpr,
  type RecordPrintJobInput,
} from "../storage/label-issuance";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const VALID_PASSWORD = "Neurogan1!Secure";

let adminId: string;
let qaId: string;
let productId: string;
let approvedArtworkId: string;
let activeSpoolId: string;
let bprId: string;
let bprIdNotInProgress: string;
let disposedSpoolId: string;

// Track all created IDs for cleanup
const createdIssuanceIds: string[] = [];
const createdSpoolIds: string[] = [];
const createdBprIds: string[] = [];

beforeAll(async () => {
  if (!dbUrl) return;

  const sfx = Date.now();

  // --- Create admin user ---
  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r04iss-adm-${sfx}@t.com`,
      fullName: "R04Iss Admin",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: null as unknown as string,
    })
    .returning();
  adminId = adm!.id;
  await db
    .insert(schema.userRoles)
    .values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });

  // --- Create QA user ---
  const [qa] = await db
    .insert(schema.users)
    .values({
      email: `r04iss-qa-${sfx}@t.com`,
      fullName: "R04Iss QA",
      title: "QC Manager",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  qaId = qa!.id;
  await db
    .insert(schema.userRoles)
    .values({ userId: qaId, role: "QA", grantedByUserId: adminId });

  // --- Create product ---
  const [prod] = await db
    .insert(schema.products)
    .values({ sku: `R04ISS-${sfx}`, name: "R04 Issuance Test Product" })
    .returning();
  productId = prod!.id;

  // --- Create and approve artwork ---
  const draft = await createArtwork(
    {
      productId,
      version: "v1.0",
      artworkFileName: "iss-label-v1.pdf",
      artworkFileData: "base64placeholder",
      artworkMimeType: "application/pdf",
      variableDataSpec: { lotNumber: true, expirationDate: true },
      status: "DRAFT" as const,
    },
    adminId,
    "req-iss-artwork-create",
    "POST /api/label-artwork",
  );
  const approved = await approveArtwork(
    draft.id,
    qaId,
    VALID_PASSWORD,
    "req-iss-artwork-approve",
    "POST /api/label-artwork/:id/approve",
  );
  approvedArtworkId = approved.id;

  // --- Create ACTIVE spool ---
  const spool = await receiveSpool(
    {
      artworkId: approvedArtworkId,
      spoolNumber: `ISS-SPOOL-${sfx}`,
      qtyInitial: 500,
    },
    qaId,
    VALID_PASSWORD,
    "req-iss-spool-receive",
    "POST /api/label-spools",
  );
  activeSpoolId = spool.id;
  createdSpoolIds.push(spool.id);

  // --- Create DISPOSED spool for SPOOL_NOT_ACTIVE test ---
  const spool2 = await receiveSpool(
    {
      artworkId: approvedArtworkId,
      spoolNumber: `ISS-DISPOSED-${sfx}`,
      qtyInitial: 100,
    },
    qaId,
    VALID_PASSWORD,
    "req-iss-spool-dispose",
    "POST /api/label-spools",
  );
  disposedSpoolId = spool2.id;
  createdSpoolIds.push(spool2.id);
  // Directly update spool to DISPOSED status for test
  await db
    .update(schema.labelSpools)
    .set({ status: "DISPOSED" })
    .where(eq(schema.labelSpools.id, disposedSpoolId));

  // --- Create IN_PROGRESS BPR ---
  const [bpr] = await db
    .insert(schema.batchProductionRecords)
    .values({
      productionBatchId: `BATCH-ISS-${sfx}`,
      batchNumber: `BN-ISS-${sfx}`,
      productId,
      status: "IN_PROGRESS",
    })
    .returning();
  bprId = bpr!.id;
  createdBprIds.push(bprId);

  // --- Create BPR not in IN_PROGRESS (APPROVED) for BPR_NOT_IN_PROGRESS test ---
  const [bpr2] = await db
    .insert(schema.batchProductionRecords)
    .values({
      productionBatchId: `BATCH-ISS-NIP-${sfx}`,
      batchNumber: `BN-ISS-NIP-${sfx}`,
      productId,
      status: "APPROVED",
    })
    .returning();
  bprIdNotInProgress = bpr2!.id;
  createdBprIds.push(bprIdNotInProgress);
});

afterAll(async () => {
  if (!dbUrl) return;

  // Clean up print jobs first (FK → issuance log)
  if (createdIssuanceIds.length > 0) {
    await db
      .delete(schema.labelPrintJobs)
      .where(inArray(schema.labelPrintJobs.issuanceLogId, createdIssuanceIds))
      .catch(() => {});
  }

  // Clean up issuance log rows
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

  // Clean up BPRs
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

  // Clean up spools
  for (const id of createdSpoolIds) {
    await db
      .update(schema.labelSpools)
      .set({ receivedBySignatureId: null, disposedBySignatureId: null })
      .where(eq(schema.labelSpools.id, id))
      .catch(() => {});
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, id)).catch(() => {});
    await db
      .delete(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, id))
      .catch(() => {});
    await db.delete(schema.labelSpools).where(eq(schema.labelSpools.id, id)).catch(() => {});
  }

  // Clean up artwork
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

  // Clean up product
  if (productId) {
    await db.delete(schema.products).where(eq(schema.products.id, productId)).catch(() => {});
  }

  // Clean up users
  for (const uid of [adminId, qaId].filter(Boolean)) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, uid)).catch(() => {});
    await db
      .delete(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.userId, uid))
      .catch(() => {});
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, uid)).catch(() => {});
    await db.delete(schema.users).where(eq(schema.users.id, uid)).catch(() => {});
  }
});

describeIfDb("R-04 label issuance + print-job storage", () => {
  // ─── issueLabels ───────────────────────────────────────────────────────────────

  it("issueLabels — happy path: inserts issuance log, decrements spool, writes LABEL_ISSUED audit", async () => {
    const issuance = await issueLabels(
      bprId,
      activeSpoolId,
      50,
      adminId,
      "req-issue-1",
      "POST /api/label-issuance",
    );
    createdIssuanceIds.push(issuance.id);

    expect(issuance.bprId).toBe(bprId);
    expect(issuance.spoolId).toBe(activeSpoolId);
    expect(issuance.artworkId).toBe(approvedArtworkId);
    expect(issuance.quantityIssued).toBe(50);
    expect(issuance.issuedByUserId).toBe(adminId);
    expect(issuance.id).toBeTruthy();
    expect(issuance.issuedAt).toBeTruthy();

    // Verify spool qty was decremented
    const [spool] = await db
      .select()
      .from(schema.labelSpools)
      .where(eq(schema.labelSpools.id, activeSpoolId));
    expect(spool!.qtyOnHand).toBe(450); // 500 - 50

    // Verify audit row
    const audits = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, issuance.id));
    expect(audits.some((a) => a.action === "LABEL_ISSUED")).toBe(true);
  });

  it("issueLabels — 409 BPR_NOT_IN_PROGRESS when BPR is not IN_PROGRESS", async () => {
    await expect(
      issueLabels(
        bprIdNotInProgress,
        activeSpoolId,
        10,
        adminId,
        "req-issue-bpr-nip",
        "POST /api/label-issuance",
      ),
    ).rejects.toMatchObject({ status: 409, code: "BPR_NOT_IN_PROGRESS" });
  });

  it("issueLabels — 404 when BPR does not exist", async () => {
    await expect(
      issueLabels(
        "00000000-0000-0000-0000-000000000000",
        activeSpoolId,
        10,
        adminId,
        "req-issue-bpr-missing",
        "POST /api/label-issuance",
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("issueLabels — 409 SPOOL_NOT_ACTIVE when spool is DISPOSED", async () => {
    await expect(
      issueLabels(
        bprId,
        disposedSpoolId,
        10,
        adminId,
        "req-issue-spool-inactive",
        "POST /api/label-issuance",
      ),
    ).rejects.toMatchObject({ status: 409, code: "SPOOL_NOT_ACTIVE" });
  });

  it("issueLabels — 409 INSUFFICIENT_SPOOL_QTY when qty exceeds spool qty; transaction rolls back", async () => {
    // First check spool qty before the call
    const [spoolBefore] = await db
      .select()
      .from(schema.labelSpools)
      .where(eq(schema.labelSpools.id, activeSpoolId));
    const qtyBefore = spoolBefore!.qtyOnHand;

    await expect(
      issueLabels(
        bprId,
        activeSpoolId,
        99999, // way more than available
        adminId,
        "req-issue-insufficient",
        "POST /api/label-issuance",
      ),
    ).rejects.toMatchObject({ status: 409, code: "INSUFFICIENT_SPOOL_QTY" });

    // Verify spool qty was NOT changed (transaction rolled back)
    const [spoolAfter] = await db
      .select()
      .from(schema.labelSpools)
      .where(eq(schema.labelSpools.id, activeSpoolId));
    expect(spoolAfter!.qtyOnHand).toBe(qtyBefore);
  });

  // ─── recordPrintJob ────────────────────────────────────────────────────────────

  it("recordPrintJob — happy path: inserts print job with F-04 sig, writes LABEL_PRINTED audit", async () => {
    // Create an issuance to attach print job to
    const issuance = await issueLabels(
      bprId,
      activeSpoolId,
      20,
      adminId,
      "req-issue-for-print",
      "POST /api/label-issuance",
    );
    createdIssuanceIds.push(issuance.id);

    const printInput: RecordPrintJobInput = {
      issuanceLogId: issuance.id,
      lot: "LOT-2025-001",
      expiry: new Date("2026-12-31"),
      qtyPrinted: 20,
      adapter: "STUB",
      adapterResult: {
        status: "SUCCESS",
        qtyPrinted: 20,
        diagnostics: { printTime: 1234 },
      },
    };

    const printJob = await recordPrintJob(
      printInput,
      qaId,
      VALID_PASSWORD,
      "req-print-1",
      "POST /api/label-print-jobs",
    );

    expect(printJob.issuanceLogId).toBe(issuance.id);
    expect(printJob.lot).toBe("LOT-2025-001");
    expect(printJob.qtyPrinted).toBe(20);
    expect(printJob.adapter).toBe("STUB");
    expect(printJob.status).toBe("SUCCESS");
    expect(printJob.signatureId).toBeTruthy();
    expect(printJob.resultJson).toMatchObject({ status: "SUCCESS", qtyPrinted: 20 });

    // Verify audit row
    const audits = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, printJob.id));
    expect(audits.some((a) => a.action === "LABEL_PRINTED")).toBe(true);

    // Verify F-04 signature row
    const sigs = await db
      .select()
      .from(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, printJob.id));
    expect(sigs.some((s) => s.meaning === "LABEL_PRINT_BATCH")).toBe(true);
  });

  it("recordPrintJob — 401 UNAUTHENTICATED when password is wrong", async () => {
    const issuance = await issueLabels(
      bprId,
      activeSpoolId,
      5,
      adminId,
      "req-issue-for-print-fail",
      "POST /api/label-issuance",
    );
    createdIssuanceIds.push(issuance.id);

    const printInput: RecordPrintJobInput = {
      issuanceLogId: issuance.id,
      lot: "LOT-FAIL",
      expiry: new Date("2026-12-31"),
      qtyPrinted: 5,
      adapter: "STUB",
      adapterResult: {
        status: "SUCCESS",
        qtyPrinted: 5,
        diagnostics: {},
      },
    };

    await expect(
      recordPrintJob(
        printInput,
        qaId,
        "WRONG_PASSWORD",
        "req-print-fail",
        "POST /api/label-print-jobs",
      ),
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });

  // ─── listIssuanceForBpr ────────────────────────────────────────────────────────

  it("listIssuanceForBpr — returns issuance rows with nested print jobs", async () => {
    // Issue labels and then record a print job
    const issuance = await issueLabels(
      bprId,
      activeSpoolId,
      15,
      adminId,
      "req-issue-list-test",
      "POST /api/label-issuance",
    );
    createdIssuanceIds.push(issuance.id);

    const printInput: RecordPrintJobInput = {
      issuanceLogId: issuance.id,
      lot: "LOT-LIST-001",
      expiry: new Date("2026-12-31"),
      qtyPrinted: 15,
      adapter: "STUB",
      adapterResult: {
        status: "SUCCESS",
        qtyPrinted: 15,
        diagnostics: {},
      },
    };
    await recordPrintJob(
      printInput,
      qaId,
      VALID_PASSWORD,
      "req-print-list-test",
      "POST /api/label-print-jobs",
    );

    const results = await listIssuanceForBpr(bprId);
    expect(results.length).toBeGreaterThan(0);

    // Find our issuance
    const our = results.find((r) => r.issuance.id === issuance.id);
    expect(our).toBeDefined();
    expect(our!.issuance.quantityIssued).toBe(15);
    expect(our!.printJobs.length).toBeGreaterThan(0);
    expect(our!.printJobs[0]!.lot).toBe("LOT-LIST-001");
  });

  it("listIssuanceForBpr — returns empty array for unknown BPR", async () => {
    const results = await listIssuanceForBpr("00000000-0000-0000-0000-000000000000");
    expect(results).toEqual([]);
  });

  it("listIssuanceForBpr — issuance rows with no print jobs have empty printJobs array", async () => {
    // Issue labels without recording a print job
    const issuance = await issueLabels(
      bprId,
      activeSpoolId,
      8,
      adminId,
      "req-issue-no-print",
      "POST /api/label-issuance",
    );
    createdIssuanceIds.push(issuance.id);

    const results = await listIssuanceForBpr(bprId);
    const our = results.find((r) => r.issuance.id === issuance.id);
    expect(our).toBeDefined();
    expect(our!.printJobs).toEqual([]);
  });

  // ─── sumIssuedForBpr ──────────────────────────────────────────────────────────

  it("sumIssuedForBpr — sums quantity_issued across all issuance rows for a BPR", async () => {
    // Get current sum before adding more
    const sumBefore = await sumIssuedForBpr(bprId);

    // Issue more labels
    const issuance = await issueLabels(
      bprId,
      activeSpoolId,
      25,
      adminId,
      "req-issue-sum-test",
      "POST /api/label-issuance",
    );
    createdIssuanceIds.push(issuance.id);

    const sumAfter = await sumIssuedForBpr(bprId);
    expect(sumAfter).toBe(sumBefore + 25);
  });

  it("sumIssuedForBpr — returns 0 for unknown BPR", async () => {
    const sum = await sumIssuedForBpr("00000000-0000-0000-0000-000000000000");
    expect(sum).toBe(0);
  });
});
