import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";
import { and, eq, inArray } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;
const VALID_PASSWORD = "Neurogan1!Secure";

let app: Express;
let adminId: string;
let productId: string;
const createdEquipmentIds: string[] = [];

beforeAll(async () => {
  if (!dbUrl) return;
  app = await buildTestApp();
  const sfx = `${Date.now()}-${Math.random()}`;

  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r03pe-adm-${sfx}@t.com`,
      fullName: "R03PE Admin",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: null as unknown as string,
    })
    .returning();
  adminId = adm!.id;
  await db
    .insert(schema.userRoles)
    .values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });

  const [prod] = await db
    .insert(schema.products)
    .values({
      name: "R03PE Product",
      sku: `R03PE-${sfx}`,
      category: "ACTIVE_INGREDIENT",
      defaultUom: "g",
      status: "ACTIVE",
    })
    .returning();
  productId = prod!.id;
});

afterAll(async () => {
  if (!dbUrl) return;
  await db
    .delete(schema.productEquipment)
    .where(eq(schema.productEquipment.productId, productId))
    .catch(() => {});
  if (createdEquipmentIds.length > 0) {
    await db
      .delete(schema.equipment)
      .where(inArray(schema.equipment.id, createdEquipmentIds))
      .catch(() => {});
  }
  await db
    .delete(schema.products)
    .where(eq(schema.products.id, productId))
    .catch(() => {});
  await db
    .delete(schema.auditTrail)
    .where(eq(schema.auditTrail.userId, adminId))
    .catch(() => {});
  await db
    .delete(schema.userRoles)
    .where(eq(schema.userRoles.userId, adminId))
    .catch(() => {});
  await db
    .delete(schema.users)
    .where(eq(schema.users.id, adminId))
    .catch(() => {});
});

describeIfDb("R-03 GET /api/products/:id/equipment", () => {
  it("returns equipment linked via productEquipment join", async () => {
    const sfx = `${Date.now()}-${Math.random()}`;
    const [eqA] = await db
      .insert(schema.equipment)
      .values({ assetTag: `R03PE-A-${sfx}`, name: "Filler A" })
      .returning();
    const [eqB] = await db
      .insert(schema.equipment)
      .values({ assetTag: `R03PE-B-${sfx}`, name: "Filler B" })
      .returning();
    createdEquipmentIds.push(eqA!.id, eqB!.id);

    await db.insert(schema.productEquipment).values([
      { productId, equipmentId: eqA!.id },
      { productId, equipmentId: eqB!.id },
    ]);

    const res = await request(app).get(`/api/products/${productId}/equipment`);
    expect(res.status).toBe(200);
    const body = res.body as Array<{ id: string; assetTag: string }>;
    const ids = body.map((r) => r.id).sort();
    expect(ids).toEqual([eqA!.id, eqB!.id].sort());
    // Cleanup the join rows for the next test.
    await db
      .delete(schema.productEquipment)
      .where(
        and(
          eq(schema.productEquipment.productId, productId),
          inArray(schema.productEquipment.equipmentId, [eqA!.id, eqB!.id]),
        ),
      );
  });

  it("filters out RETIRED equipment", async () => {
    const sfx = `${Date.now()}-${Math.random()}`;
    const [eqActive] = await db
      .insert(schema.equipment)
      .values({ assetTag: `R03PE-AC-${sfx}`, name: "Active", status: "ACTIVE" })
      .returning();
    const [eqRetired] = await db
      .insert(schema.equipment)
      .values({
        assetTag: `R03PE-RT-${sfx}`,
        name: "Retired",
        status: "RETIRED",
      })
      .returning();
    createdEquipmentIds.push(eqActive!.id, eqRetired!.id);

    await db.insert(schema.productEquipment).values([
      { productId, equipmentId: eqActive!.id },
      { productId, equipmentId: eqRetired!.id },
    ]);

    const res = await request(app).get(`/api/products/${productId}/equipment`);
    expect(res.status).toBe(200);
    const body = res.body as Array<{ id: string; status: string }>;
    const ids = body.map((r) => r.id);
    expect(ids).toContain(eqActive!.id);
    expect(ids).not.toContain(eqRetired!.id);
  });
});
