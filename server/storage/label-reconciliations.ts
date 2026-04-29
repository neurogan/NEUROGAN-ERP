// R-04 Label Reconciliation storage layer.
//
// reconcileBpr   — F-04 inline ceremony (LABEL_RECONCILED) with variance + tolerance gate.
//                  Pre-flight: no existing reconciliation for bprId (409 ALREADY_RECONCILED).
//                  Computes variance = qtyIssued - qtyApplied - qtyDestroyed - qtyReturned.
//                  If Math.abs(variance) > toleranceAbs AND no deviationId → 409 TOLERANCE_EXCEEDED.
//                  Inserts reconciliation row + signature + audit rows atomically.
//
// getReconciliationForBpr — Simple select by bprId.

import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { storage } from "../storage";
import { verifyPassword } from "../auth/password";
import { MEANING_VERB } from "../signatures/signatures";
import { sumIssuedForBpr } from "./label-issuance";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReconcileInput {
  bprId: string;
  qtyApplied: number;
  qtyReturned: number;
  qtyDestroyed: number;
  deviationId?: string | null;
  proofFileData?: string | null;
  proofMimeType?: string | null;
}

// ─── reconcileBpr ─────────────────────────────────────────────────────────────
//
// F-04 inline ceremony (LABEL_RECONCILED) with variance + tolerance gate.

export async function reconcileBpr(
  input: ReconcileInput,
  userId: string,
  password: string,
  requestId: string,
  route: string,
): Promise<schema.LabelReconciliation> {
  // 1. Pre-flight: check no existing reconciliation for bprId.
  const [existing] = await db
    .select()
    .from(schema.labelReconciliations)
    .where(eq(schema.labelReconciliations.bprId, input.bprId));

  if (existing) {
    throw Object.assign(
      new Error("A reconciliation already exists for this BPR."),
      { status: 409, code: "ALREADY_RECONCILED" },
    );
  }

  // 2. Get qtyIssued from issuance log.
  const qtyIssued = await sumIssuedForBpr(input.bprId);

  // 3. Get tolerance from appSettingsKv (key 'labelToleranceAbs'), default 5.
  const [toleranceRow] = await db
    .select()
    .from(schema.appSettingsKv)
    .where(eq(schema.appSettingsKv.key, "labelToleranceAbs"));
  const toleranceAbs = toleranceRow ? parseInt(toleranceRow.value, 10) : 5;

  // 4. Compute variance = qtyIssued - qtyApplied - qtyDestroyed - qtyReturned.
  const variance = qtyIssued - input.qtyApplied - input.qtyDestroyed - input.qtyReturned;

  // 5. Determine if tolerance exceeded.
  const toleranceExceeded = Math.abs(variance) > toleranceAbs;

  // 6. If tolerance exceeded and no deviationId → 409.
  if (toleranceExceeded && !input.deviationId) {
    throw Object.assign(
      new Error(`Label reconciliation variance (${variance}) exceeds tolerance (±${toleranceAbs}) and no deviation has been provided.`),
      { status: 409, code: "TOLERANCE_EXCEEDED" },
    );
  }

  // 7. F-04 inline ceremony — verify password outside the transaction.
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
    text: `I, ${fullUser.fullName}${titlePart}, hereby ${MEANING_VERB.LABEL_RECONCILED} this record on ${signedAt.toISOString()}.`,
    fullName: fullUser.fullName,
    title: fullUser.title ?? null,
    meaning: "LABEL_RECONCILED" as const,
    entityType: "label_reconciliation",
    signedAt: signedAt.toISOString(),
    snapshot: {
      bprId: input.bprId,
      qtyIssued,
      qtyApplied: input.qtyApplied,
      qtyReturned: input.qtyReturned,
      qtyDestroyed: input.qtyDestroyed,
      variance,
      toleranceExceeded,
    },
  };

  return await db.transaction(async (tx) => {
    // 8a. Insert reconciliation row (without signatureId yet).
    const [reconRow] = await tx
      .insert(schema.labelReconciliations)
      .values({
        bprId: input.bprId,
        qtyIssued,
        qtyApplied: input.qtyApplied,
        qtyReturned: input.qtyReturned,
        qtyDestroyed: input.qtyDestroyed,
        variance,
        toleranceExceeded,
        deviationId: input.deviationId ?? null,
        proofFileData: input.proofFileData ?? null,
        proofMimeType: input.proofMimeType ?? null,
      })
      .returning();

    const reconId = reconRow!.id;

    // 8b. Insert signature row with reconId as entityId.
    const [sigRow] = await tx
      .insert(schema.electronicSignatures)
      .values({
        userId: fullUser.id,
        meaning: "LABEL_RECONCILED",
        entityType: "label_reconciliation",
        entityId: reconId,
        commentary: null,
        fullNameAtSigning: fullUser.fullName,
        titleAtSigning: fullUser.title ?? null,
        requestId,
        manifestationJson: { ...manifestation, entityId: reconId } as Record<string, unknown>,
      })
      .returning();

    // 8c. UPDATE reconciliation to attach signatureId.
    const [updated] = await tx
      .update(schema.labelReconciliations)
      .set({ signatureId: sigRow!.id })
      .where(eq(schema.labelReconciliations.id, reconId))
      .returning();

    // 9a. SIGN audit row.
    await tx.insert(schema.auditTrail).values({
      userId: fullUser.id,
      action: "SIGN",
      entityType: "label_reconciliation",
      entityId: reconId,
      before: null,
      after: { reconciliationId: reconId, bprId: input.bprId },
      route,
      requestId,
      meta: { signatureId: sigRow!.id, meaning: "LABEL_RECONCILED" },
    });

    // 9b. Domain audit row.
    await tx.insert(schema.auditTrail).values({
      userId,
      action: "LABEL_RECONCILED",
      entityType: "label_reconciliation",
      entityId: reconId,
      before: null,
      after: {
        bprId: input.bprId,
        qtyIssued,
        qtyApplied: input.qtyApplied,
        qtyReturned: input.qtyReturned,
        qtyDestroyed: input.qtyDestroyed,
        variance,
        toleranceExceeded,
        signatureId: sigRow!.id,
      },
      requestId,
      route,
    });

    return updated!;
  });
}

// ─── getReconciliationForBpr ──────────────────────────────────────────────────

export async function getReconciliationForBpr(
  bprId: string,
): Promise<schema.LabelReconciliation | undefined> {
  const [row] = await db
    .select()
    .from(schema.labelReconciliations)
    .where(eq(schema.labelReconciliations.bprId, bprId));
  return row;
}

export async function listOutOfToleranceReconciliations(): Promise<schema.LabelReconciliation[]> {
  return db
    .select()
    .from(schema.labelReconciliations)
    .where(and(
      eq(schema.labelReconciliations.toleranceExceeded, true),
      isNull(schema.labelReconciliations.deviationId),
    ));
}
