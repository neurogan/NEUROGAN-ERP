// F-03: Audit trail helpers.
//
// Two entry points:
//   withAudit<T>  — wraps a regulated DB write; writes the audit row in the
//                   SAME transaction so both succeed or neither does.
//   writeAuditRow — writes a standalone audit row (used for auth events:
//                   LOGIN, LOGIN_FAILED, LOGOUT where no data write is paired).

import { db, type Tx } from "../db";
import * as schema from "@shared/schema";
import type { AuditAction } from "@shared/schema";

export interface AuditContext {
  userId: string;
  action: AuditAction;
  entityType: string;
  /** Pass a function for CREATE actions where the id comes from the result. */
  entityId: string | null | ((result: unknown) => string | null);
  before: unknown;
  route: string | null;
  requestId: string | null;
  meta?: Record<string, unknown> | null;
}

// Wraps a regulated write in a Drizzle transaction and inserts the audit row
// atomically. The `fn` receives the active transaction so it can use the same
// connection; if the write or the audit insert fails the whole transaction rolls
// back and nothing is persisted.
export async function withAudit<T>(
  ctx: AuditContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const result = await fn(tx);
    const entityId =
      typeof ctx.entityId === "function"
        ? ctx.entityId(result)
        : ctx.entityId;
    await tx.insert(schema.auditTrail).values({
      userId: ctx.userId,
      action: ctx.action,
      entityType: ctx.entityType,
      entityId,
      before: ctx.before as Record<string, unknown> | null ?? null,
      after: result as Record<string, unknown> | null,
      route: ctx.route,
      requestId: ctx.requestId,
      meta: ctx.meta ?? null,
    });
    return result;
  });
}

// Standalone audit row for events that have no paired data write.
export async function writeAuditRow(
  ctx: Omit<AuditContext, "entityId" | "before"> & {
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await db.insert(schema.auditTrail).values({
    userId: ctx.userId,
    action: ctx.action,
    entityType: ctx.entityType,
    entityId: ctx.entityId ?? null,
    before: ctx.before as Record<string, unknown> | null ?? null,
    after: ctx.after as Record<string, unknown> | null ?? null,
    route: ctx.route,
    requestId: ctx.requestId,
    meta: ctx.meta ?? null,
  });
}
