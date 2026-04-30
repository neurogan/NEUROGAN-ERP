import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

vi.mock("../email/resend", () => ({
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
}));

import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";

import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const VALID_PASSWORD = "Neurogan1!Secure";

describeIfDb("R-08 — BPR hardening", () => {
  let app: Express;
  let qaId: string;
  let operatorId: string;
  let productId: string;

  // IDs to clean up
  const toDelete = {
    users: [] as string[],
    products: [] as string[],
    batches: [] as string[],
    bprs: [] as string[],
    cleaningLogs: [] as string[],
    signatures: [] as string[],
  };

  beforeAll(async () => {
    app = await buildTestApp();

    // Seed QA user
    const [qa] = await db
      .insert(schema.users)
      .values({
        email: `r08-qa-${Date.now()}@test.com`,
        fullName: "R08 QA",
        passwordHash: await hashPassword(VALID_PASSWORD),
        createdByUserId: null as unknown as string,
        status: "ACTIVE",
      })
      .returning();
    qaId = qa!.id;
    toDelete.users.push(qaId);
    await db.insert(schema.userRoles).values({ userId: qaId, role: "QA", grantedByUserId: qaId });

    // Force passwordChangedAt to avoid rotation gate
    await db.update(schema.users).set({ passwordChangedAt: new Date() }).where(eq(schema.users.id, qaId));

    // Seed operator user (cleanedBy in cleaning logs — distinct from QA verifier)
    const [op] = await db
      .insert(schema.users)
      .values({
        email: `r08-op-${Date.now()}@test.com`,
        fullName: "R08 Operator",
        passwordHash: await hashPassword(VALID_PASSWORD),
        createdByUserId: null as unknown as string,
        status: "ACTIVE",
      })
      .returning();
    operatorId = op!.id;
    toDelete.users.push(operatorId);

    // Seed product
    const [p] = await db
      .insert(schema.products)
      .values({ name: `R08-product-${Date.now()}`, sku: `R08-${Date.now()}`, category: "ACTIVE_INGREDIENT", defaultUom: "kg" })
      .returning();
    productId = p!.id;
    toDelete.products.push(productId);
  });

  afterAll(async () => {
    // Clean up in reverse FK order
    for (const id of toDelete.bprs) {
      await db.delete(schema.bprDeviations).where(eq(schema.bprDeviations.bprId, id)).catch(() => {});
    }
    for (const id of toDelete.bprs) {
      await db.delete(schema.batchProductionRecords).where(eq(schema.batchProductionRecords.id, id)).catch(() => {});
    }
    for (const id of toDelete.batches) {
      await db.delete(schema.productionBatches).where(eq(schema.productionBatches.id, id)).catch(() => {});
    }
    for (const id of toDelete.cleaningLogs) {
      await db.delete(schema.cleaningLogs).where(eq(schema.cleaningLogs.id, id)).catch(() => {});
    }
    for (const id of toDelete.signatures) {
      await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.id, id)).catch(() => {});
    }
    for (const id of toDelete.products) {
      await db.delete(schema.products).where(eq(schema.products.id, id)).catch(() => {});
    }
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, qaId)).catch(() => {});
    for (const id of toDelete.users) {
      await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.userId, id)).catch(() => {});
      await db.delete(schema.users).where(eq(schema.users.id, id)).catch(() => {});
    }
  });

  // Helper: seed a fresh BPR in IN_PROGRESS state
  async function seedBpr(opts: { withCleaningLog?: boolean } = {}): Promise<{ batchId: string; bprId: string; cleaningLogId?: string }> {
    const sfx = Date.now() + Math.random();
    const [batch] = await db
      .insert(schema.productionBatches)
      .values({
        batchNumber: `R08-BATCH-${sfx}`,
        productId,
        status: "IN_PROGRESS",
        plannedQuantity: "100",
        plannedUom: "units",
      })
      .returning();
    toDelete.batches.push(batch!.id);

    // Seed a cleaning log if requested — use the API so the signature ceremony runs correctly
    let cleaningLogId: string | undefined;
    if (opts.withCleaningLog) {
      const [equip] = await db
        .insert(schema.equipment)
        .values({ assetTag: `R08-EQ-${sfx}`, name: "R08 Mixer" })
        .returning();
      const clRes = await request(app)
        .post(`/api/equipment/${equip!.id}/cleaning-logs`)
        .set("x-test-user-id", qaId)
        .send({
          cleanedByUserId: operatorId,
          verifiedByUserId: qaId,
          method: "WFI rinse",
          signaturePassword: VALID_PASSWORD,
        });
      if (clRes.status !== 201) throw new Error(`Failed to seed cleaning log: ${JSON.stringify(clRes.body)}`);
      cleaningLogId = (clRes.body as { id: string }).id;
      toDelete.cleaningLogs.push(cleaningLogId);
    }

    const [bpr] = await db
      .insert(schema.batchProductionRecords)
      .values({
        productionBatchId: batch!.id,
        batchNumber: batch!.batchNumber,
        productId,
        status: "IN_PROGRESS",
        cleaningLogId: cleaningLogId ?? null,
      })
      .returning();
    toDelete.bprs.push(bpr!.id);

    return { batchId: batch!.id, bprId: bpr!.id, cleaningLogId };
  }

  // Helper: seed a label reconciliation so the other completion gates pass
  async function seedReconciliation(bprId: string) {
    await db.insert(schema.labelReconciliations).values({
      bprId,
      issuedCount: 100,
      usedCount: 98,
      destroyedCount: 2,
      variance: 0,
      toleranceExceeded: false,
    }).catch(() => {}); // ignore if already exists
  }

  // ── CLEANING_LOG_MISSING gate ─────────────────────────────────────────────

  describe("CLEANING_LOG_MISSING completion gate", () => {
    it("blocks submit-for-review when cleaningLogId is NULL", async () => {
      const { bprId } = await seedBpr({ withCleaningLog: false });
      await seedReconciliation(bprId);

      const res = await request(app)
        .post(`/api/batch-production-records/${bprId}/submit-for-review`)
        .set("x-test-user-id", qaId);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CLEANING_LOG_MISSING");
    });

    it("allows submit-for-review when cleaningLogId is set", async () => {
      const { bprId } = await seedBpr({ withCleaningLog: true });
      await seedReconciliation(bprId);

      const res = await request(app)
        .post(`/api/batch-production-records/${bprId}/submit-for-review`)
        .set("x-test-user-id", qaId);

      // 200 means it transitioned — cleaning gate passed
      expect(res.status).toBe(200);
    });
  });

  // ── Deviation sign-off endpoint ───────────────────────────────────────────

  describe("POST /deviations/:id/review", () => {
    let devBprId: string;
    let deviationId: string;

    beforeEach(async () => {
      const seeded = await seedBpr({ withCleaningLog: false });
      devBprId = seeded.bprId;

      const [dev] = await db
        .insert(schema.bprDeviations)
        .values({
          bprId: devBprId,
          deviationDescription: "Test deviation for R-08",
          reportedBy: "test",
        })
        .returning();
      deviationId = dev!.id;
    });

    it("200: valid password signs the deviation; signatureId set in DB", async () => {
      const res = await request(app)
        .post(`/api/batch-production-records/${devBprId}/deviations/${deviationId}/review`)
        .set("x-test-user-id", qaId)
        .send({ password: VALID_PASSWORD, commentary: "Reviewed and accepted" });

      expect(res.status).toBe(200);

      const [row] = await db
        .select({ signatureId: schema.bprDeviations.signatureId })
        .from(schema.bprDeviations)
        .where(eq(schema.bprDeviations.id, deviationId));
      expect(row?.signatureId).toBeTruthy();
    });

    it("401: wrong password is rejected", async () => {
      const res = await request(app)
        .post(`/api/batch-production-records/${devBprId}/deviations/${deviationId}/review`)
        .set("x-test-user-id", qaId)
        .send({ password: "WrongPassword1!" });

      expect(res.status).toBe(401);
    });

    it("409 ALREADY_SIGNED: cannot re-sign a signed deviation", async () => {
      // Sign it once
      await request(app)
        .post(`/api/batch-production-records/${devBprId}/deviations/${deviationId}/review`)
        .set("x-test-user-id", qaId)
        .send({ password: VALID_PASSWORD });

      // Sign again
      const res = await request(app)
        .post(`/api/batch-production-records/${devBprId}/deviations/${deviationId}/review`)
        .set("x-test-user-id", qaId)
        .send({ password: VALID_PASSWORD });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ALREADY_SIGNED");
    });

    it("404: unknown deviation id", async () => {
      const res = await request(app)
        .post(`/api/batch-production-records/${devBprId}/deviations/00000000-0000-0000-0000-000000000000/review`)
        .set("x-test-user-id", qaId)
        .send({ password: VALID_PASSWORD });

      expect(res.status).toBe(404);
    });
  });

  // ── DEVIATIONS_UNSIGNED gate on QC approval ───────────────────────────────

  describe("DEVIATIONS_UNSIGNED gate on qc-review", () => {
    it("409 DEVIATIONS_UNSIGNED: cannot approve BPR with unsigned deviation", async () => {
      const { bprId } = await seedBpr({ withCleaningLog: true });
      await seedReconciliation(bprId);

      // Submit for review
      await request(app)
        .post(`/api/batch-production-records/${bprId}/submit-for-review`)
        .set("x-test-user-id", qaId);

      // Add an unsigned deviation
      await db.insert(schema.bprDeviations).values({
        bprId,
        deviationDescription: "Unsigned deviation blocking approval",
        reportedBy: "test",
      });

      const res = await request(app)
        .post(`/api/batch-production-records/${bprId}/qc-review`)
        .set("x-test-user-id", qaId)
        .send({ disposition: "APPROVED_FOR_DISTRIBUTION", password: VALID_PASSWORD });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("DEVIATIONS_UNSIGNED");
      expect(Array.isArray(res.body.deviationIds)).toBe(true);
      expect(res.body.deviationIds.length).toBe(1);
    });

    it("allows QC approval when all deviations are signed", async () => {
      const { bprId } = await seedBpr({ withCleaningLog: true });
      await seedReconciliation(bprId);

      // Submit for review
      await request(app)
        .post(`/api/batch-production-records/${bprId}/submit-for-review`)
        .set("x-test-user-id", qaId);

      // Add a deviation and sign it
      const [dev] = await db
        .insert(schema.bprDeviations)
        .values({ bprId, deviationDescription: "Signed deviation", reportedBy: "test" })
        .returning();

      await request(app)
        .post(`/api/batch-production-records/${bprId}/deviations/${dev!.id}/review`)
        .set("x-test-user-id", qaId)
        .send({ password: VALID_PASSWORD });

      const res = await request(app)
        .post(`/api/batch-production-records/${bprId}/qc-review`)
        .set("x-test-user-id", qaId)
        .send({ disposition: "APPROVED_FOR_DISTRIBUTION", password: VALID_PASSWORD });

      expect(res.status).toBe(200);
    });

    it("allows QC approval when BPR has no deviations", async () => {
      const { bprId } = await seedBpr({ withCleaningLog: true });
      await seedReconciliation(bprId);

      await request(app)
        .post(`/api/batch-production-records/${bprId}/submit-for-review`)
        .set("x-test-user-id", qaId);

      const res = await request(app)
        .post(`/api/batch-production-records/${bprId}/qc-review`)
        .set("x-test-user-id", qaId)
        .send({ disposition: "APPROVED_FOR_DISTRIBUTION", password: VALID_PASSWORD });

      expect(res.status).toBe(200);
    });
  });
});
