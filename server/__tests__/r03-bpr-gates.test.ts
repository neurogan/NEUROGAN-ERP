import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";
import { eq, inArray } from "drizzle-orm";
import {
  runAllGates,
  GateError,
} from "../state/bpr-equipment-gates";

// R-03 Task 8 — BPR start gates unit tests.
//
// These exercise pure-function gate logic against a real DB fixture (no HTTP).
// We seed the minimum chain needed for each gate: 1+ equipment with calibration
// schedule and IQ/OQ/PQ qualifications, 2 products, and synthetic BPR rows
// inserted directly via db.insert (no recipe/lot wiring needed — the gate
// only looks at productionBatchEquipmentUsed + batchProductionRecords).

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;
const VALID_PASSWORD = "Neurogan1!Secure";

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

let adminId: string;
let qaId: string;
let equipId: string;
let productAId: string;
let productBId: string;

const createdEquipmentIds: string[] = [];
const createdProductIds: string[] = [];
const createdBatchIds: string[] = [];

async function makeEquipment(suffix: string): Promise<string> {
  const tag = `R03G-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [row] = await db
    .insert(schema.equipment)
    .values({ assetTag: tag, name: "GateEquip" })
    .returning();
  createdEquipmentIds.push(row!.id);
  return row!.id;
}

// Insert a QUALIFIED qualification row. equipmentQualifications has a CHECK
// constraint (qualification_signed_when_qualified) requiring signatureId to be
// set when status='QUALIFIED', so we mint a placeholder signature row first.
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
        requestId: `r03g-${type}-${Date.now()}-${Math.random()}`,
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
  const sku = `R03G-SKU-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [row] = await db
    .insert(schema.products)
    .values({ name: `R03G Product ${suffix}`, sku, defaultUom: "kg" })
    .returning();
  createdProductIds.push(row!.id);
  return row!.id;
}

async function makeBatch(productId: string, status = "IN_PROGRESS"): Promise<string> {
  const [batch] = await db
    .insert(schema.productionBatches)
    .values({
      batchNumber: `R03G-BATCH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      productId,
      plannedQuantity: "100",
      outputUom: "kg",
      status,
    })
    .returning();
  createdBatchIds.push(batch!.id);
  return batch!.id;
}

beforeAll(async () => {
  if (!dbUrl) return;
  const sfx = Date.now();

  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r03g-adm-${sfx}@t.com`,
      fullName: "R03G Admin",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: null as unknown as string,
    })
    .returning();
  adminId = adm!.id;
  await db
    .insert(schema.userRoles)
    .values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });

  const [qa] = await db
    .insert(schema.users)
    .values({
      email: `r03g-qa-${sfx}@t.com`,
      fullName: "R03G QA",
      title: "QC Manager",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  qaId = qa!.id;
  await db
    .insert(schema.userRoles)
    .values({ userId: qaId, role: "QA", grantedByUserId: adminId });

  // Two distinct products so we can exercise same-product (pass) vs.
  // product-change (clearance gate) paths.
  productAId = await makeProduct("A");
  productBId = await makeProduct("B");

  await makeBatch(productAId);

  // Default-fixture equipment: passes all gates (cal future, IQ/OQ/PQ active).
  equipId = await makeEquipment("default");
  await createSchedule(equipId, 30);
  await qualifyAll(equipId);

  await makeBatch(productBId, "IN_PROGRESS");
});

afterAll(async () => {
  if (!dbUrl) return;
  // FK-aware teardown: clear dependent rows before parents.
  // BPR + equipment-used → schedules → qualifications → signatures →
  // line-clearances → equipment → batches → products → userRoles → users.
  for (const bid of createdBatchIds) {
    await db
      .delete(schema.batchProductionRecords)
      .where(eq(schema.batchProductionRecords.productionBatchId, bid))
      .catch(() => {});
    await db
      .delete(schema.productionBatchEquipmentUsed)
      .where(eq(schema.productionBatchEquipmentUsed.productionBatchId, bid))
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
      .delete(schema.lineClearances)
      .where(eq(schema.lineClearances.equipmentId, id))
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
  for (const uid of [adminId, qaId]) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, uid)).catch(() => {});
    await db
      .delete(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.userId, uid))
      .catch(() => {});
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, uid)).catch(() => {});
    await db.delete(schema.users).where(eq(schema.users.id, uid)).catch(() => {});
  }
});

// Reset the default equipment's calibration to a future date and ensure no
// stray prior-BPR rows linger between tests. (Each LINE_CLEARANCE test does
// its own targeted setup via fresh equipment to avoid order coupling.)
beforeEach(async () => {
  if (!dbUrl) return;
  await db
    .update(schema.calibrationSchedules)
    .set({ nextDueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) })
    .where(eq(schema.calibrationSchedules.equipmentId, equipId));
  // Wipe any equipment-used rows pointing at the default equipId so the
  // line-clearance gate sees a clean slate.
  await db
    .delete(schema.productionBatchEquipmentUsed)
    .where(eq(schema.productionBatchEquipmentUsed.equipmentId, equipId));
});

describeIfDb("R-03 BPR start gates", () => {
  describe("EQUIPMENT_LIST_EMPTY", () => {
    it("throws when equipmentIds is empty", async () => {
      await expect(runAllGates(db, [])).rejects.toMatchObject({
        status: 409,
        code: "EQUIPMENT_LIST_EMPTY",
      });
    });

    it("happy path: passes through all gates with valid fixture", async () => {
      await expect(
        runAllGates(db, [equipId]),
      ).resolves.toBeUndefined();
    });
  });

  describe("CALIBRATION_OVERDUE", () => {
    it("throws when nextDueAt is in the past", async () => {
      await db
        .update(schema.calibrationSchedules)
        .set({ nextDueAt: new Date(Date.now() - 24 * 60 * 60 * 1000) })
        .where(eq(schema.calibrationSchedules.equipmentId, equipId));

      const err = await runAllGates(db, [equipId]).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).status).toBe(409);
      expect((err as GateError).code).toBe("CALIBRATION_OVERDUE");
      const payload = (err as GateError).payload as {
        equipment: Array<{ assetTag: string; dueAt: Date; equipmentId: string }>;
      };
      expect(payload.equipment).toHaveLength(1);
      expect(payload.equipment[0]!.equipmentId).toBe(equipId);
      expect(payload.equipment[0]!.assetTag).toBeTruthy();
      expect(payload.equipment[0]!.dueAt).toBeInstanceOf(Date);
    });

    it("passes when nextDueAt is in the future", async () => {
      await db
        .update(schema.calibrationSchedules)
        .set({ nextDueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) })
        .where(eq(schema.calibrationSchedules.equipmentId, equipId));
      await expect(
        runAllGates(db, [equipId]),
      ).resolves.toBeUndefined();
    });
  });

  // IQ/OQ/PQ qualification gate removed (see bpr-equipment-gates.ts) — 21 CFR
  // Part 111 does not require formal qualification protocols for dietary
  // supplement equipment. Equipment fitness is demonstrated via SOPs and BPR
  // step execution records instead.

  // LINE_CLEARANCE_MISSING gate removed — cleaning and line clearance are
  // required BPR steps. The step-execution gate on submitBprForReview ensures
  // they were performed before a batch can be completed.
});
