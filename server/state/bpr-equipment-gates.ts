// R-03 Task 8 — BPR start gates.
//
// Gates run before a Batch Production Record is allowed to transition into
// IN_PROGRESS. Each gate checks one constraint and throws a structured
// GateError (HTTP 409) on the first failure.
//
// Active gates:
//   1. EQUIPMENT_LIST_EMPTY  — short-circuits before any DB query
//   2. CALIBRATION_OVERDUE   — any equipment whose nextDueAt is in the past
//
// Removed gates:
//   - EQUIPMENT_NOT_QUALIFIED (IQ/OQ/PQ): not required under 21 CFR Part 111.
//   - LINE_CLEARANCE_MISSING: cleaning and line clearance are required BPR
//     steps. The step-execution gate on submitBprForReview ensures they were
//     performed before a batch can be completed — making a separate start-time
//     check redundant.
//
// Each error carries `payload.equipment: [{ assetTag, ...context }]` per
// failing piece of equipment.

import * as schema from "@shared/schema";
import { and, lt, inArray } from "drizzle-orm";
import { db as defaultDb } from "../db";

// DbLike covers both the default db handle and a Drizzle transaction object —
// either is acceptable, since Drizzle's tx type is structurally compatible
// with the top-level db. The gate logic itself does not start a transaction.
export type DbLike = typeof defaultDb;

export interface GateFailureCalibration {
  equipmentId: string;
  assetTag: string | null;
  dueAt: Date;
}
export type GateFailure = GateFailureCalibration;

export type GateCode =
  | "EQUIPMENT_LIST_EMPTY"
  | "CALIBRATION_OVERDUE";

export interface GatePayload {
  equipment: GateFailure[];
}

export class GateError extends Error {
  readonly status = 409 as const;
  readonly code: GateCode;
  readonly payload: GatePayload;

  constructor(code: GateCode, message: string, payload: GatePayload) {
    super(message);
    this.name = "GateError";
    this.code = code;
    this.payload = payload;
  }

  static is(e: unknown): e is GateError {
    return e instanceof GateError;
  }
}

export async function runAllGates(
  db: DbLike,
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

