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
const createdArtworkIds: string[] = [];

beforeAll(async () => {
  if (!dbUrl) return;
  app = await buildTestApp();
  const sfx = Date.now();

  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r04rt-adm-${sfx}@t.com`,
      fullName: "R04Routes Admin",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: null as unknown as string,
    })
    .returning();
  adminId = adm!.id;
  await db.insert(schema.userRoles).values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });

  const [qa] = await db
    .insert(schema.users)
    .values({
      email: `r04rt-qa-${sfx}@t.com`,
      fullName: "R04Routes QA",
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
      email: `r04rt-wh-${sfx}@t.com`,
      fullName: "R04Routes WH",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  whId = wh!.id;
  await db.insert(schema.userRoles).values({ userId: whId, role: "WAREHOUSE", grantedByUserId: adminId });

  const [prod] = await db
    .insert(schema.products)
    .values({ sku: `R04RT-${sfx}`, name: "R04 Routes Test Product" })
    .returning();
  productId = prod!.id;
});

afterAll(async () => {
  if (!dbUrl) return;

  for (const id of createdArtworkIds) {
    await db
      .update(schema.labelArtwork)
      .set({ approvedBySignatureId: null, retiredBySignatureId: null })
      .where(eq(schema.labelArtwork.id, id))
      .catch(() => {});
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, id)).catch(() => {});
    await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.entityId, id)).catch(() => {});
    await db.delete(schema.labelArtwork).where(eq(schema.labelArtwork.id, id)).catch(() => {});
  }

  if (productId) {
    await db.delete(schema.labelArtwork).where(eq(schema.labelArtwork.productId, productId)).catch(() => {});
    await db.delete(schema.products).where(eq(schema.products.id, productId)).catch(() => {});
  }

  for (const uid of [adminId, qaId, whId].filter(Boolean)) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, uid)).catch(() => {});
    await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.userId, uid)).catch(() => {});
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, uid)).catch(() => {});
    await db.delete(schema.users).where(eq(schema.users.id, uid)).catch(() => {});
  }
});

function artworkBody(versionSuffix: string) {
  return {
    productId,
    version: `v1.${versionSuffix}`,
    artworkFileName: `label-${versionSuffix}.pdf`,
    artworkFileData: "base64dataplaceholder",
    artworkMimeType: "application/pdf",
    variableDataSpec: { lotNumber: true },
  };
}

describeIfDb("R-04 label artwork routes", () => {
  // ─── POST /api/label-artwork ─────────────────────────────────────────────────

  it("POST /api/label-artwork — 403 for WAREHOUSE role", async () => {
    const res = await request(app)
      .post("/api/label-artwork")
      .set("x-test-user-id", whId)
      .send(artworkBody("wh-fail"));
    expect(res.status).toBe(403);
  });

  it("POST /api/label-artwork — 401 without auth", async () => {
    const res = await request(app)
      .post("/api/label-artwork")
      .send(artworkBody("no-auth"));
    expect(res.status).toBe(401);
  });

  it("POST /api/label-artwork — 400 when productId missing", async () => {
    const { productId: _omit, ...body } = artworkBody("no-product");
    const res = await request(app)
      .post("/api/label-artwork")
      .set("x-test-user-id", qaId)
      .send(body);
    expect(res.status).toBe(400);
  });

  it("POST /api/label-artwork — 201 with DRAFT status for QA", async () => {
    const versionSuffix = `qa-${Date.now()}`;
    const res = await request(app)
      .post("/api/label-artwork")
      .set("x-test-user-id", qaId)
      .send(artworkBody(versionSuffix));
    expect(res.status).toBe(201);
    expect((res.body as { status: string }).status).toBe("DRAFT");
    expect((res.body as { productId: string }).productId).toBe(productId);
    createdArtworkIds.push((res.body as { id: string }).id);
  });

  it("POST /api/label-artwork — 201 with DRAFT status for ADMIN", async () => {
    const versionSuffix = `adm-${Date.now()}`;
    const res = await request(app)
      .post("/api/label-artwork")
      .set("x-test-user-id", adminId)
      .send(artworkBody(versionSuffix));
    expect(res.status).toBe(201);
    expect((res.body as { status: string }).status).toBe("DRAFT");
    createdArtworkIds.push((res.body as { id: string }).id);
  });

  // ─── GET /api/label-artwork?productId=... ────────────────────────────────────

  it("GET /api/label-artwork — 400 when productId query param missing", async () => {
    const res = await request(app)
      .get("/api/label-artwork")
      .set("x-test-user-id", qaId);
    expect(res.status).toBe(400);
  });

  it("GET /api/label-artwork?productId=... — 200 returns array", async () => {
    // Create one first so we have at least one result
    const createRes = await request(app)
      .post("/api/label-artwork")
      .set("x-test-user-id", qaId)
      .send(artworkBody(`list-${Date.now()}`));
    expect(createRes.status).toBe(201);
    createdArtworkIds.push((createRes.body as { id: string }).id);

    const res = await request(app)
      .get(`/api/label-artwork?productId=${productId}`)
      .set("x-test-user-id", qaId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect((res.body as { id: string }[]).length).toBeGreaterThan(0);
  });

  // ─── GET /api/label-artwork/:id ──────────────────────────────────────────────

  it("GET /api/label-artwork/:id — 200 returns artwork row", async () => {
    const createRes = await request(app)
      .post("/api/label-artwork")
      .set("x-test-user-id", qaId)
      .send(artworkBody(`get-${Date.now()}`));
    expect(createRes.status).toBe(201);
    const artworkId = (createRes.body as { id: string }).id;
    createdArtworkIds.push(artworkId);

    const res = await request(app)
      .get(`/api/label-artwork/${artworkId}`)
      .set("x-test-user-id", whId);
    expect(res.status).toBe(200);
    expect((res.body as { id: string }).id).toBe(artworkId);
  });

  it("GET /api/label-artwork/:id — 404 for unknown id", async () => {
    const res = await request(app)
      .get("/api/label-artwork/00000000-0000-0000-0000-000000000000")
      .set("x-test-user-id", adminId);
    expect(res.status).toBe(404);
  });

  // ─── POST /api/label-artwork/:id/approve ────────────────────────────────────

  it("POST /api/label-artwork/:id/approve — 400 when password missing", async () => {
    const createRes = await request(app)
      .post("/api/label-artwork")
      .set("x-test-user-id", qaId)
      .send(artworkBody(`approve-nopass-${Date.now()}`));
    expect(createRes.status).toBe(201);
    const artworkId = (createRes.body as { id: string }).id;
    createdArtworkIds.push(artworkId);

    const res = await request(app)
      .post(`/api/label-artwork/${artworkId}/approve`)
      .set("x-test-user-id", qaId)
      .send({});
    expect(res.status).toBe(400);
  });

  it("POST /api/label-artwork/:id/approve — 404 for unknown id", async () => {
    const res = await request(app)
      .post("/api/label-artwork/00000000-0000-0000-0000-000000000000/approve")
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD });
    expect(res.status).toBe(404);
  });

  it("POST /api/label-artwork/:id/approve — 403 for WAREHOUSE role", async () => {
    const createRes = await request(app)
      .post("/api/label-artwork")
      .set("x-test-user-id", qaId)
      .send(artworkBody(`approve-wh-${Date.now()}`));
    expect(createRes.status).toBe(201);
    const artworkId = (createRes.body as { id: string }).id;
    createdArtworkIds.push(artworkId);

    const res = await request(app)
      .post(`/api/label-artwork/${artworkId}/approve`)
      .set("x-test-user-id", whId)
      .send({ password: VALID_PASSWORD });
    expect(res.status).toBe(403);
  });

  it("POST /api/label-artwork/:id/approve — 200 DRAFT→APPROVED with valid password", async () => {
    const createRes = await request(app)
      .post("/api/label-artwork")
      .set("x-test-user-id", qaId)
      .send(artworkBody(`approve-ok-${Date.now()}`));
    expect(createRes.status).toBe(201);
    const artworkId = (createRes.body as { id: string }).id;
    createdArtworkIds.push(artworkId);

    const res = await request(app)
      .post(`/api/label-artwork/${artworkId}/approve`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("APPROVED");
    expect((res.body as { approvedBySignatureId: string | null }).approvedBySignatureId).toBeTruthy();
  });

  it("POST /api/label-artwork/:id/approve — 401 for wrong password", async () => {
    const createRes = await request(app)
      .post("/api/label-artwork")
      .set("x-test-user-id", qaId)
      .send(artworkBody(`approve-badpass-${Date.now()}`));
    expect(createRes.status).toBe(201);
    const artworkId = (createRes.body as { id: string }).id;
    createdArtworkIds.push(artworkId);

    const res = await request(app)
      .post(`/api/label-artwork/${artworkId}/approve`)
      .set("x-test-user-id", qaId)
      .send({ password: "wrong-password-definitely" });
    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error?.code).toBe("UNAUTHENTICATED");
  });

  it("POST /api/label-artwork/:id/approve — 409 when already APPROVED (invalid state transition)", async () => {
    const createRes = await request(app)
      .post("/api/label-artwork")
      .set("x-test-user-id", qaId)
      .send(artworkBody(`approve-dup-${Date.now()}`));
    expect(createRes.status).toBe(201);
    const artworkId = (createRes.body as { id: string }).id;
    createdArtworkIds.push(artworkId);

    // First approve — should succeed
    const first = await request(app)
      .post(`/api/label-artwork/${artworkId}/approve`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD });
    expect(first.status).toBe(200);

    // Second approve — 409
    const second = await request(app)
      .post(`/api/label-artwork/${artworkId}/approve`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD });
    expect(second.status).toBe(409);
    expect((second.body as { code: string }).code).toBe("ARTWORK_INVALID_STATE");
  });

  // ─── POST /api/label-artwork/:id/retire ─────────────────────────────────────

  it("POST /api/label-artwork/:id/retire — 400 when password missing", async () => {
    // Create and approve artwork first
    const createRes = await request(app)
      .post("/api/label-artwork")
      .set("x-test-user-id", qaId)
      .send(artworkBody(`retire-nopass-${Date.now()}`));
    expect(createRes.status).toBe(201);
    const artworkId = (createRes.body as { id: string }).id;
    createdArtworkIds.push(artworkId);
    await request(app)
      .post(`/api/label-artwork/${artworkId}/approve`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD });

    const res = await request(app)
      .post(`/api/label-artwork/${artworkId}/retire`)
      .set("x-test-user-id", qaId)
      .send({});
    expect(res.status).toBe(400);
  });

  it("POST /api/label-artwork/:id/retire — 404 for unknown id", async () => {
    const res = await request(app)
      .post("/api/label-artwork/00000000-0000-0000-0000-000000000000/retire")
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD });
    expect(res.status).toBe(404);
  });

  it("POST /api/label-artwork/:id/retire — 409 when DRAFT (cannot retire without prior approval)", async () => {
    const createRes = await request(app)
      .post("/api/label-artwork")
      .set("x-test-user-id", qaId)
      .send(artworkBody(`retire-draft-${Date.now()}`));
    expect(createRes.status).toBe(201);
    const artworkId = (createRes.body as { id: string }).id;
    createdArtworkIds.push(artworkId);

    const res = await request(app)
      .post(`/api/label-artwork/${artworkId}/retire`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD });
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe("ARTWORK_INVALID_STATE");
  });

  it("POST /api/label-artwork/:id/retire — 401 for wrong password", async () => {
    const createRes = await request(app)
      .post("/api/label-artwork")
      .set("x-test-user-id", qaId)
      .send(artworkBody(`retire-badpass-${Date.now()}`));
    expect(createRes.status).toBe(201);
    const artworkId = (createRes.body as { id: string }).id;
    createdArtworkIds.push(artworkId);

    // Approve first so retire can attempt
    await request(app)
      .post(`/api/label-artwork/${artworkId}/approve`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD });

    const res = await request(app)
      .post(`/api/label-artwork/${artworkId}/retire`)
      .set("x-test-user-id", qaId)
      .send({ password: "wrong-password-definitely" });
    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error?.code).toBe("UNAUTHENTICATED");
  });

  it("POST /api/label-artwork/:id/retire — 200 APPROVED→RETIRED with valid password", async () => {
    const createRes = await request(app)
      .post("/api/label-artwork")
      .set("x-test-user-id", qaId)
      .send(artworkBody(`retire-ok-${Date.now()}`));
    expect(createRes.status).toBe(201);
    const artworkId = (createRes.body as { id: string }).id;
    createdArtworkIds.push(artworkId);

    // Approve first
    const approveRes = await request(app)
      .post(`/api/label-artwork/${artworkId}/approve`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD });
    expect(approveRes.status).toBe(200);

    // Now retire
    const res = await request(app)
      .post(`/api/label-artwork/${artworkId}/retire`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("RETIRED");
    expect((res.body as { retiredBySignatureId: string | null }).retiredBySignatureId).toBeTruthy();
  });
});
