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
let productId: string;
const createdSopIds: string[] = [];
const createdBprIds: string[] = [];

beforeAll(async () => {
  if (!dbUrl) return;
  app = await buildTestApp();
  const sfx = Date.now();

  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r04sopsrt-adm-${sfx}@t.com`,
      fullName: "R04Sops Admin",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: null as unknown as string,
    })
    .returning();
  adminId = adm!.id;
  await db.insert(schema.userRoles).values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });

  const [qa] = await db
    .insert(schema.users)
    .values({
      email: `r04sopsrt-qa-${sfx}@t.com`,
      fullName: "R04Sops QA",
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
      email: `r04sopsrt-wh-${sfx}@t.com`,
      fullName: "R04Sops WH",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  whId = wh!.id;
  await db.insert(schema.userRoles).values({ userId: whId, role: "WAREHOUSE", grantedByUserId: adminId });

  const [prod] = await db
    .insert(schema.products)
    .values({ sku: `R04SOPSRT-${sfx}`, name: "R04 Sops Routes Product" })
    .returning();
  productId = prod!.id;
});

afterAll(async () => {
  if (!dbUrl) return;

  // BPR steps cleanup (FK → BPRs)
  for (const bprId of createdBprIds) {
    await db.delete(schema.bprSteps).where(eq(schema.bprSteps.bprId, bprId)).catch(() => {});
    await db.delete(schema.batchProductionRecords).where(eq(schema.batchProductionRecords.id, bprId)).catch(() => {});
  }

  // SOP cleanup
  for (const id of createdSopIds) {
    await db.update(schema.sops).set({ approvedBySignatureId: null, retiredBySignatureId: null }).where(eq(schema.sops.id, id)).catch(() => {});
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, id)).catch(() => {});
    await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.entityId, id)).catch(() => {});
    await db.delete(schema.sops).where(eq(schema.sops.id, id)).catch(() => {});
  }

  if (productId) {
    await db.delete(schema.products).where(eq(schema.products.id, productId)).catch(() => {});
  }

  for (const uid of [adminId, qaId, whId].filter(Boolean)) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, uid)).catch(() => {});
    await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.userId, uid)).catch(() => {});
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, uid)).catch(() => {});
    await db.delete(schema.users).where(eq(schema.users.id, uid)).catch(() => {});
  }
});

function sopBody(suffix: string) {
  return {
    code: `SOP-TEST-${suffix}`,
    version: "v1.0",
    title: `Test SOP ${suffix}`,
  };
}

describeIfDb("R-04 SOP API routes", () => {
  // ─── POST /api/sops ──────────────────────────────────────────────────────────

  it("POST /api/sops — 403 for WAREHOUSE role", async () => {
    const res = await request(app)
      .post("/api/sops")
      .set("x-test-user-id", whId)
      .send(sopBody("wh-fail"));
    expect(res.status).toBe(403);
  });

  it("POST /api/sops — 201 DRAFT for QA", async () => {
    const res = await request(app)
      .post("/api/sops")
      .set("x-test-user-id", qaId)
      .send(sopBody(`create-${Date.now()}`));
    expect(res.status).toBe(201);
    expect((res.body as { status: string }).status).toBe("DRAFT");
    createdSopIds.push((res.body as { id: string }).id);
  });

  it("POST /api/sops — 400 when code missing", async () => {
    const res = await request(app)
      .post("/api/sops")
      .set("x-test-user-id", qaId)
      .send({ version: "v1.0", title: "Missing code field" });
    expect(res.status).toBe(400);
  });

  // ─── GET /api/sops ───────────────────────────────────────────────────────────

  it("GET /api/sops — 200 array for any auth", async () => {
    const res = await request(app)
      .get("/api/sops")
      .set("x-test-user-id", adminId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // ─── GET /api/sops/:id ───────────────────────────────────────────────────────

  it("GET /api/sops/:id — 200 for existing, 404 for unknown", async () => {
    const createRes = await request(app)
      .post("/api/sops")
      .set("x-test-user-id", qaId)
      .send(sopBody(`get-${Date.now()}`));
    expect(createRes.status).toBe(201);
    const sopId = (createRes.body as { id: string }).id;
    createdSopIds.push(sopId);

    const getRes = await request(app)
      .get(`/api/sops/${sopId}`)
      .set("x-test-user-id", adminId);
    expect(getRes.status).toBe(200);
    expect((getRes.body as { id: string }).id).toBe(sopId);

    const missing = await request(app)
      .get("/api/sops/00000000-0000-0000-0000-000000000000")
      .set("x-test-user-id", adminId);
    expect(missing.status).toBe(404);
  });

  // ─── POST /api/sops/:id/approve ──────────────────────────────────────────────

  it("POST /api/sops/:id/approve — 400 when password missing", async () => {
    const createRes = await request(app)
      .post("/api/sops")
      .set("x-test-user-id", qaId)
      .send(sopBody(`approve-nopass-${Date.now()}`));
    expect(createRes.status).toBe(201);
    const sopId = (createRes.body as { id: string }).id;
    createdSopIds.push(sopId);

    const res = await request(app)
      .post(`/api/sops/${sopId}/approve`)
      .set("x-test-user-id", qaId)
      .send({});
    expect(res.status).toBe(400);
  });

  it("POST /api/sops/:id/approve — 200 DRAFT→APPROVED", async () => {
    const createRes = await request(app)
      .post("/api/sops")
      .set("x-test-user-id", qaId)
      .send(sopBody(`approve-ok-${Date.now()}`));
    expect(createRes.status).toBe(201);
    const sopId = (createRes.body as { id: string }).id;
    createdSopIds.push(sopId);

    const res = await request(app)
      .post(`/api/sops/${sopId}/approve`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("APPROVED");
    expect((res.body as { approvedBySignatureId: string | null }).approvedBySignatureId).toBeTruthy();
  });

  it("POST /api/sops/:id/approve — 409 when already APPROVED", async () => {
    const createRes = await request(app)
      .post("/api/sops")
      .set("x-test-user-id", qaId)
      .send(sopBody(`approve-dup-${Date.now()}`));
    createdSopIds.push((createRes.body as { id: string }).id);
    const sopId = (createRes.body as { id: string }).id;

    await request(app)
      .post(`/api/sops/${sopId}/approve`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD });

    const res = await request(app)
      .post(`/api/sops/${sopId}/approve`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD });
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe("SOP_INVALID_STATE");
  });

  it("POST /api/sops/:id/approve — 401 for wrong password", async () => {
    const createRes = await request(app)
      .post("/api/sops")
      .set("x-test-user-id", qaId)
      .send(sopBody(`approve-badpass-${Date.now()}`));
    expect(createRes.status).toBe(201);
    const sopId = (createRes.body as { id: string }).id;
    createdSopIds.push(sopId);

    const res = await request(app)
      .post(`/api/sops/${sopId}/approve`)
      .set("x-test-user-id", qaId)
      .send({ password: "wrong-password" });
    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error?.code).toBe("UNAUTHENTICATED");
  });

  // ─── POST /api/sops/:id/retire ───────────────────────────────────────────────

  it("POST /api/sops/:id/retire — 200 APPROVED→RETIRED", async () => {
    const createRes = await request(app)
      .post("/api/sops")
      .set("x-test-user-id", qaId)
      .send(sopBody(`retire-ok-${Date.now()}`));
    expect(createRes.status).toBe(201);
    const sopId = (createRes.body as { id: string }).id;
    createdSopIds.push(sopId);

    await request(app)
      .post(`/api/sops/${sopId}/approve`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD });

    const res = await request(app)
      .post(`/api/sops/${sopId}/retire`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("RETIRED");
    expect((res.body as { retiredBySignatureId: string | null }).retiredBySignatureId).toBeTruthy();
  });

  it("POST /api/sops/:id/retire — 409 when DRAFT (not approved)", async () => {
    const createRes = await request(app)
      .post("/api/sops")
      .set("x-test-user-id", qaId)
      .send(sopBody(`retire-draft-${Date.now()}`));
    expect(createRes.status).toBe(201);
    const sopId = (createRes.body as { id: string }).id;
    createdSopIds.push(sopId);

    const res = await request(app)
      .post(`/api/sops/${sopId}/retire`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD });
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe("SOP_INVALID_STATE");
  });

  // ─── BPR step SOP citation validation ────────────────────────────────────────

  it("BPR step — 409 SOP_NOT_APPROVED when sopCode cites a DRAFT SOP", async () => {
    const sfx = Date.now();
    // Create a DRAFT SOP
    const sopRes = await request(app)
      .post("/api/sops")
      .set("x-test-user-id", qaId)
      .send({ code: `DRAFT-SOP-${sfx}`, version: "v1.0", title: "Draft SOP" });
    expect(sopRes.status).toBe(201);
    createdSopIds.push((sopRes.body as { id: string }).id);

    // Create BPR
    const [bpr] = await db.insert(schema.batchProductionRecords).values({
      productionBatchId: `BATCH-SOPCITE-${sfx}`,
      batchNumber: `BN-SOPCITE-${sfx}`,
      productId,
      status: "IN_PROGRESS",
    }).returning();
    createdBprIds.push(bpr!.id);

    const res = await request(app)
      .post(`/api/batch-production-records/${bpr!.id}/steps`)
      .set("x-test-user-id", adminId)
      .send({
        bprId: bpr!.id,
        stepNumber: "1",
        stepDescription: "Test step",
        sopCode: `DRAFT-SOP-${sfx}`,
        sopVersion: "v1.0",
      });
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe("SOP_NOT_APPROVED");
  });

  it("BPR step — 201 when sopCode cites an APPROVED SOP", async () => {
    const sfx = Date.now();
    // Create and approve a SOP
    const sopRes = await request(app)
      .post("/api/sops")
      .set("x-test-user-id", qaId)
      .send({ code: `APPR-SOP-${sfx}`, version: "v1.0", title: "Approved SOP" });
    expect(sopRes.status).toBe(201);
    const sopId = (sopRes.body as { id: string }).id;
    createdSopIds.push(sopId);

    await request(app)
      .post(`/api/sops/${sopId}/approve`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD });

    // Create BPR
    const [bpr] = await db.insert(schema.batchProductionRecords).values({
      productionBatchId: `BATCH-SOPCITE2-${sfx}`,
      batchNumber: `BN-SOPCITE2-${sfx}`,
      productId,
      status: "IN_PROGRESS",
    }).returning();
    createdBprIds.push(bpr!.id);

    const res = await request(app)
      .post(`/api/batch-production-records/${bpr!.id}/steps`)
      .set("x-test-user-id", adminId)
      .send({
        bprId: bpr!.id,
        stepNumber: "1",
        stepDescription: "Test step with approved SOP",
        sopCode: `APPR-SOP-${sfx}`,
        sopVersion: "v1.0",
      });
    expect(res.status).toBe(201);
  });
});
