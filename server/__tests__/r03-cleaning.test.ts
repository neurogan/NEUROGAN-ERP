import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";
import { eq, inArray, or } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;
const VALID_PASSWORD = "Neurogan1!Secure";

let app: Express;
let adminId: string, qaId: string, whId: string, opId: string;
const createdEquipmentIds: string[] = [];

beforeAll(async () => {
  if (!dbUrl) return;
  app = await buildTestApp();
  const sfx = Date.now();

  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r03cln-adm-${sfx}@t.com`,
      fullName: "R03Cln Admin",
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
      email: `r03cln-qa-${sfx}@t.com`,
      fullName: "R03Cln QA",
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
      email: `r03cln-wh-${sfx}@t.com`,
      fullName: "R03Cln WH",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  whId = wh!.id;
  await db
    .insert(schema.userRoles)
    .values({ userId: whId, role: "WAREHOUSE", grantedByUserId: adminId });

  // Operator (second non-QA user) so we can exercise cleanedBy=op, verifiedBy=qa.
  const [op] = await db
    .insert(schema.users)
    .values({
      email: `r03cln-op-${sfx}@t.com`,
      fullName: "R03Cln Operator",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  opId = op!.id;
  await db
    .insert(schema.userRoles)
    .values({ userId: opId, role: "WAREHOUSE", grantedByUserId: adminId });
});

afterAll(async () => {
  if (!dbUrl) return;
  // FK order: cleaning_logs (FK to users + equipment + signatures) →
  // signatures → audit → equipment → userRoles → users.
  for (const id of createdEquipmentIds) {
    await db
      .delete(schema.cleaningLogs)
      .where(eq(schema.cleaningLogs.equipmentId, id))
      .catch(() => {});
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, id)).catch(() => {});
    await db
      .delete(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, id))
      .catch(() => {});
    await db.delete(schema.equipment).where(eq(schema.equipment.id, id)).catch(() => {});
  }
  for (const uid of [adminId, qaId, whId, opId]) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, uid)).catch(() => {});
    await db
      .delete(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.userId, uid))
      .catch(() => {});
    // Cleaning logs may also reference these users via cleanedBy/verifiedBy
    // even after the equipment-keyed delete (defensive — should already be empty).
    await db
      .delete(schema.cleaningLogs)
      .where(or(eq(schema.cleaningLogs.cleanedByUserId, uid), eq(schema.cleaningLogs.verifiedByUserId, uid)))
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
  const tag = `R03CLN-${tagSuffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const res = await request(app)
    .post("/api/equipment")
    .set("x-test-user-id", adminId)
    .send({ assetTag: tag, name: "CleanEquip" });
  if (res.status !== 201) {
    throw new Error(`createEquipment failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const id = (res.body as { id: string }).id;
  createdEquipmentIds.push(id);
  return id;
}

describeIfDb("R-03 cleaning logs (F-05 dual-verification)", () => {
  it("POST /api/equipment/:id/cleaning-logs — 201 with two distinct users; signatureId set; CLEANING_VERIFIED signature + CLEANING_LOGGED audit written", async () => {
    const equipId = await createEquipment("ok");
    const res = await request(app)
      .post(`/api/equipment/${equipId}/cleaning-logs`)
      .set("x-test-user-id", qaId)
      .send({
        cleanedByUserId: opId,
        verifiedByUserId: qaId,
        method: "Wash + sanitize",
        signaturePassword: VALID_PASSWORD,
        commentary: "Post-batch cleaning",
      });
    expect(res.status).toBe(201);
    const body = res.body as {
      id: string;
      equipmentId: string;
      cleanedByUserId: string;
      verifiedByUserId: string;
      signatureId: string;
      method: string;
    };
    expect(body.equipmentId).toBe(equipId);
    expect(body.cleanedByUserId).toBe(opId);
    expect(body.verifiedByUserId).toBe(qaId);
    expect(body.signatureId).toBeTruthy();
    expect(body.method).toBe("Wash + sanitize");

    const sigs = await db
      .select()
      .from(schema.electronicSignatures)
      .where(eq(schema.electronicSignatures.entityId, equipId));
    expect(sigs.some((s) => s.meaning === "CLEANING_VERIFIED")).toBe(true);

    const audit = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, equipId));
    expect(audit.some((a) => a.action === "CLEANING_LOGGED")).toBe(true);
    expect(audit.some((a) => a.action === "SIGN")).toBe(true);
  });

  it("POST /api/equipment/:id/cleaning-logs — 409 IDENTITY_SAME when cleanedByUserId === verifiedByUserId", async () => {
    const equipId = await createEquipment("same");
    const res = await request(app)
      .post(`/api/equipment/${equipId}/cleaning-logs`)
      .set("x-test-user-id", qaId)
      .send({
        cleanedByUserId: qaId,
        verifiedByUserId: qaId,
        method: "Wash",
        signaturePassword: VALID_PASSWORD,
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("IDENTITY_SAME");

    // No row should have been written.
    const rows = await db
      .select()
      .from(schema.cleaningLogs)
      .where(eq(schema.cleaningLogs.equipmentId, equipId));
    expect(rows.length).toBe(0);
  });

  it("POST /api/equipment/:id/cleaning-logs — 400 when signaturePassword missing", async () => {
    const equipId = await createEquipment("nopwd");
    const res = await request(app)
      .post(`/api/equipment/${equipId}/cleaning-logs`)
      .set("x-test-user-id", qaId)
      .send({
        cleanedByUserId: opId,
        verifiedByUserId: qaId,
        method: "Wash",
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SIGNATURE_REQUIRED");
  });

  it("POST /api/equipment/:id/cleaning-logs — 400 when cleanedByUserId or verifiedByUserId missing", async () => {
    const equipId = await createEquipment("missing");
    const r1 = await request(app)
      .post(`/api/equipment/${equipId}/cleaning-logs`)
      .set("x-test-user-id", qaId)
      .send({ verifiedByUserId: qaId, signaturePassword: VALID_PASSWORD });
    expect(r1.status).toBe(400);

    const r2 = await request(app)
      .post(`/api/equipment/${equipId}/cleaning-logs`)
      .set("x-test-user-id", qaId)
      .send({ cleanedByUserId: opId, signaturePassword: VALID_PASSWORD });
    expect(r2.status).toBe(400);
  });

  it("POST /api/equipment/:id/cleaning-logs — 401 UNAUTHENTICATED on wrong password; no row written", async () => {
    const equipId = await createEquipment("wrongpw");
    const res = await request(app)
      .post(`/api/equipment/${equipId}/cleaning-logs`)
      .set("x-test-user-id", qaId)
      .send({
        cleanedByUserId: opId,
        verifiedByUserId: qaId,
        method: "Wash",
        signaturePassword: "WrongPassword123!",
      });
    expect(res.status).toBe(401);
    expect(res.body?.error?.code).toBe("UNAUTHENTICATED");

    const rows = await db
      .select()
      .from(schema.cleaningLogs)
      .where(eq(schema.cleaningLogs.equipmentId, equipId));
    expect(rows.length).toBe(0);
  });

  it("POST /api/equipment/:id/cleaning-logs — 423 ACCOUNT_LOCKED when signing user is locked", async () => {
    const equipId = await createEquipment("locked");
    // Lock the QA user temporarily.
    const future = new Date(Date.now() + 60 * 60 * 1000);
    await db
      .update(schema.users)
      .set({ lockedUntil: future })
      .where(eq(schema.users.id, qaId));

    try {
      const res = await request(app)
        .post(`/api/equipment/${equipId}/cleaning-logs`)
        .set("x-test-user-id", qaId)
        .send({
          cleanedByUserId: opId,
          verifiedByUserId: qaId,
          method: "Wash",
          signaturePassword: VALID_PASSWORD,
        });
      expect(res.status).toBe(423);
      expect(res.body?.error?.code).toBe("ACCOUNT_LOCKED");
    } finally {
      // Always unlock so other tests can sign.
      await db
        .update(schema.users)
        .set({ lockedUntil: null, failedLoginCount: 0 })
        .where(eq(schema.users.id, qaId));
    }
  });

  it("POST /api/equipment/:id/cleaning-logs — 404 for unknown equipment", async () => {
    const res = await request(app)
      .post("/api/equipment/00000000-0000-0000-0000-000000000000/cleaning-logs")
      .set("x-test-user-id", qaId)
      .send({
        cleanedByUserId: opId,
        verifiedByUserId: qaId,
        method: "Wash",
        signaturePassword: VALID_PASSWORD,
      });
    expect(res.status).toBe(404);
  });

  it("GET /api/equipment/:id/cleaning-logs — returns logs sorted by cleanedAt desc", async () => {
    const equipId = await createEquipment("history");

    const r1 = await request(app)
      .post(`/api/equipment/${equipId}/cleaning-logs`)
      .set("x-test-user-id", qaId)
      .send({
        cleanedByUserId: opId,
        verifiedByUserId: qaId,
        method: "Wash 1",
        signaturePassword: VALID_PASSWORD,
      });
    expect(r1.status).toBe(201);

    await new Promise((r) => setTimeout(r, 10));
    const r2 = await request(app)
      .post(`/api/equipment/${equipId}/cleaning-logs`)
      .set("x-test-user-id", qaId)
      .send({
        cleanedByUserId: whId,
        verifiedByUserId: qaId,
        method: "Wash 2",
        signaturePassword: VALID_PASSWORD,
      });
    expect(r2.status).toBe(201);

    await new Promise((r) => setTimeout(r, 10));
    const r3 = await request(app)
      .post(`/api/equipment/${equipId}/cleaning-logs`)
      .set("x-test-user-id", qaId)
      .send({
        cleanedByUserId: opId,
        verifiedByUserId: qaId,
        method: "Wash 3",
        signaturePassword: VALID_PASSWORD,
      });
    expect(r3.status).toBe(201);

    const list = await request(app)
      .get(`/api/equipment/${equipId}/cleaning-logs`)
      .set("x-test-user-id", whId);
    expect(list.status).toBe(200);
    const logs = list.body as Array<{ id: string; cleanedAt: string; method: string }>;
    expect(logs.length).toBe(3);
    const t0 = new Date(logs[0]!.cleanedAt).getTime();
    const t1 = new Date(logs[1]!.cleanedAt).getTime();
    const t2 = new Date(logs[2]!.cleanedAt).getTime();
    expect(t0).toBeGreaterThanOrEqual(t1);
    expect(t1).toBeGreaterThanOrEqual(t2);
  });

  it("GET /api/equipment/:id/cleaning-logs — returns empty array when no logs exist", async () => {
    const equipId = await createEquipment("empty");
    const res = await request(app)
      .get(`/api/equipment/${equipId}/cleaning-logs`)
      .set("x-test-user-id", whId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect((res.body as unknown[]).length).toBe(0);
  });
});
