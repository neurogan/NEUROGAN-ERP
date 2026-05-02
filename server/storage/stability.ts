import { eq, and, lte, isNull, gte, asc } from "drizzle-orm";
import { db, type Tx } from "../db";
import * as schema from "@shared/schema";

// ─── Protocols ─────────────────────────────────────────────────────────────

export async function listProtocols(includeInactive = false) {
  const rows = await db
    .select({
      protocol:    schema.stabilityProtocols,
      productName: schema.products.name,
    })
    .from(schema.stabilityProtocols)
    .leftJoin(schema.products, eq(schema.stabilityProtocols.productId, schema.products.id))
    .where(includeInactive ? undefined : eq(schema.stabilityProtocols.isActive, true))
    .orderBy(schema.stabilityProtocols.name);
  return rows.map((r) => ({ ...r.protocol, productName: r.productName ?? null }));
}

export async function getProtocol(id: string) {
  const [row] = await db
    .select({
      protocol:    schema.stabilityProtocols,
      productName: schema.products.name,
    })
    .from(schema.stabilityProtocols)
    .leftJoin(schema.products, eq(schema.stabilityProtocols.productId, schema.products.id))
    .where(eq(schema.stabilityProtocols.id, id));
  if (!row) throw Object.assign(new Error("Stability protocol not found"), { status: 404, code: "NOT_FOUND" });

  const attributes = await db
    .select()
    .from(schema.stabilityProtocolAttributes)
    .where(eq(schema.stabilityProtocolAttributes.protocolId, id))
    .orderBy(schema.stabilityProtocolAttributes.analyteName);

  return { ...row.protocol, productName: row.productName ?? null, attributes };
}

export async function createProtocol(input: {
  name: string;
  productId?: string | null;
  description?: string | null;
  storageCondition: string;
  testIntervalsMonths: number[];
  attributes: { analyteName: string; unit?: string | null; minSpec?: string | null; maxSpec?: string | null; testMethod?: string | null }[];
  createdByUserId: string;
  requestId: string;
  route: string;
}) {
  return db.transaction(async (tx) => {
    const [protocol] = await tx
      .insert(schema.stabilityProtocols)
      .values({
        name:                input.name,
        productId:           input.productId ?? null,
        description:         input.description ?? null,
        storageCondition:    input.storageCondition,
        testIntervalsMonths: input.testIntervalsMonths,
        createdByUserId:     input.createdByUserId,
      })
      .returning();

    const attrs = input.attributes.length
      ? await tx
          .insert(schema.stabilityProtocolAttributes)
          .values(input.attributes.map((a) => ({
            protocolId:  protocol!.id,
            analyteName: a.analyteName,
            unit:        a.unit ?? null,
            minSpec:     a.minSpec ?? null,
            maxSpec:     a.maxSpec ?? null,
            testMethod:  a.testMethod ?? null,
          })))
          .returning()
      : [];

    await tx.insert(schema.auditTrail).values({
      userId:     input.createdByUserId,
      action:     "STABILITY_PROTOCOL_CREATED",
      entityType: "stability_protocol",
      entityId:   protocol!.id,
      before:     null,
      after:      { ...protocol, attributes: attrs } as Record<string, unknown>,
      route:      input.route,
      requestId:  input.requestId,
    });

    return { ...protocol!, attributes: attrs };
  });
}

// ─── Batch enrollment ───────────────────────────────────────────────────────

export async function listBatches() {
  const rows = await db
    .select({
      batch:        schema.stabilityBatches,
      protocolName: schema.stabilityProtocols.name,
    })
    .from(schema.stabilityBatches)
    .innerJoin(schema.stabilityProtocols, eq(schema.stabilityBatches.protocolId, schema.stabilityProtocols.id))
    .orderBy(schema.stabilityBatches.enrolledAt);
  return rows.map((r) => ({ ...r.batch, protocolName: r.protocolName }));
}

export async function getBatch(id: string) {
  const [row] = await db
    .select({
      batch:        schema.stabilityBatches,
      protocolName: schema.stabilityProtocols.name,
    })
    .from(schema.stabilityBatches)
    .innerJoin(schema.stabilityProtocols, eq(schema.stabilityBatches.protocolId, schema.stabilityProtocols.id))
    .where(eq(schema.stabilityBatches.id, id));
  if (!row) throw Object.assign(new Error("Stability batch not found"), { status: 404, code: "NOT_FOUND" });

  const timepoints = await db
    .select()
    .from(schema.stabilityTimepoints)
    .where(eq(schema.stabilityTimepoints.batchId, id))
    .orderBy(asc(schema.stabilityTimepoints.intervalMonths));

  const timepointIds = timepoints.map((t) => t.id);
  const results = timepointIds.length
    ? (await Promise.all(
        timepointIds.map((tpId) =>
          db.select().from(schema.stabilityResults).where(eq(schema.stabilityResults.timepointId, tpId)),
        ),
      )).flat()
    : [];

  const [conclusion] = await db
    .select()
    .from(schema.stabilityConclusions)
    .where(eq(schema.stabilityConclusions.batchId, id));

  const now = new Date();
  const soonMs = 14 * 86_400_000;

  const timepointsWithResults = timepoints.map((tp) => ({
    ...tp,
    results: results.filter((r) => r.timepointId === tp.id),
  }));

  const overdueCount = timepoints.filter(
    (tp) => !tp.completedAt && tp.scheduledAt < now,
  ).length;

  const upcomingCount = timepoints.filter(
    (tp) =>
      !tp.completedAt &&
      tp.scheduledAt >= now &&
      tp.scheduledAt.getTime() - now.getTime() <= soonMs,
  ).length;

  return {
    ...row.batch,
    protocolName: row.protocolName,
    timepoints: timepointsWithResults,
    conclusion: conclusion ?? null,
    overdueCount,
    upcomingCount,
  };
}

export async function enrollBatch(input: {
  protocolId: string;
  bprId: string;
  enrolledAt: string;
  enrolledByUserId: string;
  requestId: string;
  route: string;
}) {
  return db.transaction(async (tx) => {
    const protocol = await tx
      .select({ testIntervalsMonths: schema.stabilityProtocols.testIntervalsMonths })
      .from(schema.stabilityProtocols)
      .where(eq(schema.stabilityProtocols.id, input.protocolId))
      .then((r) => r[0]);
    if (!protocol) throw Object.assign(new Error("Protocol not found"), { status: 404, code: "NOT_FOUND" });

    const enrolledAt = new Date(input.enrolledAt);

    const [batch] = await tx
      .insert(schema.stabilityBatches)
      .values({
        protocolId:       input.protocolId,
        bprId:            input.bprId,
        enrolledAt,
        enrolledByUserId: input.enrolledByUserId,
      })
      .returning();

    // Auto-generate timepoints
    const timepointValues = protocol.testIntervalsMonths.map((months) => {
      const scheduledAt = new Date(enrolledAt);
      scheduledAt.setMonth(scheduledAt.getMonth() + months);
      return { batchId: batch!.id, intervalMonths: months, scheduledAt };
    });

    if (timepointValues.length) {
      await tx.insert(schema.stabilityTimepoints).values(timepointValues);
    }

    await tx.insert(schema.auditTrail).values({
      userId:     input.enrolledByUserId,
      action:     "STABILITY_BATCH_ENROLLED",
      entityType: "stability_batch",
      entityId:   batch!.id,
      before:     null,
      after:      batch as Record<string, unknown>,
      route:      input.route,
      requestId:  input.requestId,
    });

    return batch!;
  });
}

// ─── Results ────────────────────────────────────────────────────────────────

export async function enterResultsInTx(
  input: {
    timepointId: string;
    results: { attributeId: string; reportedValue: string; reportedUnit: string; passFail: string; notes?: string | null }[];
    enteredByUserId: string;
    requestId: string;
    route: string;
  },
  tx: Tx,
) {
  const rows = await tx
    .insert(schema.stabilityResults)
    .values(input.results.map((r) => ({
      timepointId:     input.timepointId,
      attributeId:     r.attributeId,
      reportedValue:   r.reportedValue,
      reportedUnit:    r.reportedUnit,
      passFail:        r.passFail,
      notes:           r.notes ?? null,
      enteredByUserId: input.enteredByUserId,
    })))
    .returning();

  // Mark timepoint complete if all attributes now have a result
  const tp = await tx
    .select({ batchId: schema.stabilityTimepoints.batchId })
    .from(schema.stabilityTimepoints)
    .where(eq(schema.stabilityTimepoints.id, input.timepointId))
    .then((r) => r[0]);

  if (tp) {
    const batch = await tx
      .select({ protocolId: schema.stabilityBatches.protocolId })
      .from(schema.stabilityBatches)
      .where(eq(schema.stabilityBatches.id, tp.batchId))
      .then((r) => r[0]);

    if (batch) {
      const attrCount = await tx
        .select({ id: schema.stabilityProtocolAttributes.id })
        .from(schema.stabilityProtocolAttributes)
        .where(eq(schema.stabilityProtocolAttributes.protocolId, batch.protocolId))
        .then((r) => r.length);

      const resultCount = await tx
        .select({ id: schema.stabilityResults.id })
        .from(schema.stabilityResults)
        .where(eq(schema.stabilityResults.timepointId, input.timepointId))
        .then((r) => r.length);

      if (resultCount >= attrCount) {
        await tx
          .update(schema.stabilityTimepoints)
          .set({ completedAt: new Date() })
          .where(eq(schema.stabilityTimepoints.id, input.timepointId));
      }
    }
  }

  await tx.insert(schema.auditTrail).values({
    userId:     input.enteredByUserId,
    action:     "STABILITY_RESULT_ENTERED",
    entityType: "stability_timepoint",
    entityId:   input.timepointId,
    before:     null,
    after:      rows as unknown as Record<string, unknown>,
    route:      input.route,
    requestId:  input.requestId,
  });

  return rows;
}

// ─── Conclusions ────────────────────────────────────────────────────────────

export async function concludeBatchInTx(
  input: {
    batchId: string;
    supportedShelfLifeMonths: number;
    basis: string;
    outcome: string;
    concludedByUserId: string;
  },
  tx: Tx,
) {
  const [conclusion] = await tx
    .insert(schema.stabilityConclusions)
    .values({
      batchId:                  input.batchId,
      supportedShelfLifeMonths: input.supportedShelfLifeMonths,
      basis:                    input.basis,
      outcome:                  input.outcome,
      concludedByUserId:        input.concludedByUserId,
    })
    .returning();

  await tx
    .update(schema.stabilityBatches)
    .set({ status: "CONCLUDED" })
    .where(eq(schema.stabilityBatches.id, input.batchId));

  return conclusion!;
}

export async function finalizeConclusionSignature(conclusionId: string, signatureId: string) {
  const [row] = await db
    .update(schema.stabilityConclusions)
    .set({ signatureId })
    .where(eq(schema.stabilityConclusions.id, conclusionId))
    .returning();
  return row!;
}

// ─── Dashboard helpers ──────────────────────────────────────────────────────

export async function getOverdueTimepoints() {
  const now = new Date();
  return db
    .select({
      timepoint:    schema.stabilityTimepoints,
      batchId:      schema.stabilityBatches.id,
      bprId:        schema.stabilityBatches.bprId,
      protocolName: schema.stabilityProtocols.name,
    })
    .from(schema.stabilityTimepoints)
    .innerJoin(schema.stabilityBatches, eq(schema.stabilityTimepoints.batchId, schema.stabilityBatches.id))
    .innerJoin(schema.stabilityProtocols, eq(schema.stabilityBatches.protocolId, schema.stabilityProtocols.id))
    .where(and(
      isNull(schema.stabilityTimepoints.completedAt),
      lte(schema.stabilityTimepoints.scheduledAt, now),
    ))
    .orderBy(asc(schema.stabilityTimepoints.scheduledAt));
}

export async function getUpcomingTimepoints(windowDays = 14) {
  const now = new Date();
  const cutoff = new Date(now.getTime() + windowDays * 86_400_000);
  return db
    .select({
      timepoint:    schema.stabilityTimepoints,
      batchId:      schema.stabilityBatches.id,
      bprId:        schema.stabilityBatches.bprId,
      protocolName: schema.stabilityProtocols.name,
    })
    .from(schema.stabilityTimepoints)
    .innerJoin(schema.stabilityBatches, eq(schema.stabilityTimepoints.batchId, schema.stabilityBatches.id))
    .innerJoin(schema.stabilityProtocols, eq(schema.stabilityBatches.protocolId, schema.stabilityProtocols.id))
    .where(and(
      isNull(schema.stabilityTimepoints.completedAt),
      gte(schema.stabilityTimepoints.scheduledAt, now),
      lte(schema.stabilityTimepoints.scheduledAt, cutoff),
    ))
    .orderBy(asc(schema.stabilityTimepoints.scheduledAt));
}
