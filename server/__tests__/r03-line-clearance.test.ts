import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";
import { eq, inArray } from "drizzle-orm";
import { findClearance } from "../storage/cleaning-line-clearance";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;
const VALID_PASSWORD = "Neurogan1!Secure";

let app: Express;
let adminId: string, qaId: string;
const createdEquipmentIds: string[] = [];

// Use stable but unique product change IDs (varchar in schema). Two distinct
// products so we can exercise both first-batch (no from) and changeover paths.
const PRODUCT_A = `r03lc-prod-a-${Date.now()}`;
const PRODUCT_B = `r03lc-prod-b-${Date.now()}`;

beforeAll(async () => {
  if (!dbUrl) return;
  app = await buildTestApp();
  const sfx = Date.now();

  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r03lc-adm-${sfx}@t.com`,
      fullName: "R03LC Admin",
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
      email: `r03lc-qa-${sfx}@t.com`,
      fullName: "R03LC QA",
      title: "QC Manager",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  qaId = qa!.id;
  await db
    .insert(schema.userRoles)
    .values({ userId: qaId, role: "QA", grantedByUserId: adminId });
});

afterAll(async () => {
  if (!dbUrl) return;
  // FK order: line_clearances → signatures → audit → equipment → userRoles → users.
  for (const id of createdEquipmentIds) {
    await db
      .delete(schema.lineClearances)
      .where(eq(schema.lineClearances.equipmentId, id))
      .catch(() => {});
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, id)).catch(() => {});
    await db
      .delete(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, id))
      .catch(() => {});
    await db.delete(schema.equipment).where(eq(schema.equipment.id, id)).catch(() => {});
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
  if (createdEquipmentIds.length > 0) {
    await db
      .delete(schema.equipment)
      .where(inArray(schema.equipment.id, createdEquipmentIds))
      .catch(() => {});
  }
});

async function createEquipment(tagSuffix: string): Promise<string> {
  const tag = `R03LC-${tagSuffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const res = await request(app)
    .post("/api/equipment")
    .set("x-test-user-id", adminId)
    .send({ assetTag: tag, name: "ClearEquip" });
  if (res.status !== 201) {
    throw new Error(`createEquipment failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const id = (res.body as { id: string }).id;
  createdEquipmentIds.push(id);
  return id;
}

describeIfDb("R-03 line clearances (F-04 product changeover)", () => {
  it("POST /api/equipment/:id/line-clearances — 201 on valid request; LINE_CLEARANCE signature + LINE_CLEARANCE_LOGGED audit + SIGN audit; findClearance returns the row", async () => {
    const equipId = await createEquipment("ok");
    const beforeRequest = new Date(Date.now() - 1000);

    const res = await request(app)
      .post(`/api/equipment/${equipId}/line-clearances`)
      .set("x-test-user-id", qaId)
      .send({
        productChangeFromId: PRODUCT_A,
        productChangeToId: PRODUCT_B,
        notes: "Changeover post-A run",
        signaturePassword: VALID_PASSWORD,
        commentary: "Cleared and inspected",
      });

    expect(res.status).toBe(201);
    const body = res.body as {
      id: string;
      equipmentId: string;
      productChangeFromId: string | null;
      productChangeToId: string;
      signatureId: string;
    };
    expect(body.equipmentId).toBe(equipId);
    expect(body.productChangeFromId).toBe(PRODUCT_A);
    expect(body.productChangeToId).toBe(PRODUCT_B);
    expect(body.signatureId).toBeTruthy();

    const sigs = await db
      .select()
      .from(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, equipId));
    expect(sigs.some((s) => s.meaning === "LINE_CLEARANCE")).toBe(true);

    const audit = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, equipId));
    expect(audit.some((a) => a.action === "LINE_CLEARANCE_LOGGED")).toBe(true);
    expect(audit.some((a) => a.action === "SIGN")).toBe(true);

    const lineClearanceAudit = audit.find((a) => a.action === "LINE_CLEARANCE_LOGGED");
    expect(lineClearanceAudit).toBeDefined();
    expect((lineClearanceAudit!.after as any).fromProductId).toBe(PRODUCT_A);
    expect((lineClearanceAudit!.after as any).toProductId).toBe(PRODUCT_B);

    const found = await findClearance(equipId, PRODUCT_B, beforeRequest);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(body.id);
  });

  it("POST /api/equipment/:id/line-clearances — 201 first-batch (no productChangeFromId); row stored with NULL from", async () => {
    const equipId = await createEquipment("first");
    const res = await request(app)
      .post(`/api/equipment/${equipId}/line-clearances`)
      .set("x-test-user-id", qaId)
      .send({
        productChangeToId: PRODUCT_B,
        signaturePassword: VALID_PASSWORD,
      });
    expect(res.status).toBe(201);
    const body = res.body as { id: string; productChangeFromId: string | null };
    expect(body.productChangeFromId).toBeNull();

    const [row] = await db
      .select()
      .from(schema.lineClearances)
      .where(eq(schema.lineClearances.id, body.id));
    expect(row!.productChangeFromId).toBeNull();
  });

  it("POST /api/equipment/:id/line-clearances — 400 when productChangeToId missing", async () => {
    const equipId = await createEquipment("noto");
    const res = await request(app)
      .post(`/api/equipment/${equipId}/line-clearances`)
      .set("x-test-user-id", qaId)
      .send({
        productChangeFromId: PRODUCT_A,
        signaturePassword: VALID_PASSWORD,
      });
    expect(res.status).toBe(400);
  });

  it("POST /api/equipment/:id/line-clearances — 400 when signaturePassword missing", async () => {
    const equipId = await createEquipment("nopwd");
    const res = await request(app)
      .post(`/api/equipment/${equipId}/line-clearances`)
      .set("x-test-user-id", qaId)
      .send({
        productChangeToId: PRODUCT_B,
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SIGNATURE_REQUIRED");
  });

  it("POST /api/equipment/:id/line-clearances — 401 UNAUTHENTICATED on wrong password; no row written", async () => {
    const equipId = await createEquipment("wrongpw");
    const res = await request(app)
      .post(`/api/equipment/${equipId}/line-clearances`)
      .set("x-test-user-id", qaId)
      .send({
        productChangeToId: PRODUCT_B,
        signaturePassword: "WrongPassword123!",
      });
    expect(res.status).toBe(401);
    expect(res.body?.error?.code).toBe("UNAUTHENTICATED");

    const rows = await db
      .select()
      .from(schema.lineClearances)
      .where(eq(schema.lineClearances.equipmentId, equipId));
    expect(rows.length).toBe(0);
  });

  it("POST /api/equipment/:id/line-clearances — 423 ACCOUNT_LOCKED when signing user is locked", async () => {
    const equipId = await createEquipment("locked");
    // Snapshot prior lock + failed-count state so we restore exactly what was
    // there (clobbering with 0 would corrupt other tests' baselines).
    const [priorRow] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, qaId));
    const priorLockedUntil = priorRow!.lockedUntil;
    const priorFailedCount = priorRow!.failedLoginCount;

    const future = new Date(Date.now() + 60 * 60 * 1000);
    await db
      .update(schema.users)
      .set({ lockedUntil: future })
      .where(eq(schema.users.id, qaId));

    try {
      const res = await request(app)
        .post(`/api/equipment/${equipId}/line-clearances`)
        .set("x-test-user-id", qaId)
        .send({
          productChangeToId: PRODUCT_B,
          signaturePassword: VALID_PASSWORD,
        });
      expect(res.status).toBe(423);
      expect(res.body?.error?.code).toBe("ACCOUNT_LOCKED");
    } finally {
      await db
        .update(schema.users)
        .set({ lockedUntil: priorLockedUntil, failedLoginCount: priorFailedCount })
        .where(eq(schema.users.id, qaId));
    }
  });

  it("POST /api/equipment/:id/line-clearances — 404 for unknown equipment", async () => {
    const res = await request(app)
      .post("/api/equipment/00000000-0000-0000-0000-000000000000/line-clearances")
      .set("x-test-user-id", qaId)
      .send({
        productChangeToId: PRODUCT_B,
        signaturePassword: VALID_PASSWORD,
      });
    expect(res.status).toBe(404);
  });

  it("GET /api/equipment/:id/line-clearances — returns history newest first by performedAt desc", async () => {
    const equipId = await createEquipment("history");

    const r1 = await request(app)
      .post(`/api/equipment/${equipId}/line-clearances`)
      .set("x-test-user-id", qaId)
      .send({
        productChangeFromId: PRODUCT_A,
        productChangeToId: PRODUCT_B,
        signaturePassword: VALID_PASSWORD,
      });
    expect(r1.status).toBe(201);

    await new Promise((r) => setTimeout(r, 10));
    const r2 = await request(app)
      .post(`/api/equipment/${equipId}/line-clearances`)
      .set("x-test-user-id", qaId)
      .send({
        productChangeFromId: PRODUCT_B,
        productChangeToId: PRODUCT_A,
        signaturePassword: VALID_PASSWORD,
      });
    expect(r2.status).toBe(201);

    const list = await request(app)
      .get(`/api/equipment/${equipId}/line-clearances`)
      .set("x-test-user-id", qaId);
    expect(list.status).toBe(200);
    const rows = list.body as Array<{ id: string; performedAt: string }>;
    expect(rows.length).toBe(2);
    const t0 = new Date(rows[0]!.performedAt).getTime();
    const t1 = new Date(rows[1]!.performedAt).getTime();
    expect(t0).toBeGreaterThanOrEqual(t1);
  });

  it("findClearance — returns null when `after` cutoff is in the future of the only matching row", async () => {
    const equipId = await createEquipment("cutoff");
    const res = await request(app)
      .post(`/api/equipment/${equipId}/line-clearances`)
      .set("x-test-user-id", qaId)
      .send({
        productChangeToId: PRODUCT_B,
        signaturePassword: VALID_PASSWORD,
      });
    expect(res.status).toBe(201);

    const future = new Date(Date.now() + 60_000);
    const found = await findClearance(equipId, PRODUCT_B, future);
    expect(found).toBeNull();
  });

  it("findClearance — returns the most recent matching row when multiple exist", async () => {
    const equipId = await createEquipment("multi");
    const beforeBoth = new Date(Date.now() - 60_000);

    const r1 = await request(app)
      .post(`/api/equipment/${equipId}/line-clearances`)
      .set("x-test-user-id", qaId)
      .send({
        productChangeToId: PRODUCT_B,
        signaturePassword: VALID_PASSWORD,
      });
    expect(r1.status).toBe(201);

    await new Promise((r) => setTimeout(r, 10));

    const r2 = await request(app)
      .post(`/api/equipment/${equipId}/line-clearances`)
      .set("x-test-user-id", qaId)
      .send({
        productChangeToId: PRODUCT_B,
        signaturePassword: VALID_PASSWORD,
      });
    expect(r2.status).toBe(201);

    const found = await findClearance(equipId, PRODUCT_B, beforeBoth);
    expect(found).not.toBeNull();
    expect(found!.id).toBe((r2.body as { id: string }).id);
  });
});
