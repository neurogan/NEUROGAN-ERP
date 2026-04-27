// R-03 Task 8 — BPR start gates.
//
// Pure-function gate logic that runs before a Batch Production Record is
// allowed to transition into IN_PROGRESS. Each gate checks one constraint and
// throws a structured GateError (HTTP 409) on the FIRST failure encountered;
// the orchestrator does not aggregate failures across gates because the user
// experience we want is "fix the most blocking thing first".
//
// Gate order (deterministic, codified for predictable error UX):
//   1. EQUIPMENT_LIST_EMPTY    — short-circuits before any DB query
//   2. CALIBRATION_OVERDUE     — any equipment whose nextDueAt is in the past
//   3. EQUIPMENT_NOT_QUALIFIED — any equipment missing an active IQ/OQ/PQ
//   4. LINE_CLEARANCE_MISSING  — equipment used on a different product's APPROVED
//                                BPR with no line clearance since.
//
// Each error carries `payload.equipment: [{ assetTag, ...context }]` per
// failing piece of equipment so the frontend (Task 15) can render actionable
// per-row messages.

import * as schema from "@shared/schema";
import { eq, and, lt, desc, inArray } from "drizzle-orm";
import { getActiveQualifiedTypes } from "../storage/equipment";
import { findClearance } from "../storage/cleaning-line-clearance";
import { db as defaultDb } from "../db";

// DbLike covers both the default db handle and a Drizzle transaction object —
// either is acceptable, since Drizzle's tx type is structurally compatible
// with the top-level db. The gate logic itself does not start a transaction.
export type DbLike = typeof defaultDb;

const REQUIRED_TYPES: Array<"IQ" | "OQ" | "PQ"> = ["IQ", "OQ", "PQ"];

export class GateError extends Error {
  readonly status = 409;
  readonly code: string;
  readonly payload: { equipment: Array<Record<string, unknown>> } | Record<string, unknown>;
  constructor(
    code: string,
    message: string,
    payload: { equipment: Array<Record<string, unknown>> } | Record<string, unknown>,
  ) {
    super(message);
    this.name = "GateError";
    this.code = code;
    this.payload = payload;
  }
}

export async function runAllGates(
  db: DbLike,
  productionBatchId: string,
  productId: string,
  equipmentIds: string[],
): Promise<void> {
  // Gate 1: list-empty short-circuit. Must run before any DB query because
  // drizzle's `inArray(col, [])` produces malformed SQL on some dialects, and
  // because "no equipment selected" deserves a sharper error than the empty
  // result it would otherwise produce.
  if (equipmentIds.length === 0) {
    throw new GateError("EQUIPMENT_LIST_EMPTY", "Equipment list is empty", {
      equipment: [],
    });
  }

  // Resolve equipment rows once for assetTag lookup so each gate can populate
  // its payload without re-querying. assetTag is the human-friendly identifier
  // operators see in the UI, so every error carries it.
  const equipmentRows = await db
    .select()
    .from(schema.equipment)
    .where(inArray(schema.equipment.id, equipmentIds));
  const tagById = new Map(equipmentRows.map((r) => [r.id, r.assetTag]));

  await checkCalibration(db, equipmentIds, tagById);
  await checkQualification(equipmentIds, tagById);
  await checkLineClearance(db, productionBatchId, productId, equipmentIds, tagById);
}

async function checkCalibration(
  db: DbLike,
  equipmentIds: string[],
  tagById: Map<string, string>,
): Promise<void> {
  const overdue = await db
    .select()
    .from(schema.calibrationSchedules)
    .where(
      and(
        inArray(schema.calibrationSchedules.equipmentId, equipmentIds),
        lt(schema.calibrationSchedules.nextDueAt, new Date()),
      ),
    );
  if (overdue.length > 0) {
    throw new GateError("CALIBRATION_OVERDUE", "Calibration overdue", {
      equipment: overdue.map((o) => ({
        equipmentId: o.equipmentId,
        assetTag: tagById.get(o.equipmentId) ?? null,
        dueAt: o.nextDueAt,
      })),
    });
  }
}

async function checkQualification(
  equipmentIds: string[],
  tagById: Map<string, string>,
): Promise<void> {
  // getActiveQualifiedTypes does its own latest-wins-per-type evaluation and
  // returns a Set of currently-active types. We loop one equipment at a time
  // (N is small — typically 1-3 pieces of equipment per BPR).
  const failures: Array<{
    equipmentId: string;
    assetTag: string | null;
    missingTypes: Array<"IQ" | "OQ" | "PQ">;
  }> = [];
  for (const id of equipmentIds) {
    const active = await getActiveQualifiedTypes(id);
    const missing = REQUIRED_TYPES.filter((t) => !active.has(t));
    if (missing.length > 0) {
      failures.push({
        equipmentId: id,
        assetTag: tagById.get(id) ?? null,
        missingTypes: missing,
      });
    }
  }
  if (failures.length > 0) {
    throw new GateError("EQUIPMENT_NOT_QUALIFIED", "Equipment not qualified", {
      equipment: failures,
    });
  }
}

async function checkLineClearance(
  db: DbLike,
  productionBatchId: string,
  productId: string,
  equipmentIds: string[],
  tagById: Map<string, string>,
): Promise<void> {
  const failures: Array<{
    equipmentId: string;
    assetTag: string | null;
    fromProductId: string;
    toProductId: string;
  }> = [];

  for (const id of equipmentIds) {
    // Find the most recent APPROVED BPR for this equipment (excluding the
    // current batch — a self-reference can't be a "prior product change").
    const prior = await db
      .select({
        productId: schema.batchProductionRecords.productId,
        completedAt: schema.batchProductionRecords.completedAt,
        productionBatchId: schema.batchProductionRecords.productionBatchId,
      })
      .from(schema.batchProductionRecords)
      .innerJoin(
        schema.productionBatchEquipmentUsed,
        eq(
          schema.productionBatchEquipmentUsed.productionBatchId,
          schema.batchProductionRecords.productionBatchId,
        ),
      )
      .where(
        and(
          eq(schema.productionBatchEquipmentUsed.equipmentId, id),
          eq(schema.batchProductionRecords.status, "APPROVED"),
        ),
      )
      .orderBy(desc(schema.batchProductionRecords.completedAt))
      .limit(5);

    // Skip self (the batch we're currently starting) — only relevant if a
    // caller passes our own batch id, which shouldn't happen pre-IN_PROGRESS,
    // but guard defensively.
    const priorOther = prior.find((p) => p.productionBatchId !== productionBatchId);
    if (!priorOther) continue; // first batch on this equipment, no clearance required

    const priorProduct = priorOther.productId;
    const priorCompleted = priorOther.completedAt;
    if (priorProduct === productId) continue; // same SKU, no changeover, no clearance
    if (!priorCompleted) continue; // missing timestamp — can't anchor a "since" check

    const clearance = await findClearance(id, productId, priorCompleted);
    if (!clearance) {
      failures.push({
        equipmentId: id,
        assetTag: tagById.get(id) ?? null,
        fromProductId: priorProduct,
        toProductId: productId,
      });
    }
  }

  if (failures.length > 0) {
    throw new GateError(
      "LINE_CLEARANCE_MISSING",
      "Line clearance missing for product change",
      { equipment: failures },
    );
  }
}
