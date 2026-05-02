import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, lte, gt, isNull, isNotNull, asc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export type RetainedSampleStatus = "active" | "due" | "destroyed" | "all";

export interface CreateRetainedSampleInput {
  bprId: string;
  sampledAt: string;
  pulledQty: string;
  qtyUnit: string;
  retentionLocation: string;
  retentionExpiresAt: string;
  createdByUserId: string;
  requestId?: string;
  route?: string;
}

export interface DestroyRetainedSampleInput {
  id: string;
  destroyedByUserId: string;
  requestId?: string;
  route?: string;
}

function throwStatus(status: number, msg: string, code?: string): never {
  throw Object.assign(new Error(msg), { status, ...(code ? { code } : {}) });
}

const creator = alias(schema.users, "creator");
const destroyer = alias(schema.users, "destroyer");

export async function listRetainedSamples(
  statusFilter: RetainedSampleStatus = "all",
): Promise<schema.RetainedSampleWithBpr[]> {
  const rows = await db
    .select({
      id: schema.retainedSamples.id,
      bprId: schema.retainedSamples.bprId,
      sampledAt: schema.retainedSamples.sampledAt,
      pulledQty: schema.retainedSamples.pulledQty,
      qtyUnit: schema.retainedSamples.qtyUnit,
      retentionLocation: schema.retainedSamples.retentionLocation,
      retentionExpiresAt: schema.retainedSamples.retentionExpiresAt,
      destroyedAt: schema.retainedSamples.destroyedAt,
      destroyedByUserId: schema.retainedSamples.destroyedByUserId,
      createdByUserId: schema.retainedSamples.createdByUserId,
      createdAt: schema.retainedSamples.createdAt,
      batchNumber: schema.batchProductionRecords.batchNumber,
      productName: schema.products.name,
      createdByName: creator.fullName,
      destroyedByName: destroyer.fullName,
    })
    .from(schema.retainedSamples)
    .innerJoin(schema.batchProductionRecords, eq(schema.retainedSamples.bprId, schema.batchProductionRecords.id))
    .innerJoin(schema.products, eq(schema.batchProductionRecords.productId, schema.products.id))
    .innerJoin(creator, eq(schema.retainedSamples.createdByUserId, creator.id))
    .leftJoin(destroyer, eq(schema.retainedSamples.destroyedByUserId, destroyer.id))
    .where(
      statusFilter === "active"
        ? and(isNull(schema.retainedSamples.destroyedAt), gt(schema.retainedSamples.retentionExpiresAt, sql`now()`))
        : statusFilter === "due"
          ? and(isNull(schema.retainedSamples.destroyedAt), lte(schema.retainedSamples.retentionExpiresAt, sql`now()`))
          : statusFilter === "destroyed"
            ? isNotNull(schema.retainedSamples.destroyedAt)
            : undefined,
    )
    .orderBy(asc(schema.retainedSamples.retentionExpiresAt));

  return rows as schema.RetainedSampleWithBpr[];
}

export async function createRetainedSample(
  input: CreateRetainedSampleInput,
): Promise<schema.RetainedSample> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.retainedSamples)
      .values({
        bprId: input.bprId,
        sampledAt: new Date(input.sampledAt),
        pulledQty: input.pulledQty,
        qtyUnit: input.qtyUnit,
        retentionLocation: input.retentionLocation,
        retentionExpiresAt: new Date(input.retentionExpiresAt),
        createdByUserId: input.createdByUserId,
      })
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: input.createdByUserId,
      action: "RETAINED_SAMPLE_CREATED",
      entityType: "retained_sample",
      entityId: row!.id,
      before: null,
      after: {
        bprId: input.bprId,
        sampledAt: input.sampledAt,
        pulledQty: input.pulledQty,
        qtyUnit: input.qtyUnit,
        retentionLocation: input.retentionLocation,
        retentionExpiresAt: input.retentionExpiresAt,
      },
      requestId: input.requestId ?? null,
      route: input.route ?? null,
    });

    return row!;
  });
}

export async function destroyRetainedSample(
  input: DestroyRetainedSampleInput,
): Promise<schema.RetainedSample> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.retainedSamples)
      .where(eq(schema.retainedSamples.id, input.id));

    if (!existing) throwStatus(404, "Retained sample not found");
    if (existing!.destroyedAt) throwStatus(409, "Sample is already marked as destroyed");

    const now = new Date();
    const [row] = await tx
      .update(schema.retainedSamples)
      .set({ destroyedAt: now, destroyedByUserId: input.destroyedByUserId })
      .where(eq(schema.retainedSamples.id, input.id))
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: input.destroyedByUserId,
      action: "RETAINED_SAMPLE_DESTROYED",
      entityType: "retained_sample",
      entityId: input.id,
      before: { destroyedAt: null },
      after: { destroyedAt: now.toISOString(), destroyedByUserId: input.destroyedByUserId },
      requestId: input.requestId ?? null,
      route: input.route ?? null,
    });

    return row!;
  });
}
