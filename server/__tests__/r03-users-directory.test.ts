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
let adminId: string, whId: string, disabledId: string;
let disabledEmail: string;

beforeAll(async () => {
  if (!dbUrl) return;
  app = await buildTestApp();
  const sfx = Date.now();

  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r03dir-adm-${sfx}@t.com`,
      fullName: "R03Dir Admin",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: null as unknown as string,
    })
    .returning();
  adminId = adm!.id;
  await db
    .insert(schema.userRoles)
    .values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });

  const [wh] = await db
    .insert(schema.users)
    .values({
      email: `r03dir-wh-${sfx}@t.com`,
      fullName: "R03Dir Warehouse",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  whId = wh!.id;
  await db
    .insert(schema.userRoles)
    .values({ userId: whId, role: "WAREHOUSE", grantedByUserId: adminId });

  // A user that starts ACTIVE then gets DISABLED — must be excluded from
  // /api/users/directory results.
  disabledEmail = `r03dir-dis-${sfx}@t.com`;
  const [dis] = await db
    .insert(schema.users)
    .values({
      email: disabledEmail,
      fullName: "R03Dir Disabled",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  disabledId = dis!.id;
  await db
    .insert(schema.userRoles)
    .values({ userId: disabledId, role: "WAREHOUSE", grantedByUserId: adminId });
  await db
    .update(schema.users)
    .set({ status: "DISABLED" })
    .where(eq(schema.users.id, disabledId));
});

afterAll(async () => {
  if (!dbUrl) return;
  for (const uid of [adminId, whId, disabledId]) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, uid)).catch(() => {});
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, uid)).catch(() => {});
    await db.delete(schema.users).where(eq(schema.users.id, uid)).catch(() => {});
  }
});

describeIfDb("R-03 GET /api/users/directory", () => {
  it("200 + minimal {id, fullName, email} entries for any authenticated user (WAREHOUSE)", async () => {
    const res = await request(app)
      .get("/api/users/directory")
      .set("x-test-user-id", whId);
    expect(res.status).toBe(200);
    const body = res.body as Array<{ id: string; fullName: string; email: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    // Every returned entry has exactly the three fields we promise — no
    // passwordHash, no roles, no admin-only fields leaking out.
    for (const u of body) {
      expect(typeof u.id).toBe("string");
      expect(typeof u.fullName).toBe("string");
      expect(typeof u.email).toBe("string");
      expect(Object.keys(u).sort()).toEqual(["email", "fullName", "id"]);
    }
    // The WAREHOUSE caller themselves should appear in the directory.
    expect(body.some((u) => u.id === whId)).toBe(true);
  });

  it("401 when unauthenticated", async () => {
    const res = await request(app).get("/api/users/directory");
    expect(res.status).toBe(401);
  });

  it("ACTIVE-only — DISABLED users are excluded", async () => {
    const res = await request(app)
      .get("/api/users/directory")
      .set("x-test-user-id", adminId);
    expect(res.status).toBe(200);
    const body = res.body as Array<{ id: string; fullName: string; email: string }>;
    expect(body.some((u) => u.id === disabledId)).toBe(false);
    expect(body.some((u) => u.email === disabledEmail)).toBe(false);
  });
});
