import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";
import { eq, inArray } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;
const VALID_PASSWORD = "Neurogan1!Secure";

let app: Express;
let adminId: string, qaId: string, whId: string;
const createdEquipmentIds: string[] = [];

beforeAll(async () => {
  if (!dbUrl) return;
  app = await buildTestApp();
  const sfx = Date.now();

  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r03c-adm-${sfx}@t.com`,
      fullName: "R03C Admin",
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
      email: `r03c-qa-${sfx}@t.com`,
      fullName: "R03C QA",
      title: "QC Manager",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  qaId = qa!.id;
  await db
    .insert(schema.userRoles)
    .values({ userId: qaId, role: "QA", grantedByUserId: adminId });

  const [wh] = await db
    .insert(schema.users)
    .values({
      email: `r03c-wh-${sfx}@t.com`,
      fullName: "R03C WH",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  whId = wh!.id;
  await db
    .insert(schema.userRoles)
    .values({ userId: whId, role: "WAREHOUSE", grantedByUserId: adminId });
});

afterAll(async () => {
  if (!dbUrl) return;
  // FK order: schedules.lastRecordId → records → schedules → records →
  // signatures → audit → equipment → userRoles → users
  for (const id of createdEquipmentIds) {
    // Null out lastRecordId so we can delete records first (FK cycle).
    await db
      .update(schema.calibrationSchedules)
      .set({ lastRecordId: null })
      .where(eq(schema.calibrationSchedules.equipmentId, id))
      .catch(() => {});
    await db
      .delete(schema.calibrationRecords)
      .where(eq(schema.calibrationRecords.equipmentId, id))
      .catch(() => {});
    await db
      .delete(schema.calibrationSchedules)
      .where(eq(schema.calibrationSchedules.equipmentId, id))
      .catch(() => {});
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, id)).catch(() => {});
    await db
      .delete(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, id))
      .catch(() => {});
    await db.delete(schema.equipment).where(eq(schema.equipment.id, id)).catch(() => {});
  }
  for (const uid of [adminId, qaId, whId]) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, uid)).catch(() => {});
    await db
      .delete(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.userId, uid))
      .catch(() => {});
    await db
      .delete(schema.calibrationRecords)
      .where(eq(schema.calibrationRecords.performedByUserId, uid))
      .catch(() => {});
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, uid)).catch(() => {});
    await db.delete(schema.users).where(eq(schema.users.id, uid)).catch(() => {});
  }
  // Defensive: clean any straggler equipment.
  if (createdEquipmentIds.length > 0) {
    await db
      .delete(schema.equipment)
      .where(inArray(schema.equipment.id, createdEquipmentIds))
      .catch(() => {});
  }
});

async function createEquipment(tagSuffix: string): Promise<string> {
  const tag = `R03C-${tagSuffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const res = await request(app)
    .post("/api/equipment")
    .set("x-test-user-id", adminId)
    .send({ assetTag: tag, name: "CalibEquip" });
  if (res.status !== 201) {
    throw new Error(`createEquipment failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const id = (res.body as { id: string }).id;
  createdEquipmentIds.push(id);
  return id;
}

describeIfDb("R-03 calibration schedules + records", () => {
  it("POST /api/equipment/:id/calibration-schedule — creates schedule with frequencyDays=90; nextDueAt ~90 days from now", async () => {
    const equipId = await createEquipment("sched");
    const before = Date.now();
    const res = await request(app)
      .post(`/api/equipment/${equipId}/calibration-schedule`)
      .set("x-test-user-id", adminId)
      .send({ frequencyDays: 90 });
    expect(res.status).toBe(201);
    const body = res.body as {
      id: string;
      equipmentId: string;
      frequencyDays: number;
      nextDueAt: string;
    };
    expect(body.equipmentId).toBe(equipId);
    expect(body.frequencyDays).toBe(90);
    const nextDueMs = new Date(body.nextDueAt).getTime();
    const expected = before + 90 * 24 * 60 * 60 * 1000;
    // Allow 60s tolerance for clock skew.
    expect(Math.abs(nextDueMs - expected)).toBeLessThan(60_000);
  });

  it("POST /api/equipment/:id/calibration-schedule — duplicate returns 409", async () => {
    const equipId = await createEquipment("dup");
    const r1 = await request(app)
      .post(`/api/equipment/${equipId}/calibration-schedule`)
      .set("x-test-user-id", adminId)
      .send({ frequencyDays: 30 });
    expect(r1.status).toBe(201);

    const r2 = await request(app)
      .post(`/api/equipment/${equipId}/calibration-schedule`)
      .set("x-test-user-id", adminId)
      .send({ frequencyDays: 60 });
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe("DUPLICATE_CALIBRATION_SCHEDULE");
  });

  it("POST /api/equipment/:id/calibration-schedule — 400 when frequencyDays missing or <=0", async () => {
    const equipId = await createEquipment("badfreq");
    const r1 = await request(app)
      .post(`/api/equipment/${equipId}/calibration-schedule`)
      .set("x-test-user-id", adminId)
      .send({});
    expect(r1.status).toBe(400);

    const r2 = await request(app)
      .post(`/api/equipment/${equipId}/calibration-schedule`)
      .set("x-test-user-id", adminId)
      .send({ frequencyDays: 0 });
    expect(r2.status).toBe(400);

    const r3 = await request(app)
      .post(`/api/equipment/${equipId}/calibration-schedule`)
      .set("x-test-user-id", adminId)
      .send({ frequencyDays: -5 });
    expect(r3.status).toBe(400);
  });

  it("POST /api/equipment/:id/calibration — PASS bumps nextDueAt by frequencyDays", async () => {
    const equipId = await createEquipment("pass");
    const sched = await request(app)
      .post(`/api/equipment/${equipId}/calibration-schedule`)
      .set("x-test-user-id", adminId)
      .send({ frequencyDays: 30 });
    expect(sched.status).toBe(201);
    const originalDue = new Date((sched.body as { nextDueAt: string }).nextDueAt).getTime();

    const beforeCal = Date.now();
    const cal = await request(app)
      .post(`/api/equipment/${equipId}/calibration`)
      .set("x-test-user-id", qaId)
      .send({ result: "PASS", signaturePassword: VALID_PASSWORD, notes: "annual cal" });
    expect(cal.status).toBe(201);
    const calBody = cal.body as { id: string; result: string; signatureId: string };
    expect(calBody.result).toBe("PASS");
    expect(calBody.signatureId).toBeTruthy();

    const after = await request(app)
      .get(`/api/equipment/${equipId}/calibration`)
      .set("x-test-user-id", whId);
    expect(after.status).toBe(200);
    const status = after.body as {
      schedule: { nextDueAt: string; lastRecordId: string };
      records: Array<{ id: string; result: string }>;
    };
    const newDueMs = new Date(status.schedule.nextDueAt).getTime();
    const expected = beforeCal + 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(newDueMs - expected)).toBeLessThan(60_000);
    // Schedule bumped, not unchanged.
    expect(newDueMs).toBeGreaterThan(originalDue - 60_000);
    expect(status.schedule.lastRecordId).toBe(calBody.id);
    expect(status.records.length).toBe(1);
    expect(status.records[0]!.result).toBe("PASS");
  });

  it("POST /api/equipment/:id/calibration — FAIL leaves nextDueAt unchanged", async () => {
    const equipId = await createEquipment("fail");
    const sched = await request(app)
      .post(`/api/equipment/${equipId}/calibration-schedule`)
      .set("x-test-user-id", adminId)
      .send({ frequencyDays: 30 });
    expect(sched.status).toBe(201);
    const originalDue = (sched.body as { nextDueAt: string }).nextDueAt;

    const cal = await request(app)
      .post(`/api/equipment/${equipId}/calibration`)
      .set("x-test-user-id", qaId)
      .send({ result: "FAIL", signaturePassword: VALID_PASSWORD, notes: "out of tol" });
    expect(cal.status).toBe(201);

    const after = await request(app)
      .get(`/api/equipment/${equipId}/calibration`)
      .set("x-test-user-id", whId);
    expect(after.status).toBe(200);
    const status = after.body as {
      schedule: { nextDueAt: string; lastRecordId: string | null };
      records: Array<{ result: string }>;
    };
    expect(status.schedule.nextDueAt).toBe(originalDue);
    // FAIL must not advance lastRecordId either.
    expect(status.schedule.lastRecordId).toBeNull();
    expect(status.records.length).toBe(1);
    expect(status.records[0]!.result).toBe("FAIL");
  });

  it("POST /api/equipment/:id/calibration — without signaturePassword → 400 SIGNATURE_REQUIRED", async () => {
    const equipId = await createEquipment("nopwd");
    const res = await request(app)
      .post(`/api/equipment/${equipId}/calibration`)
      .set("x-test-user-id", qaId)
      .send({ result: "PASS" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SIGNATURE_REQUIRED");
  });

  it("POST /api/equipment/:id/calibration — wrong password → 401 UNAUTHENTICATED, no row written", async () => {
    const equipId = await createEquipment("wrongpw");
    const res = await request(app)
      .post(`/api/equipment/${equipId}/calibration`)
      .set("x-test-user-id", qaId)
      .send({ result: "PASS", signaturePassword: "WrongPassword123!" });
    expect(res.status).toBe(401);
    expect(res.body?.error?.code).toBe("UNAUTHENTICATED");

    const rows = await db
      .select()
      .from(schema.calibrationRecords)
      .where(eq(schema.calibrationRecords.equipmentId, equipId));
    expect(rows.length).toBe(0);
  });

  it("POST /api/equipment/:id/calibration — 403 for WAREHOUSE", async () => {
    const equipId = await createEquipment("wh-403");
    const res = await request(app)
      .post(`/api/equipment/${equipId}/calibration`)
      .set("x-test-user-id", whId)
      .send({ result: "PASS", signaturePassword: VALID_PASSWORD });
    expect(res.status).toBe(403);
  });

  it("POST /api/equipment/:id/calibration — 404 for unknown equipment", async () => {
    const res = await request(app)
      .post("/api/equipment/00000000-0000-0000-0000-000000000000/calibration")
      .set("x-test-user-id", qaId)
      .send({ result: "PASS", signaturePassword: VALID_PASSWORD });
    expect(res.status).toBe(404);
  });

  it("GET /api/equipment/:id/calibration — returns { schedule, records } sorted desc by performedAt", async () => {
    const equipId = await createEquipment("history");
    const sched = await request(app)
      .post(`/api/equipment/${equipId}/calibration-schedule`)
      .set("x-test-user-id", adminId)
      .send({ frequencyDays: 30 });
    expect(sched.status).toBe(201);

    // Three records: FAIL, then PASS, then PASS.
    const r1 = await request(app)
      .post(`/api/equipment/${equipId}/calibration`)
      .set("x-test-user-id", qaId)
      .send({ result: "FAIL", signaturePassword: VALID_PASSWORD });
    expect(r1.status).toBe(201);
    // Tiny delay to guarantee distinct performedAt values.
    await new Promise((r) => setTimeout(r, 10));
    const r2 = await request(app)
      .post(`/api/equipment/${equipId}/calibration`)
      .set("x-test-user-id", qaId)
      .send({ result: "PASS", signaturePassword: VALID_PASSWORD });
    expect(r2.status).toBe(201);
    await new Promise((r) => setTimeout(r, 10));
    const r3 = await request(app)
      .post(`/api/equipment/${equipId}/calibration`)
      .set("x-test-user-id", qaId)
      .send({ result: "PASS", signaturePassword: VALID_PASSWORD });
    expect(r3.status).toBe(201);

    const list = await request(app)
      .get(`/api/equipment/${equipId}/calibration`)
      .set("x-test-user-id", whId);
    expect(list.status).toBe(200);
    const status = list.body as {
      schedule: { id: string };
      records: Array<{ id: string; performedAt: string; result: string }>;
    };
    expect(status.schedule).toBeTruthy();
    expect(status.records.length).toBe(3);
    // Newest first.
    const t0 = new Date(status.records[0]!.performedAt).getTime();
    const t1 = new Date(status.records[1]!.performedAt).getTime();
    const t2 = new Date(status.records[2]!.performedAt).getTime();
    expect(t0).toBeGreaterThanOrEqual(t1);
    expect(t1).toBeGreaterThanOrEqual(t2);
  });

  it("GET /api/equipment/:id/calibration — returns null schedule when none exists", async () => {
    const equipId = await createEquipment("noschedule");
    const res = await request(app)
      .get(`/api/equipment/${equipId}/calibration`)
      .set("x-test-user-id", whId);
    expect(res.status).toBe(200);
    const body = res.body as {
      schedule: unknown;
      records: unknown[];
    };
    expect(body.schedule).toBeNull();
    expect(Array.isArray(body.records)).toBe(true);
    expect(body.records.length).toBe(0);
  });

  it("CALIBRATION_RECORDED signature + CALIBRATION_LOGGED audit are written for each record", async () => {
    const equipId = await createEquipment("audit");
    const sched = await request(app)
      .post(`/api/equipment/${equipId}/calibration-schedule`)
      .set("x-test-user-id", adminId)
      .send({ frequencyDays: 30 });
    expect(sched.status).toBe(201);

    const cal = await request(app)
      .post(`/api/equipment/${equipId}/calibration`)
      .set("x-test-user-id", qaId)
      .send({ result: "PASS", signaturePassword: VALID_PASSWORD, commentary: "Initial" });
    expect(cal.status).toBe(201);

    const sigs = await db
      .select()
      .from(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, equipId));
    expect(sigs.some((s) => s.meaning === "CALIBRATION_RECORDED")).toBe(true);

    const audit = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, equipId));
    expect(audit.some((a) => a.action === "CALIBRATION_LOGGED")).toBe(true);
    expect(audit.some((a) => a.action === "SIGN")).toBe(true);
  });
});
