import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq, and, inArray } from "drizzle-orm";

import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";

// R-03 Task 9 — end-to-end HTTP-level tests for POST /api/production-batches/:id/start.
//
// Covers:
//  1. Happy path
//  2. CALIBRATION_OVERDUE → 409 + START_BLOCKED audit row
//  3. EQUIPMENT_LIST_EMPTY → 409
//  4. PATCH /:id status=IN_PROGRESS → 400 USE_START_ENDPOINT
//  5. Audit row persists despite transaction rollback (the plan-defect fix)

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;
const VALID_PASSWORD = "Neurogan1!Secure";

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

let app: Express;
let adminId: string;
let qaId: string;
let prodId: string;
let productAId: string;

const createdBatchIds: string[] = [];
const createdEquipmentIds: string[] = [];
const createdProductIds: string[] = [];

async function makeEquipment(suffix: string): Promise<string> {
  const tag = `R03S-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [row] = await db
    .insert(schema.equipment)
    .values({ assetTag: tag, name: "StartEquip" })
    .returning();
  createdEquipmentIds.push(row!.id);
  return row!.id;
}

async function qualifyAll(equipmentId: string): Promise<void> {
  for (const type of ["IQ", "OQ", "PQ"] as const) {
    const [sig] = await db
      .insert(schema.electronicSignatures)
      .values({
        userId: qaId,
        meaning: "EQUIPMENT_QUALIFIED",
        entityType: "equipment",
        entityId: equipmentId,
        fullNameAtSigning: "Test QA",
        titleAtSigning: "QC Manager",
        requestId: `r03s-${type}-${Date.now()}-${Math.random()}`,
        manifestationJson: { meaning: "EQUIPMENT_QUALIFIED" },
      })
      .returning();
    await db.insert(schema.equipmentQualifications).values({
      equipmentId,
      type,
      status: "QUALIFIED",
      validFrom: isoDate(-30),
      validUntil: isoDate(365),
      signatureId: sig!.id,
    });
  }
}

async function createSchedule(equipmentId: string, daysFromNow: number): Promise<void> {
  await db.insert(schema.calibrationSchedules).values({
    equipmentId,
    frequencyDays: 365,
    nextDueAt: new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000),
  });
}

async function makeProduct(suffix: string): Promise<string> {
  const sku = `R03S-SKU-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [row] = await db
    .insert(schema.products)
    .values({ name: `R03S Product ${suffix}`, sku, defaultUom: "kg" })
    .returning();
  createdProductIds.push(row!.id);
  return row!.id;
}

async function makeDraftBatch(productId: string): Promise<string> {
  const [batch] = await db
    .insert(schema.productionBatches)
    .values({
      batchNumber: `R03S-BATCH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      productId,
      plannedQuantity: "100",
      outputUom: "kg",
      status: "DRAFT",
    })
    .returning();
  createdBatchIds.push(batch!.id);
  return batch!.id;
}

beforeAll(async () => {
  if (!dbUrl) return;
  app = await buildTestApp();
  const sfx = Date.now();

  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r03s-adm-${sfx}@t.com`,
      fullName: "R03S Admin",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: null as unknown as string,
    })
    .returning();
  adminId = adm!.id;
  await db.insert(schema.userRoles).values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });

  const [qa] = await db
    .insert(schema.users)
    .values({
      email: `r03s-qa-${sfx}@t.com`,
      fullName: "R03S QA",
      title: "QC Manager",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  qaId = qa!.id;
  await db.insert(schema.userRoles).values({ userId: qaId, role: "QA", grantedByUserId: adminId });

  const [pp] = await db
    .insert(schema.users)
    .values({
      email: `r03s-prod-${sfx}@t.com`,
      fullName: "R03S Prod",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  prodId = pp!.id;
  await db.insert(schema.userRoles).values({ userId: prodId, role: "PRODUCTION", grantedByUserId: adminId });

  productAId = await makeProduct("A");
});

afterAll(async () => {
  if (!dbUrl) return;
  for (const bid of createdBatchIds) {
    await db
      .delete(schema.batchProductionRecords)
      .where(eq(schema.batchProductionRecords.productionBatchId, bid))
      .catch(() => {});
    await db
      .delete(schema.productionBatchEquipmentUsed)
      .where(eq(schema.productionBatchEquipmentUsed.productionBatchId, bid))
      .catch(() => {});
    await db
      .delete(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, bid))
      .catch(() => {});
  }
  for (const id of createdEquipmentIds) {
    await db
      .update(schema.calibrationSchedules)
      .set({ lastRecordId: null })
      .where(eq(schema.calibrationSchedules.equipmentId, id))
      .catch(() => {});
    await db
      .delete(schema.calibrationSchedules)
      .where(eq(schema.calibrationSchedules.equipmentId, id))
      .catch(() => {});
    await db
      .delete(schema.equipmentQualifications)
      .where(eq(schema.equipmentQualifications.equipmentId, id))
      .catch(() => {});
    await db
      .delete(schema.productionBatchEquipmentUsed)
      .where(eq(schema.productionBatchEquipmentUsed.equipmentId, id))
      .catch(() => {});
    await db
      .delete(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, id))
      .catch(() => {});
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, id)).catch(() => {});
    await db.delete(schema.equipment).where(eq(schema.equipment.id, id)).catch(() => {});
  }
  if (createdBatchIds.length > 0) {
    await db
      .delete(schema.productionBatches)
      .where(inArray(schema.productionBatches.id, createdBatchIds))
      .catch(() => {});
  }
  if (createdProductIds.length > 0) {
    await db
      .delete(schema.products)
      .where(inArray(schema.products.id, createdProductIds))
      .catch(() => {});
  }
  for (const uid of [adminId, qaId, prodId]) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, uid)).catch(() => {});
    await db
      .delete(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.userId, uid))
      .catch(() => {});
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, uid)).catch(() => {});
    await db.delete(schema.users).where(eq(schema.users.id, uid)).catch(() => {});
  }
});

describeIfDb("R-03 BPR start endpoint (integration)", () => {
  it("happy path: 200, batch IN_PROGRESS, BPR exists, equipment_used rows written", async () => {
    const equipId = await makeEquipment("happy");
    await createSchedule(equipId, 30);
    await qualifyAll(equipId);

    const batchId = await makeDraftBatch(productAId);

    const res = await request(app)
      .post(`/api/production-batches/${batchId}/start`)
      .set("x-test-user-id", prodId)
      .send({ equipmentIds: [equipId] });

    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("IN_PROGRESS");

    const [batchRow] = await db
      .select()
      .from(schema.productionBatches)
      .where(eq(schema.productionBatches.id, batchId));
    expect(batchRow!.status).toBe("IN_PROGRESS");

    const eqUsed = await db
      .select()
      .from(schema.productionBatchEquipmentUsed)
      .where(eq(schema.productionBatchEquipmentUsed.productionBatchId, batchId));
    expect(eqUsed).toHaveLength(1);
    expect(eqUsed[0]!.equipmentId).toBe(equipId);

    const bprs = await db
      .select()
      .from(schema.batchProductionRecords)
      .where(eq(schema.batchProductionRecords.productionBatchId, batchId));
    expect(bprs).toHaveLength(1);
    expect(bprs[0]!.status).toBe("IN_PROGRESS");
  });

  it("CALIBRATION_OVERDUE: 409, batch unchanged, no BPR, audit row persists despite rollback", async () => {
    const equipId = await makeEquipment("cal-overdue");
    // Schedule with nextDueAt in the past
    await db.insert(schema.calibrationSchedules).values({
      equipmentId: equipId,
      frequencyDays: 365,
      nextDueAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    await qualifyAll(equipId);

    const batchId = await makeDraftBatch(productAId);

    const res = await request(app)
      .post(`/api/production-batches/${batchId}/start`)
      .set("x-test-user-id", qaId)
      .send({ equipmentIds: [equipId] });

    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe("CALIBRATION_OVERDUE");
    expect((res.body as { payload: { equipment: unknown[] } }).payload.equipment).toHaveLength(1);

    // Batch unchanged
    const [batchRow] = await db
      .select()
      .from(schema.productionBatches)
      .where(eq(schema.productionBatches.id, batchId));
    expect(batchRow!.status).toBe("DRAFT");

    // No BPR
    const bprs = await db
      .select()
      .from(schema.batchProductionRecords)
      .where(eq(schema.batchProductionRecords.productionBatchId, batchId));
    expect(bprs).toHaveLength(0);

    // No equipment_used rows
    const eqUsed = await db
      .select()
      .from(schema.productionBatchEquipmentUsed)
      .where(eq(schema.productionBatchEquipmentUsed.productionBatchId, batchId));
    expect(eqUsed).toHaveLength(0);

    // Audit row persists despite the gate failure (plan-defect fix verified)
    const audits = await db
      .select()
      .from(schema.auditTrail)
      .where(
        and(
          eq(schema.auditTrail.entityId, batchId),
          eq(schema.auditTrail.action, "START_BLOCKED"),
        ),
      );
    expect(audits).toHaveLength(1);
    const after = audits[0]!.after as { code: string; payload: { equipment: unknown[] } };
    expect(after.code).toBe("CALIBRATION_OVERDUE");
    expect(after.payload.equipment).toHaveLength(1);
  });

  it("EQUIPMENT_LIST_EMPTY: empty equipmentIds → 409", async () => {
    const batchId = await makeDraftBatch(productAId);

    const res = await request(app)
      .post(`/api/production-batches/${batchId}/start`)
      .set("x-test-user-id", prodId)
      .send({ equipmentIds: [] });

    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe("EQUIPMENT_LIST_EMPTY");

    // Audit row written even for empty-list case
    const audits = await db
      .select()
      .from(schema.auditTrail)
      .where(
        and(
          eq(schema.auditTrail.entityId, batchId),
          eq(schema.auditTrail.action, "START_BLOCKED"),
        ),
      );
    expect(audits).toHaveLength(1);
  });

  it("PATCH /:id with status=IN_PROGRESS is rejected with 400 USE_START_ENDPOINT", async () => {
    const batchId = await makeDraftBatch(productAId);

    const res = await request(app)
      .patch(`/api/production-batches/${batchId}`)
      .set("x-test-user-id", prodId)
      .send({ status: "IN_PROGRESS" });

    expect(res.status).toBe(400);
    expect((res.body as { code: string }).code).toBe("USE_START_ENDPOINT");

    // Batch should still be DRAFT
    const [row] = await db
      .select()
      .from(schema.productionBatches)
      .where(eq(schema.productionBatches.id, batchId));
    expect(row!.status).toBe("DRAFT");
  });

  it("audit row persists across rollback (plan-defect fix): two failed attempts produce two audit rows", async () => {
    // The critical test: confirm the audit row written on gate failure is NOT
    // rolled back. We trigger two distinct gate failures on the same batch and
    // expect exactly two START_BLOCKED audit rows to remain.
    const equipId = await makeEquipment("rollback");
    await db.insert(schema.calibrationSchedules).values({
      equipmentId: equipId,
      frequencyDays: 365,
      nextDueAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    await qualifyAll(equipId);

    const batchId = await makeDraftBatch(productAId);

    // Attempt 1: calibration overdue
    const res1 = await request(app)
      .post(`/api/production-batches/${batchId}/start`)
      .set("x-test-user-id", qaId)
      .send({ equipmentIds: [equipId] });
    expect(res1.status).toBe(409);

    // Attempt 2: empty equipment list
    const res2 = await request(app)
      .post(`/api/production-batches/${batchId}/start`)
      .set("x-test-user-id", qaId)
      .send({ equipmentIds: [] });
    expect(res2.status).toBe(409);

    // Both audit rows must be present — neither was rolled back.
    const audits = await db
      .select()
      .from(schema.auditTrail)
      .where(
        and(
          eq(schema.auditTrail.entityId, batchId),
          eq(schema.auditTrail.action, "START_BLOCKED"),
        ),
      );
    expect(audits).toHaveLength(2);
    const codes = audits.map((a) => (a.after as { code: string }).code).sort();
    expect(codes).toEqual(["CALIBRATION_OVERDUE", "EQUIPMENT_LIST_EMPTY"]);

    // And the batch is still DRAFT
    const [row] = await db
      .select()
      .from(schema.productionBatches)
      .where(eq(schema.productionBatches.id, batchId));
    expect(row!.status).toBe("DRAFT");
  });
});
