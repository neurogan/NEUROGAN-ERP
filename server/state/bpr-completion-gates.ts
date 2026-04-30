// R-04 Task 8 — BPR completion gates.
//
// Pure-function gate logic that runs before a Batch Production Record is
// allowed to transition to COMPLETE status. Each gate checks one constraint
// and throws a structured CompletionGateError (HTTP 409) on the FIRST failure
// encountered; the orchestrator does not aggregate failures across gates.
//
// Gate order (deterministic, codified for predictable error UX):
//   1. LABEL_RECONCILIATION_MISSING         — no reconciliation row exists for this BPR
//   2. LABEL_RECONCILIATION_OUT_OF_TOLERANCE_NO_DEVIATION
//                                           — reconciliation shows out-of-tolerance
//                                             variance but no deviation report is linked
//
// Order rationale: Existence check first (cheapest). Consistency check second —
// only meaningful if a reconciliation row exists; the explicit ordering lets
// Gate 1 catch the no-row case cleanly even though Gate 2 would also no-op
// when the row is absent.

import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import { getReconciliationForBpr } from "../storage/label-reconciliations";

// ─── Error class ─────────────────────────────────────────────────────────────

export type CompletionGateCode =
  | "LABEL_RECONCILIATION_MISSING"
  | "LABEL_RECONCILIATION_OUT_OF_TOLERANCE_NO_DEVIATION"
  | "CLEANING_LOG_MISSING";

export interface CompletionGatePayload {
  bprId: string;
  variance?: number;
}

export class CompletionGateError extends Error {
  readonly status = 409 as const;
  readonly code: CompletionGateCode;
  readonly payload: CompletionGatePayload;

  constructor(
    code: CompletionGateCode,
    message: string,
    payload: CompletionGatePayload,
  ) {
    super(message);
    this.name = "CompletionGateError";
    this.code = code;
    this.payload = payload;
  }

  static is(e: unknown): e is CompletionGateError {
    return e instanceof CompletionGateError;
  }
}

// ─── Gates ───────────────────────────────────────────────────────────────────

// Gate 1: A label reconciliation record must exist before a BPR can complete.
function requireReconciliation(
  bprId: string,
  recon: Awaited<ReturnType<typeof getReconciliationForBpr>>,
): void {
  if (!recon) {
    throw new CompletionGateError(
      "LABEL_RECONCILIATION_MISSING",
      "Label reconciliation is required before BPR can be completed.",
      { bprId },
    );
  }
}

// Gate 2: If tolerance was exceeded, a deviation report must be linked.
function requireToleranceDeviationConsistency(
  bprId: string,
  recon: Awaited<ReturnType<typeof getReconciliationForBpr>>,
): void {
  if (recon && recon.toleranceExceeded && !recon.deviationId) {
    throw new CompletionGateError(
      "LABEL_RECONCILIATION_OUT_OF_TOLERANCE_NO_DEVIATION",
      "Label reconciliation shows out-of-tolerance variance. A deviation report is required.",
      { bprId, variance: recon.variance },
    );
  }
}

// Gate 3: A cleaning log must be linked before a BPR can complete.
async function requireCleaningLog(bprId: string): Promise<void> {
  const [row] = await db
    .select({ cleaningLogId: schema.batchProductionRecords.cleaningLogId })
    .from(schema.batchProductionRecords)
    .where(eq(schema.batchProductionRecords.id, bprId))
    .limit(1);
  if (!row?.cleaningLogId) {
    throw new CompletionGateError(
      "CLEANING_LOG_MISSING",
      "A cleaning log must be linked before this BPR can be submitted for review.",
      { bprId },
    );
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

// runCompletionGates runs all completion gates in order, throwing on the first
// failure. Call this before allowing a BPR to transition to COMPLETED status.
export async function runCompletionGates(bprId: string): Promise<void> {
  const recon = await getReconciliationForBpr(bprId);
  requireReconciliation(bprId, recon);
  requireToleranceDeviationConsistency(bprId, recon);
  await requireCleaningLog(bprId);
}
