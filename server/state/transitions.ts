// F-05: State-machine definitions for regulated entities.
//
// Every status change on a regulated record MUST go through assertValidTransition()
// before the DB UPDATE. Role-checking happens at the route layer (requireRole);
// signature requirements are enforced by performSignature (F-04).
// This module is responsible only for the topology of the graph.
//
// 21 CFR Part 11 §11.10(a), 21 CFR §111.180.

import type { UserRole, SignatureMeaning } from "@shared/schema";
import { AppError } from "../errors";

export type LotStatus = "QUARANTINED" | "SAMPLING" | "PENDING_QC" | "APPROVED" | "REJECTED" | "ON_HOLD";
export type ReceivingStatus = "QUARANTINED" | "SAMPLING" | "PENDING_QC" | "APPROVED_PENDING_MOVE" | "APPROVED" | "REJECTED" | "ON_HOLD";
export type BprStatus = "IN_PROGRESS" | "PENDING_QC_REVIEW" | "APPROVED" | "REJECTED";

export interface Transition<TState extends string> {
  from: TState;
  to: TState;
  action: string;
  requiredRoles: UserRole[];
  requiredSignatureMeaning?: SignatureMeaning;
}

// Lot quarantine lifecycle (mirrors receiving_record.status).
export const lotTransitions: Transition<LotStatus>[] = [
  { from: "QUARANTINED",  to: "SAMPLING",    action: "BEGIN_SAMPLING",      requiredRoles: ["QA", "WAREHOUSE", "LAB_TECH"] },
  { from: "QUARANTINED",  to: "PENDING_QC",  action: "SKIP_TO_PENDING_QC",  requiredRoles: ["QA", "WAREHOUSE", "ADMIN"] },
  { from: "SAMPLING",     to: "PENDING_QC",  action: "SAMPLING_COMPLETE",   requiredRoles: ["QA", "WAREHOUSE", "LAB_TECH"] },
  { from: "PENDING_QC",   to: "APPROVED",    action: "QC_APPROVE",          requiredRoles: ["QA"], requiredSignatureMeaning: "QC_DISPOSITION" },
  { from: "PENDING_QC",   to: "REJECTED",    action: "QC_REJECT",           requiredRoles: ["QA"], requiredSignatureMeaning: "QC_DISPOSITION" },
  { from: "PENDING_QC",   to: "ON_HOLD",     action: "QC_HOLD",             requiredRoles: ["QA"], requiredSignatureMeaning: "QC_DISPOSITION" },
  { from: "ON_HOLD",      to: "PENDING_QC",  action: "RELEASE_FROM_HOLD",   requiredRoles: ["QA"], requiredSignatureMeaning: "QC_DISPOSITION" },
  // APPROVED and REJECTED are terminal — no outbound transitions.
];

// Receiving records share most of the lot lifecycle, plus the WH-01 two-phase
// approval flow: PENDING_QC → APPROVED_PENDING_MOVE (QC sign-off) →
// RELEASED/APPROVED (warehouse confirms move).
// PENDING_QC → APPROVED is kept for backwards compatibility with existing data.
export const receivingTransitions: Transition<ReceivingStatus>[] = [
  ...lotTransitions as Transition<ReceivingStatus>[],
  { from: "PENDING_QC",            to: "APPROVED_PENDING_MOVE", action: "QC_APPROVE_PENDING_MOVE", requiredRoles: ["QA"], requiredSignatureMeaning: "QC_DISPOSITION" },
  { from: "APPROVED_PENDING_MOVE", to: "APPROVED",              action: "CONFIRM_LOCATION_MOVE",   requiredRoles: ["WAREHOUSE", "QA", "ADMIN"] },
];

// Batch Production Records.
export const bprTransitions: Transition<BprStatus>[] = [
  { from: "IN_PROGRESS",      to: "PENDING_QC_REVIEW", action: "SUBMIT_FOR_REVIEW", requiredRoles: ["QA", "PRODUCTION", "ADMIN"] },
  { from: "PENDING_QC_REVIEW", to: "APPROVED",         action: "QC_APPROVE",        requiredRoles: ["QA", "ADMIN"], requiredSignatureMeaning: "QC_DISPOSITION" },
  { from: "PENDING_QC_REVIEW", to: "REJECTED",         action: "QC_REJECT",         requiredRoles: ["QA", "ADMIN"], requiredSignatureMeaning: "QC_DISPOSITION" },
  // APPROVED and REJECTED are terminal.
];

const TRANSITION_GRAPH = {
  lot: lotTransitions,
  receiving_record: receivingTransitions,
  batch_production_record: bprTransitions,
} as const;

// Terminal (locked) statuses per entity type.
const LOCK_STATUSES: Record<string, string[]> = {
  lot: ["APPROVED", "REJECTED"],
  receiving_record: ["APPROVED", "REJECTED"],
  batch_production_record: ["APPROVED", "REJECTED"],
};

export function assertNotLocked(entityType: string, currentStatus: string): void {
  const locked = LOCK_STATUSES[entityType];
  if (locked && locked.includes(currentStatus)) {
    throw new AppError(
      "RECORD_LOCKED",
      `${entityType} is in a terminal state (${currentStatus}) and cannot be modified.`,
      423,
      { entityType, currentStatus },
    );
  }
}

// Validates that `from → to` is an allowed edge in the graph for this entity.
// Does NOT check roles (route layer) or signatures (performSignature).
// Throws ILLEGAL_TRANSITION (409) if the edge is not in the graph.
export function assertValidTransition(entityType: string, from: string, to: string): void {
  const graph = TRANSITION_GRAPH[entityType as keyof typeof TRANSITION_GRAPH];
  if (!graph) return; // entity not in the graph — allow for now

  const edge = graph.find((t) => t.from === from && t.to === to);
  if (!edge) {
    throw new AppError(
      "ILLEGAL_TRANSITION",
      `Cannot transition ${entityType} from ${from} to ${to}.`,
      409,
      { entityType, from, to },
    );
  }
}

// Returns the full transition definition for an (entity, action) pair,
// or undefined if the action is not valid from the current state.
export function findTransition(
  entityType: string,
  from: string,
  action: string,
): Transition<string> | undefined {
  const graph = TRANSITION_GRAPH[entityType as keyof typeof TRANSITION_GRAPH];
  if (!graph) return undefined;
  return graph.find((t) => t.from === from && t.action === action);
}
