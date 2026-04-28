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
let artworkId: string;
const createdSpoolIds: string[] = [];

beforeAll(async () => {
  if (!dbUrl) return;
  app = await buildTestApp();
  const sfx = Date.now();

  const [adm] = await db
    .insert(schema.users)
    .values({
      email: `r04sp-adm-${sfx}@t.com`,
      fullName: "R04Spools Admin",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: null as unknown as string,
    })
    .returning();
  adminId = adm!.id;
  await db.insert(schema.userRoles).values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });

  const [qa] = await db
    .insert(schema.users)
    .values({
      email: `r04sp-qa-${sfx}@t.com`,
      fullName: "R04Spools QA",
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
      email: `r04sp-wh-${sfx}@t.com`,
      fullName: "R04Spools WH",
      passwordHash: await hashPassword(VALID_PASSWORD),
      createdByUserId: adminId,
    })
    .returning();
  whId = wh!.id;
  await db.insert(schema.userRoles).values({ userId: whId, role: "WAREHOUSE", grantedByUserId: adminId });

  const [prod] = await db
    .insert(schema.products)
    .values({ sku: `R04SP-${sfx}`, name: "R04 Spools Test Product" })
    .returning();
  productId = prod!.id;

  // Create and approve artwork so spools can reference it.
  const createRes = await request(app)
    .post("/api/label-artwork")
    .set("x-test-user-id", qaId)
    .send({
      productId,
      version: `v1.0-sp-${sfx}`,
      artworkFileName: `label-sp-${sfx}.pdf`,
      artworkFileData: "base64dataplaceholder",
      artworkMimeType: "application/pdf",
      variableDataSpec: { lotNumber: true },
    });
  artworkId = (createRes.body as { id: string }).id;

  await request(app)
    .post(`/api/label-artwork/${artworkId}/approve`)
    .set("x-test-user-id", qaId)
    .send({ password: VALID_PASSWORD });
});

afterAll(async () => {
  if (!dbUrl) return;

  // Clean up spools (signatures + audit + spool rows).
  for (const id of createdSpoolIds) {
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, id)).catch(() => {});
    await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.entityId, id)).catch(() => {});
    await db.delete(schema.labelSpools).where(eq(schema.labelSpools.id, id)).catch(() => {});
  }

  // Clean up artwork.
  if (artworkId) {
    await db
      .update(schema.labelArtwork)
      .set({ approvedBySignatureId: null, retiredBySignatureId: null })
      .where(eq(schema.labelArtwork.id, artworkId))
      .catch(() => {});
    await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, artworkId)).catch(() => {});
    await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.entityId, artworkId)).catch(() => {});
    await db.delete(schema.labelArtwork).where(eq(schema.labelArtwork.id, artworkId)).catch(() => {});
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

describeIfDb("R-04 label spool routes", () => {
  // ─── POST /api/label-spools ──────────────────────────────────────────────────

  it("POST /api/label-spools — 201 ACTIVE (QA user, valid password)", async () => {
    const res = await request(app)
      .post("/api/label-spools")
      .set("x-test-user-id", qaId)
      .send({
        artworkId,
        spoolNumber: `SP-QA-${Date.now()}`,
        qtyInitial: 500,
        password: VALID_PASSWORD,
      });
    expect(res.status).toBe(201);
    expect((res.body as { status: string }).status).toBe("ACTIVE");
    expect((res.body as { artworkId: string }).artworkId).toBe(artworkId);
    createdSpoolIds.push((res.body as { id: string }).id);
  });

  it("POST /api/label-spools — 403 for WAREHOUSE", async () => {
    const res = await request(app)
      .post("/api/label-spools")
      .set("x-test-user-id", whId)
      .send({
        artworkId,
        spoolNumber: `SP-WH-${Date.now()}`,
        qtyInitial: 100,
        password: VALID_PASSWORD,
      });
    expect(res.status).toBe(403);
  });

  it("POST /api/label-spools — 400 missing artworkId", async () => {
    const res = await request(app)
      .post("/api/label-spools")
      .set("x-test-user-id", qaId)
      .send({
        spoolNumber: `SP-NOART-${Date.now()}`,
        qtyInitial: 100,
        password: VALID_PASSWORD,
      });
    expect(res.status).toBe(400);
  });

  it("POST /api/label-spools — 400 missing password", async () => {
    const res = await request(app)
      .post("/api/label-spools")
      .set("x-test-user-id", qaId)
      .send({
        artworkId,
        spoolNumber: `SP-NOPASS-${Date.now()}`,
        qtyInitial: 100,
      });
    expect(res.status).toBe(400);
  });

  // ─── POST /api/label-spools/:id/dispose ─────────────────────────────────────

  it("POST /api/label-spools/:id/dispose — 200 DISPOSED", async () => {
    // Create a spool to dispose.
    const createRes = await request(app)
      .post("/api/label-spools")
      .set("x-test-user-id", qaId)
      .send({
        artworkId,
        spoolNumber: `SP-DISP-${Date.now()}`,
        qtyInitial: 200,
        password: VALID_PASSWORD,
      });
    expect(createRes.status).toBe(201);
    const spoolId = (createRes.body as { id: string }).id;
    createdSpoolIds.push(spoolId);

    const res = await request(app)
      .post(`/api/label-spools/${spoolId}/dispose`)
      .set("x-test-user-id", qaId)
      .send({ reason: "Damaged in transit" });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("DISPOSED");
    expect((res.body as { disposeReason: string }).disposeReason).toBe("Damaged in transit");
  });

  // ─── GET /api/label-spools?artworkId=... ────────────────────────────────────

  it("GET /api/label-spools?artworkId=... — 200 array includes the spool", async () => {
    // Create one spool to guarantee at least one result.
    const createRes = await request(app)
      .post("/api/label-spools")
      .set("x-test-user-id", qaId)
      .send({
        artworkId,
        spoolNumber: `SP-LIST-${Date.now()}`,
        qtyInitial: 300,
        password: VALID_PASSWORD,
      });
    expect(createRes.status).toBe(201);
    const spoolId = (createRes.body as { id: string }).id;
    createdSpoolIds.push(spoolId);

    const res = await request(app)
      .get(`/api/label-spools?artworkId=${artworkId}`)
      .set("x-test-user-id", whId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const ids = (res.body as { id: string }[]).map((s) => s.id);
    expect(ids).toContain(spoolId);
  });
});
