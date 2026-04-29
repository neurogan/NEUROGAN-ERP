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
let batchId: string;
let priorBatchId: string;

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

async function makeBpr(
  productionBatchId: string,
  productId: string,
  status: string,
  completedAt: Date | null,
): Promise<string> {
  const [bpr] = await db
    .insert(schema.batchProductionRecords)
    .values({
      productionBatchId,
      batchNumber: `R03G-BPR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      productId,
      status,
      completedAt,
    })
    .returning();
  return bpr!.id;
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

  // The "current" production batch (the one we're trying to start). The gate
  // only looks at productionBatchEquipmentUsed + APPROVED prior BPRs, so the
  // current batch's status doesn't matter for the gate logic — we keep it
  // IN_PROGRESS as the realistic default.
  batchId = await makeBatch(productAId);

  // Default-fixture equipment: passes all gates (cal future, IQ/OQ/PQ active).
  equipId = await makeEquipment("default");
  await createSchedule(equipId, 30);
  await qualifyAll(equipId);

  // A "prior batch" placeholder used by line-clearance tests that simulate
  // a previous APPROVED BPR. Created here so the FK chain is wired up; tests
  // attach BPR rows + equipment-used rows on demand.
  priorBatchId = await makeBatch(productBId, "IN_PROGRESS");
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
      await expect(runAllGates(db, batchId, productAId, [])).rejects.toMatchObject({
        status: 409,
        code: "EQUIPMENT_LIST_EMPTY",
      });
    });

    it("happy path: passes through all gates with valid fixture", async () => {
      await expect(
        runAllGates(db, batchId, productAId, [equipId]),
      ).resolves.toBeUndefined();
    });
  });

  describe("CALIBRATION_OVERDUE", () => {
    it("throws when nextDueAt is in the past", async () => {
      await db
        .update(schema.calibrationSchedules)
        .set({ nextDueAt: new Date(Date.now() - 24 * 60 * 60 * 1000) })
        .where(eq(schema.calibrationSchedules.equipmentId, equipId));

      const err = await runAllGates(db, batchId, productAId, [equipId]).catch(
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
        runAllGates(db, batchId, productAId, [equipId]),
      ).resolves.toBeUndefined();
    });
  });

  describe("EQUIPMENT_NOT_QUALIFIED", () => {
    it("throws when equipment lacks IQ/OQ/PQ qualifications", async () => {
      // Fresh equipment with calibration schedule but NO qualifications.
      const bareEquipId = await makeEquipment("bare");
      await createSchedule(bareEquipId, 30);

      const err = await runAllGates(db, batchId, productAId, [bareEquipId]).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).code).toBe("EQUIPMENT_NOT_QUALIFIED");
      const payload = (err as GateError).payload as {
        equipment: Array<{ assetTag: string; missingTypes: string[] }>;
      };
      expect(payload.equipment).toHaveLength(1);
      expect(payload.equipment[0]!.missingTypes.sort()).toEqual(["IQ", "OQ", "PQ"]);
    });

    it("passes when all three IQ/OQ/PQ are QUALIFIED and within validity window", async () => {
      // The default equipId fixture has all three QUALIFIED — just confirm.
      await expect(
        runAllGates(db, batchId, productAId, [equipId]),
      ).resolves.toBeUndefined();
    });

    it("reports only the missing types when some are present", async () => {
      const partialEquipId = await makeEquipment("partial");
      await createSchedule(partialEquipId, 30);
      // Insert only IQ — OQ and PQ still missing.
      const [sig] = await db
        .insert(schema.electronicSignatures)
        .values({
          userId: qaId,
          meaning: "EQUIPMENT_QUALIFIED",
          entityType: "equipment",
          entityId: partialEquipId,
          fullNameAtSigning: "Test QA",
          titleAtSigning: "QC Manager",
          requestId: `r03g-partial-${Date.now()}`,
          manifestationJson: { meaning: "EQUIPMENT_QUALIFIED" },
        })
        .returning();
      await db.insert(schema.equipmentQualifications).values({
        equipmentId: partialEquipId,
        type: "IQ",
        status: "QUALIFIED",
        validFrom: isoDate(-1),
        validUntil: isoDate(365),
        signatureId: sig!.id,
      });

      const err = await runAllGates(db, batchId, productAId, [partialEquipId]).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).code).toBe("EQUIPMENT_NOT_QUALIFIED");
      const payload = (err as GateError).payload as {
        equipment: Array<{ missingTypes: string[] }>;
      };
      expect(payload.equipment[0]!.missingTypes.sort()).toEqual(["OQ", "PQ"]);
    });
  });

  describe("LINE_CLEARANCE_MISSING", () => {
    it("throws when prior APPROVED BPR was a different product and no clearance exists", async () => {
      // Use a fresh equipment so we control the prior-BPR history precisely.
      const lcEquipId = await makeEquipment("lc-missing");
      await createSchedule(lcEquipId, 30);
      await qualifyAll(lcEquipId);

      // Wire a prior APPROVED BPR for productB on this equipment.
      await makeBpr(priorBatchId, productBId, "APPROVED", new Date(Date.now() - 60_000));
      await db.insert(schema.productionBatchEquipmentUsed).values({
        productionBatchId: priorBatchId,
        equipmentId: lcEquipId,
      });

      // Attempt to start a productA batch on the same equipment — clearance
      // required, none exists.
      const err = await runAllGates(db, batchId, productAId, [lcEquipId]).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).code).toBe("LINE_CLEARANCE_MISSING");
      const payload = (err as GateError).payload as {
        equipment: Array<{ assetTag: string; fromProductId: string; toProductId: string }>;
      };
      expect(payload.equipment).toHaveLength(1);
      expect(payload.equipment[0]!.fromProductId).toBe(productBId);
      expect(payload.equipment[0]!.toProductId).toBe(productAId);

      // Cleanup the cross-test rows so other tests start clean.
      await db
        .delete(schema.productionBatchEquipmentUsed)
        .where(eq(schema.productionBatchEquipmentUsed.equipmentId, lcEquipId));
      await db
        .delete(schema.batchProductionRecords)
        .where(eq(schema.batchProductionRecords.productionBatchId, priorBatchId));
    });

    it("passes for first-batch case (no prior APPROVED BPR on this equipment)", async () => {
      // Default equipId has no prior BPRs — happy path.
      await expect(
        runAllGates(db, batchId, productAId, [equipId]),
      ).resolves.toBeUndefined();
    });

    it("passes when prior APPROVED BPR was the SAME product (no changeover)", async () => {
      const sameEquipId = await makeEquipment("lc-same");
      await createSchedule(sameEquipId, 30);
      await qualifyAll(sameEquipId);

      // Prior APPROVED BPR for productA, current batch also productA — no
      // changeover, gate should pass.
      const sameBatchId = await makeBatch(productAId);
      await makeBpr(sameBatchId, productAId, "APPROVED", new Date(Date.now() - 60_000));
      await db.insert(schema.productionBatchEquipmentUsed).values({
        productionBatchId: sameBatchId,
        equipmentId: sameEquipId,
      });

      await expect(
        runAllGates(db, batchId, productAId, [sameEquipId]),
      ).resolves.toBeUndefined();
    });

    it("passes when a clearance exists since the prior APPROVED batch's completion", async () => {
      const okEquipId = await makeEquipment("lc-ok");
      await createSchedule(okEquipId, 30);
      await qualifyAll(okEquipId);

      // Prior APPROVED BPR for productB completed 2 minutes ago.
      const priorCompletedAt = new Date(Date.now() - 120_000);
      const okPriorBatchId = await makeBatch(productBId);
      await makeBpr(okPriorBatchId, productBId, "APPROVED", priorCompletedAt);
      await db.insert(schema.productionBatchEquipmentUsed).values({
        productionBatchId: okPriorBatchId,
        equipmentId: okEquipId,
      });

      // Insert a line-clearance row for productA on this equipment, dated
      // AFTER the prior batch's completion. We need a signature row first
      // because lineClearances.signatureId is NOT NULL.
      const [sig] = await db
        .insert(schema.electronicSignatures)
        .values({
          userId: qaId,
          meaning: "LINE_CLEARANCE",
          entityType: "equipment",
          entityId: okEquipId,
          fullNameAtSigning: "Test QA",
          titleAtSigning: "QC Manager",
          requestId: `r03g-lc-${Date.now()}`,
          manifestationJson: { meaning: "LINE_CLEARANCE" },
        })
        .returning();
      await db.insert(schema.lineClearances).values({
        equipmentId: okEquipId,
        productChangeFromId: productBId,
        productChangeToId: productAId,
        performedAt: new Date(Date.now() - 30_000), // 30s ago, after prior at -120s
        performedByUserId: qaId,
        signatureId: sig!.id,
      });

      await expect(
        runAllGates(db, batchId, productAId, [okEquipId]),
      ).resolves.toBeUndefined();
    });

    it("throws LINE_CLEARANCE_MISSING when clearance was performed BEFORE prior batch completion (temporal cutoff)", async () => {
      // Prior batch completed at T=-60s
      // Clearance performed at T=-120s (BEFORE prior batch completion)
      // Gate must FAIL — clearance must be NEWER than prior batch completion to count
      const cutoffEquipId = await makeEquipment("lc-cutoff");
      await createSchedule(cutoffEquipId, 30);
      await qualifyAll(cutoffEquipId);

      // Prior APPROVED BPR for productB completed 60s ago.
      const priorCompletedAt = new Date(Date.now() - 60_000);
      const cutoffPriorBatchId = await makeBatch(productBId);
      await makeBpr(cutoffPriorBatchId, productBId, "APPROVED", priorCompletedAt);
      await db.insert(schema.productionBatchEquipmentUsed).values({
        productionBatchId: cutoffPriorBatchId,
        equipmentId: cutoffEquipId,
      });

      // Insert a clearance row dated BEFORE prior batch completion (T=-120s).
      // findClearance must reject this because it's older than the cutoff.
      const [sig] = await db
        .insert(schema.electronicSignatures)
        .values({
          userId: qaId,
          meaning: "LINE_CLEARANCE",
          entityType: "equipment",
          entityId: cutoffEquipId,
          fullNameAtSigning: "Test QA",
          titleAtSigning: "QC Manager",
          requestId: `r03g-lc-cutoff-${Date.now()}`,
          manifestationJson: { meaning: "LINE_CLEARANCE" },
        })
        .returning();
      await db.insert(schema.lineClearances).values({
        equipmentId: cutoffEquipId,
        productChangeFromId: productBId,
        productChangeToId: productAId,
        performedAt: new Date(Date.now() - 120_000), // BEFORE prior at -60s
        performedByUserId: qaId,
        signatureId: sig!.id,
      });

      const err = await runAllGates(db, batchId, productAId, [cutoffEquipId]).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).code).toBe("LINE_CLEARANCE_MISSING");
      const payload = (err as GateError).payload as {
        equipment: Array<{ assetTag: string; fromProductId: string; toProductId: string }>;
      };
      expect(payload.equipment).toHaveLength(1);
      expect(payload.equipment[0]!.fromProductId).toBe(productBId);
      expect(payload.equipment[0]!.toProductId).toBe(productAId);
    });
  });

  describe("Gate ordering (first-failure semantics)", () => {
    it("CALIBRATION_OVERDUE wins when both calibration and qualification would fail", async () => {
      // Equipment with overdue calibration AND no qualifications. The gate
      // order is calibration → qualification → line-clearance, so we expect
      // CALIBRATION_OVERDUE.
      const dualFailEquipId = await makeEquipment("dual-fail");
      await db.insert(schema.calibrationSchedules).values({
        equipmentId: dualFailEquipId,
        frequencyDays: 365,
        nextDueAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // overdue
      });
      // No qualifications inserted — would fail qualification gate too.

      const err = await runAllGates(db, batchId, productAId, [dualFailEquipId]).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).code).toBe("CALIBRATION_OVERDUE");
    });

    it("EQUIPMENT_NOT_QUALIFIED wins over LINE_CLEARANCE_MISSING when both would fail", async () => {
      // Equipment with cal future, NO qualifications, AND a missing line-clearance
      // precondition (prior APPROVED BPR for a different product, no clearance).
      // Order is qualification → line-clearance, so we expect EQUIPMENT_NOT_QUALIFIED.
      const qLcEquipId = await makeEquipment("q-vs-lc");
      await createSchedule(qLcEquipId, 30);
      // No qualifications — would fail qualification gate.

      // Wire a prior APPROVED BPR for productB on this equipment with no clearance.
      const qLcPriorBatchId = await makeBatch(productBId);
      await makeBpr(qLcPriorBatchId, productBId, "APPROVED", new Date(Date.now() - 60_000));
      await db.insert(schema.productionBatchEquipmentUsed).values({
        productionBatchId: qLcPriorBatchId,
        equipmentId: qLcEquipId,
      });

      const err = await runAllGates(db, batchId, productAId, [qLcEquipId]).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).code).toBe("EQUIPMENT_NOT_QUALIFIED");
    });

    it("CALIBRATION_OVERDUE wins over LINE_CLEARANCE_MISSING when both would fail", async () => {
      // Equipment with overdue calibration, IQ/OQ/PQ qualified, AND a missing
      // line-clearance precondition. Order is calibration → line-clearance,
      // so we expect CALIBRATION_OVERDUE.
      const cLcEquipId = await makeEquipment("c-vs-lc");
      await db.insert(schema.calibrationSchedules).values({
        equipmentId: cLcEquipId,
        frequencyDays: 365,
        nextDueAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // overdue
      });
      await qualifyAll(cLcEquipId);

      // Wire a prior APPROVED BPR for productB on this equipment with no clearance.
      const cLcPriorBatchId = await makeBatch(productBId);
      await makeBpr(cLcPriorBatchId, productBId, "APPROVED", new Date(Date.now() - 60_000));
      await db.insert(schema.productionBatchEquipmentUsed).values({
        productionBatchId: cLcPriorBatchId,
        equipmentId: cLcEquipId,
      });

      const err = await runAllGates(db, batchId, productAId, [cLcEquipId]).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).code).toBe("CALIBRATION_OVERDUE");
    });
  });
});
