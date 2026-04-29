import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";

const PASS = "Test1234!Password";
const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

describeIfDb("R-06 returned-products routes", () => {
  let app: Express;
  let qaUser: schema.User;
  let receivingUser: schema.User;
  let labTechUser: schema.User;
  let lotId: string;

  beforeAll(async () => { app = await buildTestApp(); });

  afterAll(async () => {
    await db.delete(schema.returnInvestigations);
    await db.delete(schema.electronicSignatures);
    await db.delete(schema.returnedProducts);
    await db.delete(schema.auditTrail);
    await db.delete(schema.passwordHistory);
    await db.delete(schema.userRoles);
    await db.delete(schema.users);
    await db.delete(schema.lots);
    await db.delete(schema.products);
  });

  beforeEach(async () => {
    await db.delete(schema.returnInvestigations);
    await db.delete(schema.returnedProducts);

    [qaUser] = await db.insert(schema.users).values({ email: `qa-${Date.now()}@t.local`, fullName: "QA", passwordHash: await hashPassword(PASS), status: "ACTIVE" }).returning();
    await db.insert(schema.userRoles).values({ userId: qaUser.id, role: "QA", grantedByUserId: qaUser.id });

    [receivingUser] = await db.insert(schema.users).values({ email: `rcv-${Date.now()}@t.local`, fullName: "Rcv", passwordHash: await hashPassword(PASS), status: "ACTIVE" }).returning();
    await db.insert(schema.userRoles).values({ userId: receivingUser.id, role: "WAREHOUSE", grantedByUserId: qaUser.id });

    [labTechUser] = await db.insert(schema.users).values({ email: `lt-${Date.now()}@t.local`, fullName: "LT", passwordHash: await hashPassword(PASS), status: "ACTIVE" }).returning();
    await db.insert(schema.userRoles).values({ userId: labTechUser.id, role: "LAB_TECH", grantedByUserId: qaUser.id });

    const [product] = await db.insert(schema.products).values({ sku: `P-${Date.now()}`, name: "P" }).returning();
    const [lot] = await db.insert(schema.lots).values({ productId: product.id, lotNumber: `LOT-${Date.now()}`, quarantineStatus: "APPROVED" }).returning();
    lotId = lot.id;
  });

  it("POST /api/returned-products — 201 for WAREHOUSE", async () => {
    const res = await request(app)
      .post("/api/returned-products")
      .set("x-test-user-id", receivingUser.id)
      .send({ source: "AMAZON_FBA", lotCodeRaw: "LOT-001", lotId, qtyReturned: 5, uom: "UNITS", receivedAt: new Date().toISOString() });
    expect(res.status).toBe(201);
    expect(res.body.returnedProduct.status).toBe("QUARANTINE");
  });

  it("POST /api/returned-products — 403 for LAB_TECH", async () => {
    const res = await request(app)
      .post("/api/returned-products")
      .set("x-test-user-id", labTechUser.id)
      .send({ source: "AMAZON_FBA", lotCodeRaw: "LOT-001", lotId, qtyReturned: 5, uom: "UNITS", receivedAt: new Date().toISOString() });
    expect(res.status).toBe(403);
  });

  it("GET /api/returned-products — returns list for QA", async () => {
    await request(app)
      .post("/api/returned-products")
      .set("x-test-user-id", qaUser.id)
      .send({ source: "WHOLESALE", lotCodeRaw: "LOT-001", lotId, qtyReturned: 3, uom: "UNITS", receivedAt: new Date().toISOString() });
    const res = await request(app).get("/api/returned-products").set("x-test-user-id", qaUser.id);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/returned-products/:id — 200 for QA", async () => {
    const create = await request(app)
      .post("/api/returned-products")
      .set("x-test-user-id", qaUser.id)
      .send({ source: "AMAZON_FBA", lotCodeRaw: "LOT-001", lotId, qtyReturned: 2, uom: "UNITS", receivedAt: new Date().toISOString() });
    const res = await request(app).get(`/api/returned-products/${create.body.returnedProduct.id}`).set("x-test-user-id", qaUser.id);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(create.body.returnedProduct.id);
  });

  it("POST /api/returned-products/:id/disposition — 200 on valid F-04", async () => {
    const create = await request(app)
      .post("/api/returned-products")
      .set("x-test-user-id", qaUser.id)
      .send({ source: "AMAZON_FBA", lotCodeRaw: "LOT-001", lotId, qtyReturned: 2, uom: "UNITS", receivedAt: new Date().toISOString() });
    const res = await request(app)
      .post(`/api/returned-products/${create.body.returnedProduct.id}/disposition`)
      .set("x-test-user-id", qaUser.id)
      .send({ disposition: "DESTROY", password: PASS });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DISPOSED");
    expect(res.body.disposition).toBe("DESTROY");
    expect(res.body.dispositionSignatureId).toBeDefined();
  });

  it("POST /api/returned-products/:id/disposition — 401 on bad password", async () => {
    const create = await request(app)
      .post("/api/returned-products")
      .set("x-test-user-id", qaUser.id)
      .send({ source: "AMAZON_FBA", lotCodeRaw: "LOT-001", lotId, qtyReturned: 2, uom: "UNITS", receivedAt: new Date().toISOString() });
    const res = await request(app)
      .post(`/api/returned-products/${create.body.returnedProduct.id}/disposition`)
      .set("x-test-user-id", qaUser.id)
      .send({ disposition: "DESTROY", password: "WrongPass1!" });
    expect(res.status).toBe(401);
  });

  it("GET /api/returned-products/summary — returns counts", async () => {
    const res = await request(app).get("/api/returned-products/summary").set("x-test-user-id", qaUser.id);
    expect(res.status).toBe(200);
    expect(typeof res.body.awaitingDisposition).toBe("number");
    expect(typeof res.body.openInvestigations).toBe("number");
  });

  it("GET /api/return-investigations — returns list", async () => {
    const res = await request(app).get("/api/return-investigations").set("x-test-user-id", qaUser.id);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/return-investigations/:id — 200 for QA", async () => {
    // Seed threshold to 1 so first return triggers investigation
    await db.insert(schema.appSettingsKv).values({ key: "returnsInvestigationThresholdCount", value: "1" })
      .onConflictDoUpdate({ target: schema.appSettingsKv.key, set: { value: "1" } });

    await request(app)
      .post("/api/returned-products")
      .set("x-test-user-id", qaUser.id)
      .send({ source: "AMAZON_FBA", lotCodeRaw: "LOT-001", lotId, qtyReturned: 1, uom: "UNITS", receivedAt: new Date().toISOString() });

    const invList = await request(app).get("/api/return-investigations").set("x-test-user-id", qaUser.id);
    expect(invList.body.length).toBeGreaterThanOrEqual(1);

    const invId = invList.body[0].id;
    const res = await request(app).get(`/api/return-investigations/${invId}`).set("x-test-user-id", qaUser.id);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(invId);

    // reset threshold
    await db.insert(schema.appSettingsKv).values({ key: "returnsInvestigationThresholdCount", value: "3" })
      .onConflictDoUpdate({ target: schema.appSettingsKv.key, set: { value: "3" } });
  });

  it("POST /api/return-investigations/:id/close — 200 on valid F-04", async () => {
    await db.insert(schema.appSettingsKv).values({ key: "returnsInvestigationThresholdCount", value: "1" })
      .onConflictDoUpdate({ target: schema.appSettingsKv.key, set: { value: "1" } });

    await request(app)
      .post("/api/returned-products")
      .set("x-test-user-id", qaUser.id)
      .send({ source: "AMAZON_FBA", lotCodeRaw: "LOT-001", lotId, qtyReturned: 1, uom: "UNITS", receivedAt: new Date().toISOString() });

    const invList = await request(app).get("/api/return-investigations").set("x-test-user-id", qaUser.id);
    const invId = invList.body[0].id;

    const res = await request(app)
      .post(`/api/return-investigations/${invId}/close`)
      .set("x-test-user-id", qaUser.id)
      .send({ rootCause: "Quality issue identified", correctiveAction: "Supplier notified", password: PASS });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CLOSED");
    expect(res.body.rootCause).toBe("Quality issue identified");
    expect(res.body.closeSignatureId).toBeDefined();

    await db.insert(schema.appSettingsKv).values({ key: "returnsInvestigationThresholdCount", value: "3" })
      .onConflictDoUpdate({ target: schema.appSettingsKv.key, set: { value: "3" } });
  });
});
