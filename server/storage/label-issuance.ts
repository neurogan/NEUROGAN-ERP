// R-04 Label Issuance storage layer.
//
// issueLabels      — BPR↔spool check-out inside a Drizzle transaction.
//                    Verifies BPR is IN_PROGRESS and spool is ACTIVE,
//                    calls decrementSpoolQty, inserts erp_label_issuance_log,
//                    writes LABEL_ISSUED audit row.
//
// recordPrintJob   — F-04 inline ceremony (LABEL_PRINT_BATCH), inserts
//                    erp_label_print_jobs using an already-resolved PrintResult.
//                    Does NOT call the print adapter itself.
//
// listIssuanceForBpr — Returns { issuance, printJobs[] } for each issuance row
//                      on a BPR. Two queries + in-memory join.
//
// sumIssuedForBpr  — Returns sum of quantity_issued for a BPR (used by Task 7).

import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, inArray, sum as dbSum } from "drizzle-orm";
import { storage } from "../storage";
import { verifyPassword } from "../auth/password";
import { MEANING_VERB } from "../signatures/signatures";
import { decrementSpoolQty } from "./label-spools";
import type { PrintResult } from "../printing/adapter";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecordPrintJobInput {
  issuanceLogId: string;
  lot: string;
  expiry: Date;
  qtyPrinted: number;
  adapter: "ZPL_TCP" | "STUB";
  adapterResult: PrintResult;
}

export interface IssuanceWithPrintJobs {
  issuance: schema.LabelIssuanceLog;
  printJobs: schema.LabelPrintJob[];
}

// ─── issueLabels ──────────────────────────────────────────────────────────────
//
// Opens a Drizzle transaction, verifies BPR is IN_PROGRESS and spool is ACTIVE,
// calls decrementSpoolQty, inserts issuance log, writes LABEL_ISSUED audit row.

export async function issueLabels(
  bprId: string,
  spoolId: string,
  qty: number,
  userId: string,
  requestId: string,
  route: string,
): Promise<schema.LabelIssuanceLog> {
  // Pre-flight: verify BPR exists and is IN_PROGRESS.
  const [bpr] = await db
    .select()
    .from(schema.batchProductionRecords)
    .where(eq(schema.batchProductionRecords.id, bprId));

  if (!bpr) {
    throw Object.assign(new Error("BPR not found"), { status: 404 });
  }
  if (bpr.status !== "IN_PROGRESS") {
    throw Object.assign(
      new Error(`BPR is not in IN_PROGRESS state (current: ${bpr.status})`),
      { status: 409, code: "BPR_NOT_IN_PROGRESS" },
    );
  }

  // Pre-flight: verify spool exists and is ACTIVE (checked BEFORE decrementSpoolQty).
  const [spool] = await db
    .select()
    .from(schema.labelSpools)
    .where(eq(schema.labelSpools.id, spoolId));

  if (!spool) {
    throw Object.assign(new Error("Label spool not found"), { status: 404 });
  }
  if (spool.status !== "ACTIVE") {
    throw Object.assign(
      new Error(`Spool is not in ACTIVE state (current: ${spool.status})`),
      { status: 409, code: "SPOOL_NOT_ACTIVE" },
    );
  }

  return await db.transaction(async (tx) => {
    // 1. Decrement spool qty (throws 409 INSUFFICIENT_SPOOL_QTY if not enough).
    //    The returned spool row has the updated artworkId we need.
    const updatedSpool = await decrementSpoolQty(spoolId, qty, tx);

    // 2. Insert issuance log row.
    const [issuanceRow] = await tx
      .insert(schema.labelIssuanceLog)
      .values({
        bprId,
        spoolId,
        artworkId: updatedSpool.artworkId,
        quantityIssued: qty,
        issuedByUserId: userId,
      })
      .returning();

    // 3. Write LABEL_ISSUED audit row.
    await tx.insert(schema.auditTrail).values({
      userId,
      action: "LABEL_ISSUED",
      entityType: "label_issuance_log",
      entityId: issuanceRow!.id,
      before: null,
      after: {
        bprId,
        spoolId,
        artworkId: updatedSpool.artworkId,
        quantityIssued: qty,
        issuedByUserId: userId,
      },
      requestId,
      route,
    });

    return issuanceRow!;
  });
}

// ─── recordPrintJob ───────────────────────────────────────────────────────────
//
// F-04 inline ceremony (LABEL_PRINT_BATCH). Inserts erp_label_print_jobs using
// input.adapterResult — does NOT call the adapter.

export async function recordPrintJob(
  input: RecordPrintJobInput,
  userId: string,
  password: string,
  requestId: string,
  route: string,
): Promise<schema.LabelPrintJob> {
  // F-04 inline ceremony — verify password outside the transaction.
  const fullUser = await storage.getUserByEmail(
    await storage.getUserById(userId).then((u) => {
      if (!u) throw Object.assign(new Error("User not found"), { status: 404 });
      return u.email;
    }),
  );
  if (!fullUser) throw Object.assign(new Error("User not found"), { status: 404 });
  if (fullUser.lockedUntil && fullUser.lockedUntil > new Date()) {
    throw Object.assign(
      new Error("Account temporarily locked due to too many failed attempts."),
      { status: 423, code: "ACCOUNT_LOCKED" },
    );
  }
  const valid = await verifyPassword(fullUser.passwordHash, password);
  if (!valid) {
    await storage.recordFailedLogin(fullUser.id);
    throw Object.assign(new Error("Password is incorrect."), {
      status: 401,
      code: "UNAUTHENTICATED",
    });
  }
  await storage.recordSuccessfulLogin(fullUser.id);

  const signedAt = new Date();
  const titlePart = fullUser.title ? ` (${fullUser.title})` : "";
  const manifestation = {
    text: `I, ${fullUser.fullName}${titlePart}, hereby ${MEANING_VERB.LABEL_PRINT_BATCH} this record on ${signedAt.toISOString()}.`,
    fullName: fullUser.fullName,
    title: fullUser.title ?? null,
    meaning: "LABEL_PRINT_BATCH" as const,
    entityType: "label_print_job",
    signedAt: signedAt.toISOString(),
    snapshot: {
      issuanceLogId: input.issuanceLogId,
      lot: input.lot,
      qtyPrinted: input.qtyPrinted,
      adapter: input.adapter,
      status: input.adapterResult.status,
    },
  };

  return await db.transaction(async (tx) => {
    // 1. Insert print job row first (we need its ID for the signature).
    const [printJobRow] = await tx
      .insert(schema.labelPrintJobs)
      .values({
        issuanceLogId: input.issuanceLogId,
        lot: input.lot,
        expiry: input.expiry.toISOString().split("T")[0]!, // date column expects YYYY-MM-DD
        qtyPrinted: input.qtyPrinted,
        adapter: input.adapter,
        status: input.adapterResult.status,
        resultJson: input.adapterResult as unknown as Record<string, unknown>,
      })
      .returning();

    const printJobId = printJobRow!.id;

    // 2. Insert signature row (LABEL_PRINT_BATCH meaning).
    const [sigRow] = await tx
      .insert(schema.electronicSignatures)
      .values({
        userId: fullUser.id,
        meaning: "LABEL_PRINT_BATCH",
        entityType: "label_print_job",
        entityId: printJobId,
        commentary: null,
        fullNameAtSigning: fullUser.fullName,
        titleAtSigning: fullUser.title ?? null,
        requestId,
        manifestationJson: { ...manifestation, entityId: printJobId } as Record<string, unknown>,
      })
      .returning();

    // 3. UPDATE print job to attach the signature ID.
    const [updated] = await tx
      .update(schema.labelPrintJobs)
      .set({ signatureId: sigRow!.id })
      .where(eq(schema.labelPrintJobs.id, printJobId))
      .returning();

    // 4. SIGN audit row.
    await tx.insert(schema.auditTrail).values({
      userId: fullUser.id,
      action: "SIGN",
      entityType: "label_print_job",
      entityId: printJobId,
      before: null,
      after: { printJobId, status: input.adapterResult.status },
      route,
      requestId,
      meta: { signatureId: sigRow!.id, meaning: "LABEL_PRINT_BATCH" },
    });

    // 5. Domain audit row.
    await tx.insert(schema.auditTrail).values({
      userId,
      action: "LABEL_PRINTED",
      entityType: "label_print_job",
      entityId: printJobId,
      before: null,
      after: {
        issuanceLogId: input.issuanceLogId,
        lot: input.lot,
        qtyPrinted: input.qtyPrinted,
        adapter: input.adapter,
        status: input.adapterResult.status,
        signatureId: sigRow!.id,
      },
      requestId,
      route,
    });

    return updated!;
  });
}

// ─── listIssuanceForBpr ───────────────────────────────────────────────────────
//
// Two queries: one for issuance rows, one for print jobs where issuanceLogId IN
// (issuance row IDs). Combined in-memory.

export async function listIssuanceForBpr(bprId: string): Promise<IssuanceWithPrintJobs[]> {
  const issuances = await db
    .select()
    .from(schema.labelIssuanceLog)
    .where(eq(schema.labelIssuanceLog.bprId, bprId));

  if (issuances.length === 0) return [];

  const issuanceIds = issuances.map((r) => r.id);

  const printJobs = await db
    .select()
    .from(schema.labelPrintJobs)
    .where(inArray(schema.labelPrintJobs.issuanceLogId, issuanceIds));

  // Group print jobs by issuanceLogId.
  const printJobsByIssuance = new Map<string, schema.LabelPrintJob[]>();
  for (const job of printJobs) {
    const list = printJobsByIssuance.get(job.issuanceLogId) ?? [];
    list.push(job);
    printJobsByIssuance.set(job.issuanceLogId, list);
  }

  return issuances.map((issuance) => ({
    issuance,
    printJobs: printJobsByIssuance.get(issuance.id) ?? [],
  }));
}

// ─── sumIssuedForBpr ──────────────────────────────────────────────────────────
//
// Returns the sum of quantity_issued for a given BPR as a number.
// Used by the reconciliation module (Task 7).

export async function sumIssuedForBpr(bprId: string): Promise<number> {
  const [result] = await db
    .select({ total: dbSum(schema.labelIssuanceLog.quantityIssued) })
    .from(schema.labelIssuanceLog)
    .where(eq(schema.labelIssuanceLog.bprId, bprId));

  // dbSum returns a string | null in drizzle-orm
  const raw = result?.total;
  if (raw === null || raw === undefined) return 0;
  return Number(raw);
}
