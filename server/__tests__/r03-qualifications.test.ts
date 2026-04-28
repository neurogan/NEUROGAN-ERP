import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";
import { eq, inArray } from "drizzle-orm";
import { getActiveQualifiedTypes } from "../storage/equipment";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;
const VALID_PASSWORD = "Neurogan1!Secure";

let app: Express;
let adminId: string, qaId: string, whId: string;
const createdEquipmentIds: string[] = [];
const createdQualificationIds: string[] = [];

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  if (!dbUrl) return;
  app = await buildTestApp();
  const sfx = Date.now();

  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r03q-adm-${sfx}@t.com`,
      fullName: "R03Q Admin",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: null as unknown as string,
    })
    .returning();
  adminId = adm!.id;
  await db.insert(schema.userRoles).values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });

  const [qa] = await db
    .insert(schema.users)
    .values({
      email: `r03q-qa-${sfx}@t.com`,
      fullName: "R03Q QA",
      title: "QC Manager",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  qaId = qa!.id;
  await db.insert(schema.userRoles).values({ userId: qaId, role: "QA", grantedByUserId: adminId });

  const [wh] = await db
    .insert(schema.users)
    .values({
      email: `r03q-wh-${sfx}@t.com`,
      fullName: "R03Q WH",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  whId = wh!.id;
  await db.insert(schema.userRoles).values({ userId: whId, role: "WAREHOUSE", grantedByUserId: adminId });
});

afterAll(async () => {
  if (!dbUrl) return;
  // FK order: qualifications -> signatures -> audit -> equipment -> userRoles -> users
  if (createdQualificationIds.length > 0) {
    await db
      .delete(schema.equipmentQualifications)
      .where(inArray(schema.equipmentQualifications.id, createdQualificationIds))
      .catch(() => {});
  }
  for (const id of createdEquipmentIds) {
    await db
      .delete(schema.equipmentQualifications)
      .where(eq(schema.equipmentQualifications.equipmentId, id))
      .catch(() => {});
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, id)).catch(() => {});
    await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.entityId, id)).catch(() => {});
    await db.delete(schema.equipment).where(eq(schema.equipment.id, id)).catch(() => {});
  }
  for (const uid of [adminId, qaId, whId]) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, uid)).catch(() => {});
    await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.userId, uid)).catch(() => {});
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, uid)).catch(() => {});
    await db.delete(schema.users).where(eq(schema.users.id, uid)).catch(() => {});
  }
});

async function createEquipment(tagSuffix: string): Promise<string> {
  const tag = `R03Q-${tagSuffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const res = await request(app)
    .post("/api/equipment")
    .set("x-test-user-id", adminId)
    .send({ assetTag: tag, name: "QualEquip" });
  if (res.status !== 201) throw new Error(`createEquipment failed: ${res.status} ${JSON.stringify(res.body)}`);
  const id = (res.body as { id: string }).id;
  createdEquipmentIds.push(id);
  return id;
}

describeIfDb("R-03 equipment qualifications", () => {
  it("POST /api/equipment/:id/qualifications — 403 for WAREHOUSE", async () => {
    const equipId = await createEquipment("403");
    const res = await request(app)
      .post(`/api/equipment/${equipId}/qualifications`)
      .set("x-test-user-id", whId)
      .send({
        type: "IQ",
        status: "QUALIFIED",
        validFrom: isoDate(0),
        validUntil: isoDate(365),
        signaturePassword: VALID_PASSWORD,
      });
    expect(res.status).toBe(403);
  });

  it("POST /api/equipment/:id/qualifications — QUALIFIED requires signaturePassword", async () => {
    const equipId = await createEquipment("nopwd");
    const res = await request(app)
      .post(`/api/equipment/${equipId}/qualifications`)
      .set("x-test-user-id", qaId)
      .send({ type: "OQ", status: "QUALIFIED", validFrom: isoDate(0), validUntil: isoDate(365) });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/signature/i);
  });

  it("POST /api/equipment/:id/qualifications — QUALIFIED requires validFrom and validUntil", async () => {
    const equipId = await createEquipment("nodates");
    const res = await request(app)
      .post(`/api/equipment/${equipId}/qualifications`)
      .set("x-test-user-id", qaId)
      .send({ type: "PQ", status: "QUALIFIED", signaturePassword: VALID_PASSWORD });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/valid/i);
  });

  it("POST /api/equipment/:id/qualifications — wrong password rejects with 401, no row written", async () => {
    const equipId = await createEquipment("wrongpw");
    const res = await request(app)
      .post(`/api/equipment/${equipId}/qualifications`)
      .set("x-test-user-id", qaId)
      .send({
        type: "IQ",
        status: "QUALIFIED",
        validFrom: isoDate(0),
        validUntil: isoDate(365),
        signaturePassword: "WrongPassword123!",
      });
    expect(res.status).toBe(401);
    expect(res.body?.error?.code).toBe("UNAUTHENTICATED");
    const rows = await db
      .select()
      .from(schema.equipmentQualifications)
      .where(eq(schema.equipmentQualifications.equipmentId, equipId));
    expect(rows.length).toBe(0);
  });

  it("POST /api/equipment/:id/qualifications — 201 for QA with valid signature: writes row + EQUIPMENT_QUALIFIED audit", async () => {
    const equipId = await createEquipment("ok");
    const res = await request(app)
      .post(`/api/equipment/${equipId}/qualifications`)
      .set("x-test-user-id", qaId)
      .send({
        type: "IQ",
        status: "QUALIFIED",
        validFrom: isoDate(0),
        validUntil: isoDate(365),
        documentUrl: "https://example.com/iq.pdf",
        notes: "IQ verified",
        signaturePassword: VALID_PASSWORD,
        commentary: "Initial qualification",
      });
    expect(res.status).toBe(201);
    const body = res.body as { id: string; type: string; status: string; signatureId: string | null };
    expect(body.type).toBe("IQ");
    expect(body.status).toBe("QUALIFIED");
    expect(body.signatureId).toBeTruthy();
    createdQualificationIds.push(body.id);

    // Audit row asserts
    const audit = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, equipId));
    expect(audit.some((a) => a.action === "EQUIPMENT_QUALIFIED")).toBe(true);
    // SIGN row also written by performSignature
    expect(audit.some((a) => a.action === "SIGN")).toBe(true);
  });

  it("GET /api/equipment/:id/qualifications — returns history newest-first", async () => {
    const equipId = await createEquipment("hist");
    // Insert OQ then PQ (both QUALIFIED)
    const r1 = await request(app)
      .post(`/api/equipment/${equipId}/qualifications`)
      .set("x-test-user-id", qaId)
      .send({
        type: "OQ",
        status: "QUALIFIED",
        validFrom: isoDate(-10),
        validUntil: isoDate(355),
        signaturePassword: VALID_PASSWORD,
      });
    expect(r1.status).toBe(201);
    createdQualificationIds.push((r1.body as { id: string }).id);

    const r2 = await request(app)
      .post(`/api/equipment/${equipId}/qualifications`)
      .set("x-test-user-id", qaId)
      .send({
        type: "PQ",
        status: "QUALIFIED",
        validFrom: isoDate(-1),
        validUntil: isoDate(364),
        signaturePassword: VALID_PASSWORD,
      });
    expect(r2.status).toBe(201);
    createdQualificationIds.push((r2.body as { id: string }).id);

    const list = await request(app)
      .get(`/api/equipment/${equipId}/qualifications`)
      .set("x-test-user-id", whId);
    expect(list.status).toBe(200);
    const arr = list.body as Array<{ type: string; createdAt: string }>;
    expect(arr.length).toBe(2);
    // Newest first: PQ should come before OQ
    expect(arr[0]!.type).toBe("PQ");
    expect(arr[1]!.type).toBe("OQ");
  });

  it("getActiveQualifiedTypes — latest-wins: QUALIFIED in window included, EXPIRED excluded", async () => {
    const equipId = await createEquipment("active");

    // Add IQ QUALIFIED in window
    const r1 = await request(app)
      .post(`/api/equipment/${equipId}/qualifications`)
      .set("x-test-user-id", qaId)
      .send({
        type: "IQ",
        status: "QUALIFIED",
        validFrom: isoDate(-1),
        validUntil: isoDate(365),
        signaturePassword: VALID_PASSWORD,
      });
    createdQualificationIds.push((r1.body as { id: string }).id);

    // Add OQ QUALIFIED but expired (validUntil in past)
    const r2 = await request(app)
      .post(`/api/equipment/${equipId}/qualifications`)
      .set("x-test-user-id", qaId)
      .send({
        type: "OQ",
        status: "QUALIFIED",
        validFrom: isoDate(-100),
        validUntil: isoDate(-1),
        signaturePassword: VALID_PASSWORD,
      });
    createdQualificationIds.push((r2.body as { id: string }).id);

    // Add PQ QUALIFIED, then disqualify (latest row should be EXPIRED)
    const r3 = await request(app)
      .post(`/api/equipment/${equipId}/qualifications`)
      .set("x-test-user-id", qaId)
      .send({
        type: "PQ",
        status: "QUALIFIED",
        validFrom: isoDate(-1),
        validUntil: isoDate(365),
        signaturePassword: VALID_PASSWORD,
      });
    createdQualificationIds.push((r3.body as { id: string }).id);
    const r4 = await request(app)
      .post(`/api/equipment/${equipId}/disqualify`)
      .set("x-test-user-id", qaId)
      .send({ type: "PQ", notes: "post-incident disqualify" });
    expect(r4.status).toBe(201);
    createdQualificationIds.push((r4.body as { id: string }).id);

    const active = await getActiveQualifiedTypes(equipId);
    expect(active.has("IQ")).toBe(true);
    expect(active.has("OQ")).toBe(false);
    expect(active.has("PQ")).toBe(false);
  });

  it("getActiveQualifiedTypes — includes qualifications whose validUntil equals today (inclusive boundary)", async () => {
    const equipId = await createEquipment("boundary");
    const r = await request(app)
      .post(`/api/equipment/${equipId}/qualifications`)
      .set("x-test-user-id", qaId)
      .send({
        type: "PQ",
        status: "QUALIFIED",
        validFrom: isoDate(-30),
        validUntil: isoDate(0), // today — inclusive boundary
        signaturePassword: VALID_PASSWORD,
      });
    expect(r.status).toBe(201);
    createdQualificationIds.push((r.body as { id: string }).id);

    const active = await getActiveQualifiedTypes(equipId);
    expect(active.has("PQ")).toBe(true);
  });

  it("POST /api/equipment/:id/disqualify — 201 for QA, writes EXPIRED row + EQUIPMENT_DISQUALIFIED audit, no signature required", async () => {
    const equipId = await createEquipment("disq");
    // First qualify
    const r1 = await request(app)
      .post(`/api/equipment/${equipId}/qualifications`)
      .set("x-test-user-id", qaId)
      .send({
        type: "IQ",
        status: "QUALIFIED",
        validFrom: isoDate(0),
        validUntil: isoDate(365),
        signaturePassword: VALID_PASSWORD,
      });
    expect(r1.status).toBe(201);
    createdQualificationIds.push((r1.body as { id: string }).id);

    // Disqualify
    const r2 = await request(app)
      .post(`/api/equipment/${equipId}/disqualify`)
      .set("x-test-user-id", qaId)
      .send({ type: "IQ", notes: "Out-of-tolerance calibration" });
    expect(r2.status).toBe(201);
    const body = r2.body as { status: string; signatureId: string | null };
    expect(body.status).toBe("EXPIRED");
    expect(body.signatureId).toBeNull();
    createdQualificationIds.push((r2.body as { id: string }).id);

    const audit = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, equipId));
    expect(audit.some((a) => a.action === "EQUIPMENT_DISQUALIFIED")).toBe(true);
  });

  it("POST /api/equipment/:id/disqualify — 403 for WAREHOUSE", async () => {
    const equipId = await createEquipment("disq-wh");
    const res = await request(app)
      .post(`/api/equipment/${equipId}/disqualify`)
      .set("x-test-user-id", whId)
      .send({ type: "IQ" });
    expect(res.status).toBe(403);
  });

  it("POST /api/equipment/:id/qualifications — 404 for unknown equipment", async () => {
    const res = await request(app)
      .post("/api/equipment/00000000-0000-0000-0000-000000000000/qualifications")
      .set("x-test-user-id", qaId)
      .send({
        type: "IQ",
        status: "QUALIFIED",
        validFrom: isoDate(0),
        validUntil: isoDate(365),
        signaturePassword: VALID_PASSWORD,
      });
    expect(res.status).toBe(404);
  });
});
