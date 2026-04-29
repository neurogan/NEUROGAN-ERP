import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";
import { eq } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;
const VALID_PASSWORD = "Neurogan1!Secure";

let app: Express;
let adminId: string, qaId: string, whId: string;
let locationId: string;
const createdEquipmentIds: string[] = [];

beforeAll(async () => {
  if (!dbUrl) return;
  app = await buildTestApp();
  const sfx = Date.now();

  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r03-adm-${sfx}@t.com`,
      fullName: "R03 Admin",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: null as unknown as string,
    })
    .returning();
  adminId = adm!.id;
  await db.insert(schema.userRoles).values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });

  const [qa] = await db
    .insert(schema.users)
    .values({
      email: `r03-qa-${sfx}@t.com`,
      fullName: "R03 QA",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  qaId = qa!.id;
  await db.insert(schema.userRoles).values({ userId: qaId, role: "QA", grantedByUserId: adminId });

  const [wh] = await db
    .insert(schema.users)
    .values({
      email: `r03-wh-${sfx}@t.com`,
      fullName: "R03 WH",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  whId = wh!.id;
  await db.insert(schema.userRoles).values({ userId: whId, role: "WAREHOUSE", grantedByUserId: adminId });

  const [loc] = await db.insert(schema.locations).values({ name: `R03-Loc-${sfx}` }).returning();
  locationId = loc!.id;
});

afterAll(async () => {
  if (!dbUrl) return;
  for (const id of createdEquipmentIds) {
    await db.delete(schema.equipment).where(eq(schema.equipment.id, id)).catch(() => {});
  }
  await db.delete(schema.locations).where(eq(schema.locations.id, locationId)).catch(() => {});
  await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, adminId)).catch(() => {});
  await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, qaId)).catch(() => {});
  await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, whId)).catch(() => {});
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, adminId)).catch(() => {});
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, qaId)).catch(() => {});
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, whId)).catch(() => {});
  await db.delete(schema.users).where(eq(schema.users.id, adminId)).catch(() => {});
  await db.delete(schema.users).where(eq(schema.users.id, qaId)).catch(() => {});
  await db.delete(schema.users).where(eq(schema.users.id, whId)).catch(() => {});
});

describeIfDb("R-03 equipment master", () => {
  it("POST /api/equipment — 403 for WAREHOUSE", async () => {
    const res = await request(app)
      .post("/api/equipment")
      .set("x-test-user-id", whId)
      .send({ assetTag: `WH-FAIL-${Date.now()}`, name: "Filler" });
    expect(res.status).toBe(403);
  });

  it("POST /api/equipment — 201 for ADMIN", async () => {
    const tag = `R03-EQ-${Date.now()}`;
    const res = await request(app)
      .post("/api/equipment")
      .set("x-test-user-id", adminId)
      .send({ assetTag: tag, name: "Filler-A", model: "F100", locationId });
    expect(res.status).toBe(201);
    expect((res.body as { assetTag: string }).assetTag).toBe(tag);
    createdEquipmentIds.push((res.body as { id: string }).id);
  });

  it("POST /api/equipment — 409 on duplicate assetTag", async () => {
    const tag = `R03-DUP-${Date.now()}`;
    const r1 = await request(app)
      .post("/api/equipment")
      .set("x-test-user-id", adminId)
      .send({ assetTag: tag, name: "X" });
    expect(r1.status).toBe(201);
    createdEquipmentIds.push((r1.body as { id: string }).id);
    const r2 = await request(app)
      .post("/api/equipment")
      .set("x-test-user-id", adminId)
      .send({ assetTag: tag, name: "X2" });
    expect(r2.status).toBe(409);
    expect((r2.body as { code: string }).code).toBe("DUPLICATE_ASSET_TAG");
  });

  it("GET /api/equipment — returns list for any auth user", async () => {
    const res = await request(app).get("/api/equipment").set("x-test-user-id", whId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/equipment/:id — 200 for any auth user", async () => {
    const tag = `R03-GET-${Date.now()}`;
    const create = await request(app)
      .post("/api/equipment")
      .set("x-test-user-id", adminId)
      .send({ assetTag: tag, name: "GetMe" });
    expect(create.status).toBe(201);
    const equipId = (create.body as { id: string }).id;
    createdEquipmentIds.push(equipId);
    const res = await request(app)
      .get(`/api/equipment/${equipId}`)
      .set("x-test-user-id", whId);
    expect(res.status).toBe(200);
    expect((res.body as { id: string }).id).toBe(equipId);
  });

  it("PATCH /api/equipment/:id/retire — 200 for QA, audit row written", async () => {
    const tag = `R03-RET-${Date.now()}`;
    const create = await request(app)
      .post("/api/equipment")
      .set("x-test-user-id", adminId)
      .send({ assetTag: tag, name: "ToRetire" });
    expect(create.status).toBe(201);
    const equipId = (create.body as { id: string }).id;
    createdEquipmentIds.push(equipId);
    const res = await request(app)
      .patch(`/api/equipment/${equipId}/retire`)
      .set("x-test-user-id", qaId)
      .send({});
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("RETIRED");
    const audit = await db
      .select()
      .from(schema.auditTrail)
      .where(eq(schema.auditTrail.entityId, equipId));
    expect(audit.some((a) => a.action === "EQUIPMENT_RETIRED")).toBe(true);
  });

  it("GET /api/equipment/:id — 404 for unknown id", async () => {
    const res = await request(app)
      .get("/api/equipment/00000000-0000-0000-0000-000000000000")
      .set("x-test-user-id", adminId);
    expect(res.status).toBe(404);
  });

  it("PATCH /api/equipment/:id/retire — 404 for unknown id", async () => {
    const res = await request(app)
      .patch("/api/equipment/00000000-0000-0000-0000-000000000000/retire")
      .set("x-test-user-id", qaId);
    expect(res.status).toBe(404);
  });
});
