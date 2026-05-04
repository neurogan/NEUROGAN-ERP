import { db } from "../db";
import type { Tx } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc, sql, asc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

function throwStatus(status: number, msg: string, code?: string): never {
  throw Object.assign(new Error(msg), { status, ...(code ? { code } : {}) });
}

// ─── Number generators ────────────────────────────────────────────────────────

async function nextNcNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `NC-${year}-`;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.nonconformances)
    .where(sql`${schema.nonconformances.ncNumber} LIKE ${prefix + "%"}`);
  const seq = (row?.count ?? 0) + 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

async function nextCapaNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CAPA-${year}-`;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.capas)
    .where(sql`${schema.capas.capaNumber} LIKE ${prefix + "%"}`);
  const seq = (row?.count ?? 0) + 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

async function nextMrNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `MR-${year}-`;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.managementReviews)
    .where(sql`${schema.managementReviews.reviewNumber} LIKE ${prefix + "%"}`);
  const seq = (row?.count ?? 0) + 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

// ─── Nonconformances ──────────────────────────────────────────────────────────

const ncCreator = alias(schema.users, "nc_creator");

export async function listNonconformances(filters?: {
  status?: schema.NcStatus;
  type?: schema.NcType;
  severity?: schema.NcSeverity;
}): Promise<schema.NonconformanceWithCapa[]> {
  const conditions = [];
  if (filters?.status) conditions.push(eq(schema.nonconformances.status, filters.status));
  if (filters?.type) conditions.push(eq(schema.nonconformances.type, filters.type));
  if (filters?.severity) conditions.push(eq(schema.nonconformances.severity, filters.severity));

  const ncs = await db
    .select({ nc: schema.nonconformances, createdByName: ncCreator.fullName })
    .from(schema.nonconformances)
    .innerJoin(ncCreator, eq(schema.nonconformances.createdByUserId, ncCreator.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.nonconformances.createdAt));

  if (ncs.length === 0) return [];

  const ncIds = ncs.map((r) => r.nc.id);
  const capaRows = await db
    .select()
    .from(schema.capas)
    .where(sql`${schema.capas.ncId} = ANY(ARRAY[${sql.join(ncIds.map((id) => sql`${id}::uuid`), sql`, `)}])`);

  const capaByNcId = new Map(capaRows.map((c) => [c.ncId, c]));

  return ncs.map((r) => ({
    ...r.nc,
    createdByName: r.createdByName,
    capa: capaByNcId.get(r.nc.id) ?? null,
  }));
}

export async function getNonconformance(id: string): Promise<schema.NonconformanceWithCapa> {
  const [row] = await db
    .select({ nc: schema.nonconformances, createdByName: ncCreator.fullName })
    .from(schema.nonconformances)
    .innerJoin(ncCreator, eq(schema.nonconformances.createdByUserId, ncCreator.id))
    .where(eq(schema.nonconformances.id, id));
  if (!row) throwStatus(404, "Nonconformance not found");

  const [capa] = await db.select().from(schema.capas).where(eq(schema.capas.ncId, id));

  return { ...row!.nc, createdByName: row!.createdByName, capa: capa ?? null };
}

export async function createNonconformance(input: {
  type: schema.NcType;
  severity: schema.NcSeverity;
  title: string;
  description?: string;
  sourceType?: string;
  sourceId?: string;
  createdByUserId: string;
  requestId?: string;
  route?: string;
}): Promise<schema.Nonconformance> {
  return db.transaction(async (tx) => {
    const ncNumber = await nextNcNumber();
    const [row] = await tx
      .insert(schema.nonconformances)
      .values({
        ncNumber,
        type: input.type,
        severity: input.severity,
        title: input.title,
        description: input.description ?? null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        createdByUserId: input.createdByUserId,
      })
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: input.createdByUserId,
      action: "NC_OPENED",
      entityType: "nonconformance",
      entityId: row!.id,
      before: null,
      after: { ncNumber, type: input.type, severity: input.severity, title: input.title },
      requestId: input.requestId ?? null,
      route: input.route ?? null,
    });

    return row!;
  });
}

export async function transitionNcStatus(input: {
  id: string;
  status: schema.NcStatus;
  userId: string;
  requestId?: string;
  route?: string;
}): Promise<schema.Nonconformance> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(schema.nonconformances).where(eq(schema.nonconformances.id, input.id));
    if (!existing) throwStatus(404, "Nonconformance not found");

    const [row] = await tx
      .update(schema.nonconformances)
      .set({ status: input.status, ...(input.status === "CLOSED" ? { closedAt: new Date() } : {}) })
      .where(eq(schema.nonconformances.id, input.id))
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: input.userId,
      action: "NC_STATUS_CHANGED",
      entityType: "nonconformance",
      entityId: input.id,
      before: { status: existing!.status },
      after: { status: input.status },
      requestId: input.requestId ?? null,
      route: input.route ?? null,
    });

    return row!;
  });
}

// ─── CAPAs ────────────────────────────────────────────────────────────────────

export async function listCapas(filters?: { status?: schema.CapaStatus }): Promise<schema.CapaWithDetails[]> {
  const capaRows = await db
    .select()
    .from(schema.capas)
    .where(filters?.status ? eq(schema.capas.status, filters.status) : undefined)
    .orderBy(desc(schema.capas.openedAt));

  if (capaRows.length === 0) return [];

  const capaIds = capaRows.map((c) => c.id);
  const ncIds = [...new Set(capaRows.map((c) => c.ncId))];
  const openerIds = [...new Set(capaRows.map((c) => c.openedByUserId))];

  const idList = (ids: string[]) =>
    sql`= ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}])`;

  const [actionRows, checkRows, ncRows, openerRows] = await Promise.all([
    db.select().from(schema.capaActions).where(sql`${schema.capaActions.capaId} ${idList(capaIds)}`),
    db.select().from(schema.capaEffectivenessChecks).where(sql`${schema.capaEffectivenessChecks.capaId} ${idList(capaIds)}`),
    db.select({ id: schema.nonconformances.id, ncNumber: schema.nonconformances.ncNumber }).from(schema.nonconformances).where(sql`${schema.nonconformances.id} ${idList(ncIds)}`),
    db.select({ id: schema.users.id, fullName: schema.users.fullName }).from(schema.users).where(sql`${schema.users.id} ${idList(openerIds)}`),
  ]);

  const actionsByCapaId = new Map<string, schema.CapaAction[]>();
  for (const a of actionRows) {
    const arr = actionsByCapaId.get(a.capaId) ?? [];
    arr.push(a);
    actionsByCapaId.set(a.capaId, arr);
  }

  const checksByCapaId = new Map<string, schema.CapaEffectivenessCheck[]>();
  for (const c of checkRows) {
    const arr = checksByCapaId.get(c.capaId) ?? [];
    arr.push(c);
    checksByCapaId.set(c.capaId, arr);
  }

  const ncNumberById = new Map(ncRows.map((n) => [n.id, n.ncNumber]));
  const openerNameById = new Map(openerRows.map((u) => [u.id, u.fullName]));

  return capaRows.map((c) => ({
    ...c,
    actions: actionsByCapaId.get(c.id) ?? [],
    effectivenessChecks: checksByCapaId.get(c.id) ?? [],
    ncNumber: ncNumberById.get(c.ncId) ?? "",
    openedByName: openerNameById.get(c.openedByUserId) ?? "",
    closedByName: null,
  }));
}

export async function getCapa(id: string): Promise<schema.CapaWithDetails> {
  const [capa] = await db.select().from(schema.capas).where(eq(schema.capas.id, id));
  if (!capa) throwStatus(404, "CAPA not found");

  const [actions, checks, nc, opener] = await Promise.all([
    db.select().from(schema.capaActions).where(eq(schema.capaActions.capaId, id)).orderBy(asc(schema.capaActions.createdAt)),
    db.select().from(schema.capaEffectivenessChecks).where(eq(schema.capaEffectivenessChecks.capaId, id)),
    db.select().from(schema.nonconformances).where(eq(schema.nonconformances.id, capa!.ncId)).then((r) => r[0]),
    db.select().from(schema.users).where(eq(schema.users.id, capa!.openedByUserId)).then((r) => r[0]),
  ]);

  return {
    ...capa!,
    actions,
    effectivenessChecks: checks,
    ncNumber: nc?.ncNumber ?? "",
    openedByName: opener?.fullName ?? "",
    closedByName: null,
  };
}

// Called inside performSignature callback — tx provided by the ceremony
export async function openCapaInTx(input: {
  ncId: string;
  capaType: schema.CapaType;
  rootCause: string;
  openedByUserId: string;
  requestId?: string;
  route?: string;
}, tx: Tx): Promise<schema.Capa> {
  const [nc] = await tx.select().from(schema.nonconformances).where(eq(schema.nonconformances.id, input.ncId));
  if (!nc) throwStatus(404, "Nonconformance not found");
  if (nc!.status === "CLOSED") throwStatus(409, "Cannot open CAPA on a closed NC");

  const [existing] = await tx.select().from(schema.capas).where(eq(schema.capas.ncId, input.ncId));
  if (existing) throwStatus(409, "A CAPA already exists for this NC");

  const capaNumber = await nextCapaNumber();
  const [row] = await tx
    .insert(schema.capas)
    .values({
      capaNumber,
      ncId: input.ncId,
      capaType: input.capaType,
      rootCause: input.rootCause,
      openedByUserId: input.openedByUserId,
    })
    .returning();

  await tx.update(schema.nonconformances).set({ status: "CAPA_OPEN" }).where(eq(schema.nonconformances.id, input.ncId));

  await tx.insert(schema.auditTrail).values({
    userId: input.openedByUserId,
    action: "CAPA_OPENED",
    entityType: "capa",
    entityId: row!.id,
    before: null,
    after: { capaNumber, ncId: input.ncId, capaType: input.capaType },
    requestId: input.requestId ?? null,
    route: input.route ?? null,
  });

  return row!;
}

export async function finalizeCapaOpen(capaId: string, signatureId: string): Promise<schema.Capa> {
  const [row] = await db.update(schema.capas).set({ openSignatureId: signatureId }).where(eq(schema.capas.id, capaId)).returning();
  return row!;
}

// Called inside performSignature callback — tx provided by the ceremony
export async function closeCapaInTx(input: {
  id: string;
  closedByUserId: string;
  requestId?: string;
  route?: string;
}, tx: Tx): Promise<schema.Capa> {
  const [capa] = await tx.select().from(schema.capas).where(eq(schema.capas.id, input.id));
  if (!capa) throwStatus(404, "CAPA not found");
  if (capa!.status === "CLOSED") throwStatus(409, "CAPA is already closed");

  const checks = await tx.select().from(schema.capaEffectivenessChecks).where(eq(schema.capaEffectivenessChecks.capaId, input.id));
  const completedCheck = checks.find((c) => c.result !== "PENDING" && c.performedAt);
  if (!completedCheck) throwStatus(422, "Cannot close CAPA: no completed effectiveness check");

  const actions = await tx.select().from(schema.capaActions).where(eq(schema.capaActions.capaId, input.id));
  const lastActionCompletedAt = actions
    .filter((a) => a.completedAt)
    .map((a) => a.completedAt!)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

  if (lastActionCompletedAt) {
    const daysDiff = (new Date(completedCheck.performedAt!).getTime() - new Date(lastActionCompletedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff < 30) throwStatus(422, "Effectiveness check must be performed at least 30 days after the last action was completed");
  }

  const now = new Date();
  const [row] = await tx
    .update(schema.capas)
    .set({ status: "CLOSED", closedAt: now, closedByUserId: input.closedByUserId })
    .where(eq(schema.capas.id, input.id))
    .returning();

  await tx.update(schema.nonconformances).set({ status: "CLOSED", closedAt: now }).where(eq(schema.nonconformances.id, capa!.ncId));

  await tx.insert(schema.auditTrail).values({
    userId: input.closedByUserId,
    action: "CAPA_CLOSED",
    entityType: "capa",
    entityId: input.id,
    before: { status: capa!.status },
    after: { status: "CLOSED", closedAt: now.toISOString() },
    requestId: input.requestId ?? null,
    route: input.route ?? null,
  });

  return row!;
}

export async function finalizeCapaClose(capaId: string, signatureId: string): Promise<schema.Capa> {
  const [row] = await db.update(schema.capas).set({ closeSignatureId: signatureId }).where(eq(schema.capas.id, capaId)).returning();
  return row!;
}

// ─── CAPA Actions ─────────────────────────────────────────────────────────────

export async function addCapaAction(input: {
  capaId: string;
  description: string;
  assignedToUserId?: string;
  dueAt?: string;
  createdByUserId: string;
  requestId?: string;
  route?: string;
}): Promise<schema.CapaAction> {
  return db.transaction(async (tx) => {
    const [capa] = await tx.select().from(schema.capas).where(eq(schema.capas.id, input.capaId));
    if (!capa) throwStatus(404, "CAPA not found");
    if (capa!.status === "CLOSED") throwStatus(409, "Cannot add actions to a closed CAPA");

    const [row] = await tx
      .insert(schema.capaActions)
      .values({
        capaId: input.capaId,
        description: input.description,
        assignedToUserId: input.assignedToUserId ?? null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        createdByUserId: input.createdByUserId,
      })
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: input.createdByUserId,
      action: "CAPA_ACTION_ADDED",
      entityType: "capa_action",
      entityId: row!.id,
      before: null,
      after: { capaId: input.capaId, description: input.description },
      requestId: input.requestId ?? null,
      route: input.route ?? null,
    });

    return row!;
  });
}

export async function completeCapaAction(input: {
  capaId: string;
  actionId: string;
  completedByUserId: string;
  requestId?: string;
  route?: string;
}): Promise<schema.CapaAction> {
  return db.transaction(async (tx) => {
    const [action] = await tx.select().from(schema.capaActions).where(
      and(eq(schema.capaActions.id, input.actionId), eq(schema.capaActions.capaId, input.capaId))
    );
    if (!action) throwStatus(404, "Action not found");
    if (action!.completedAt) throwStatus(409, "Action is already completed");

    const now = new Date();
    const [row] = await tx
      .update(schema.capaActions)
      .set({ completedAt: now, completedByUserId: input.completedByUserId })
      .where(eq(schema.capaActions.id, input.actionId))
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: input.completedByUserId,
      action: "CAPA_ACTION_COMPLETED",
      entityType: "capa_action",
      entityId: input.actionId,
      before: { completedAt: null },
      after: { completedAt: now.toISOString() },
      requestId: input.requestId ?? null,
      route: input.route ?? null,
    });

    return row!;
  });
}

// ─── Effectiveness Checks ─────────────────────────────────────────────────────

export async function scheduleEffectivenessCheck(input: {
  capaId: string;
  scheduledAt: string;
  createdByUserId: string;
  requestId?: string;
  route?: string;
}): Promise<schema.CapaEffectivenessCheck> {
  return db.transaction(async (tx) => {
    const [capa] = await tx.select().from(schema.capas).where(eq(schema.capas.id, input.capaId));
    if (!capa) throwStatus(404, "CAPA not found");
    if (capa!.status === "CLOSED") throwStatus(409, "CAPA is already closed");

    const [row] = await tx
      .insert(schema.capaEffectivenessChecks)
      .values({
        capaId: input.capaId,
        scheduledAt: new Date(input.scheduledAt),
        createdByUserId: input.createdByUserId,
      })
      .returning();

    return row!;
  });
}

// Called inside performSignature callback
export async function recordEffectivenessResultInTx(input: {
  capaId: string;
  checkId: string;
  result: "EFFECTIVE" | "NOT_EFFECTIVE";
  notes?: string;
  performedByUserId: string;
  requestId?: string;
  route?: string;
}, tx: Tx): Promise<schema.CapaEffectivenessCheck> {
  const [check] = await tx.select().from(schema.capaEffectivenessChecks).where(
    and(eq(schema.capaEffectivenessChecks.id, input.checkId), eq(schema.capaEffectivenessChecks.capaId, input.capaId))
  );
  if (!check) throwStatus(404, "Effectiveness check not found");
  if (check!.result !== "PENDING") throwStatus(409, "Result already recorded");

  const now = new Date();
  const [row] = await tx
    .update(schema.capaEffectivenessChecks)
    .set({ result: input.result, notes: input.notes ?? null, performedAt: now, performedByUserId: input.performedByUserId })
    .where(eq(schema.capaEffectivenessChecks.id, input.checkId))
    .returning();

  await tx.update(schema.capas)
    .set({ status: "EFFECTIVENESS_PENDING" })
    .where(and(eq(schema.capas.id, input.capaId), eq(schema.capas.status, "OPEN")));

  await tx.insert(schema.auditTrail).values({
    userId: input.performedByUserId,
    action: "CAPA_EFFECTIVENESS_RECORDED",
    entityType: "capa_effectiveness_check",
    entityId: input.checkId,
    before: { result: "PENDING" },
    after: { result: input.result, performedAt: now.toISOString() },
    requestId: input.requestId ?? null,
    route: input.route ?? null,
  });

  return row!;
}

export async function finalizeEffectivenessCheck(checkId: string, signatureId: string): Promise<schema.CapaEffectivenessCheck> {
  const [row] = await db.update(schema.capaEffectivenessChecks).set({ signatureId }).where(eq(schema.capaEffectivenessChecks.id, checkId)).returning();
  return row!;
}

// ─── Management Reviews ───────────────────────────────────────────────────────

export async function listManagementReviews(): Promise<schema.ManagementReview[]> {
  return db.select().from(schema.managementReviews).orderBy(desc(schema.managementReviews.reviewedAt));
}

export async function getManagementReview(id: string): Promise<schema.ManagementReview & { capaIds: string[] }> {
  const [review] = await db.select().from(schema.managementReviews).where(eq(schema.managementReviews.id, id));
  if (!review) throwStatus(404, "Management review not found");

  const links = await db.select({ capaId: schema.managementReviewCapas.capaId })
    .from(schema.managementReviewCapas)
    .where(eq(schema.managementReviewCapas.reviewId, id));

  return { ...review!, capaIds: links.map((l) => l.capaId) };
}

// Called inside performSignature callback
export async function createManagementReviewInTx(input: {
  period: string;
  reviewedAt: string;
  summary: string;
  outcome: "SATISFACTORY" | "REQUIRES_ACTION";
  capaIds: string[];
  createdByUserId: string;
  requestId?: string;
  route?: string;
}, tx: Tx): Promise<schema.ManagementReview> {
  const reviewNumber = await nextMrNumber();
  const [row] = await tx
    .insert(schema.managementReviews)
    .values({
      reviewNumber,
      period: input.period,
      reviewedAt: new Date(input.reviewedAt),
      summary: input.summary,
      outcome: input.outcome,
      createdByUserId: input.createdByUserId,
    })
    .returning();

  if (input.capaIds.length > 0) {
    await tx.insert(schema.managementReviewCapas).values(
      input.capaIds.map((capaId) => ({ reviewId: row!.id, capaId }))
    );
  }

  await tx.insert(schema.auditTrail).values({
    userId: input.createdByUserId,
    action: "MANAGEMENT_REVIEW_SIGNED",
    entityType: "management_review",
    entityId: row!.id,
    before: null,
    after: { reviewNumber, period: input.period, outcome: input.outcome },
    requestId: input.requestId ?? null,
    route: input.route ?? null,
  });

  return row!;
}

export async function finalizeManagementReview(reviewId: string, signatureId: string): Promise<schema.ManagementReview> {
  const [row] = await db.update(schema.managementReviews).set({ signatureId }).where(eq(schema.managementReviews.id, reviewId)).returning();
  return row!;
}
