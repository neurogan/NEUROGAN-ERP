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
let adminId: string;
let qaId: string;
let productionId: string;
let productId: string;
const createdMmrIds: string[] = [];

beforeAll(async () => {
  if (!dbUrl) return;
  app = await buildTestApp();
  const sfx = Date.now();

  // Admin user (creates MMR)
  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r07-adm-${sfx}@t.com`,
      fullName: "R07 Admin",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: null as unknown as string,
    })
    .returning();
  adminId = adm!.id;
  await db.insert(schema.userRoles).values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });

  // QA user (approves MMR — must be different from creator)
  const [qa] = await db
    .insert(schema.users)
    .values({
      email: `r07-qa-${sfx}@t.com`,
      fullName: "R07 QA",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  qaId = qa!.id;
  await db.insert(schema.userRoles).values({ userId: qaId, role: "QA", grantedByUserId: adminId });

  // Production user
  const [prod] = await db
    .insert(schema.users)
    .values({
      email: `r07-prod-${sfx}@t.com`,
      fullName: "R07 Production",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  productionId = prod!.id;
  await db.insert(schema.userRoles).values({ userId: productionId, role: "PRODUCTION", grantedByUserId: adminId });

  // Create a FINISHED_GOOD product
  const [p] = await db
    .insert(schema.products)
    .values({
      name: `R07 TestProduct ${sfx}`,
      sku: `R07-SKU-${sfx}`,
      category: "FINISHED_GOOD",
      defaultUom: "pcs",
    })
    .returning();
  productId = p!.id;

});

afterAll(async () => {
  if (!dbUrl) return;
  // Clean up created MMRs and their steps (CASCADE on mmrSteps)
  for (const id of createdMmrIds) {
    await db.delete(schema.mmrs).where(eq(schema.mmrs.id, id)).catch(() => {});
  }
  await db.delete(schema.products).where(eq(schema.products.id, productId)).catch(() => {});
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, adminId)).catch(() => {});
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, qaId)).catch(() => {});
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, productionId)).catch(() => {});
  await db.delete(schema.users).where(eq(schema.users.id, adminId)).catch(() => {});
  await db.delete(schema.users).where(eq(schema.users.id, qaId)).catch(() => {});
  await db.delete(schema.users).where(eq(schema.users.id, productionId)).catch(() => {});
});

describeIfDb("GET /api/mmrs", () => {
  it("returns 200 with array", async () => {
    const res = await request(app)
      .get("/api/mmrs")
      .set("x-test-user-id", adminId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describeIfDb("POST /api/mmrs", () => {
  it("creates a DRAFT MMR", async () => {
    const res = await request(app)
      .post("/api/mmrs")
      .set("x-test-user-id", adminId)
      .send({ productId });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.version).toBe(1);
    createdMmrIds.push(res.body.id);
  });

  it("rejects WAREHOUSE user with 403", async () => {
    // WAREHOUSE role is not allowed to create MMRs
    const [wh] = await db.insert(schema.users).values({
      email: `r07-wh-${Date.now()}@t.com`,
      fullName: "R07 WH",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    }).returning();
    await db.insert(schema.userRoles).values({ userId: wh!.id, role: "WAREHOUSE", grantedByUserId: adminId });

    const res = await request(app)
      .post("/api/mmrs")
      .set("x-test-user-id", wh!.id)
      .send({ productId });
    expect(res.status).toBe(403);

    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, wh!.id));
    await db.delete(schema.users).where(eq(schema.users.id, wh!.id));
  });
});

describeIfDb("MMR lifecycle: DRAFT → APPROVED → SUPERSEDED", () => {
  let mmrId: string;

  it("creates a DRAFT MMR", async () => {
    const res = await request(app)
      .post("/api/mmrs")
      .set("x-test-user-id", adminId)
      .send({ productId, notes: "test mmr" });
    expect(res.status).toBe(201);
    mmrId = res.body.id;
    createdMmrIds.push(mmrId);
  });

  it("adds a step to the DRAFT", async () => {
    const res = await request(app)
      .post(`/api/mmrs/${mmrId}/steps`)
      .set("x-test-user-id", adminId)
      .send({ stepNumber: 1, description: "Mix ingredients", equipmentIds: [], criticalParams: "T ≤ 25°C" });
    expect(res.status).toBe(201);
    expect(res.body.stepNumber).toBe(1);
  });

  it("rejects self-approval", async () => {
    const res = await request(app)
      .post(`/api/mmrs/${mmrId}/approve`)
      .set("x-test-user-id", adminId)
      .send({ password: VALID_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/same person/i);
  });

  it("rejects approval by non-QA role (PRODUCTION user)", async () => {
    const res = await request(app)
      .post(`/api/mmrs/${mmrId}/approve`)
      .set("x-test-user-id", productionId)
      .send({ password: VALID_PASSWORD });
    expect(res.status).toBe(403);
  });

  it("approves MMR with QA user (different from creator)", async () => {
    const res = await request(app)
      .post(`/api/mmrs/${mmrId}/approve`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD, commentary: "Approved for production" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");
    expect(res.body.approvedByUserId).toBe(qaId);
  });

  it("rejects PATCH on APPROVED MMR", async () => {
    const res = await request(app)
      .patch(`/api/mmrs/${mmrId}`)
      .set("x-test-user-id", adminId)
      .send({ notes: "should fail" });
    expect(res.status).toBe(403);
  });

  it("rejects adding step to APPROVED MMR", async () => {
    const res = await request(app)
      .post(`/api/mmrs/${mmrId}/steps`)
      .set("x-test-user-id", adminId)
      .send({ stepNumber: 2, description: "should fail" });
    expect(res.status).toBe(400);
  });

  it("creates new DRAFT v2 via revise", async () => {
    const res = await request(app)
      .post(`/api/mmrs/${mmrId}/revise`)
      .set("x-test-user-id", adminId);
    expect(res.status).toBe(201);
    expect(res.body.version).toBe(2);
    expect(res.body.status).toBe("DRAFT");
    createdMmrIds.push(res.body.id);
  });

  it("old MMR is now SUPERSEDED", async () => {
    const res = await request(app)
      .get(`/api/mmrs/${mmrId}`)
      .set("x-test-user-id", adminId);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("SUPERSEDED");
  });
});

describeIfDb("GET /api/mmrs?productId=", () => {
  it("returns MMR array for product", async () => {
    const res = await request(app)
      .get(`/api/mmrs?productId=${productId}`)
      .set("x-test-user-id", adminId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
