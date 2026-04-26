import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../auth/password";
import { storage } from "../storage";

const PASS = "Test1234!Password";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

describeIfDb("OOS investigation routes", () => {
  let app: Express;
  let qaUser: schema.User;
  let labTechUser: schema.User;
  let lotId: string;
  let coaId: string;
  let investigationId: string;
  let labTestResultId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await db.delete(schema.oosInvestigationTestResults);
    await db.delete(schema.oosInvestigations);
    await db.delete(schema.oosInvestigationCounter);
    await db.delete(schema.labTestResults);
    await db.update(schema.validationDocuments).set({ signatureId: null });
    await db.delete(schema.electronicSignatures);
    await db.delete(schema.coaDocuments);
    await db.delete(schema.auditTrail);
    await db.delete(schema.passwordHistory);
    await db.delete(schema.userRoles);
    await db.delete(schema.users);
    await db.delete(schema.lots);
    await db.delete(schema.products);
  });

  beforeEach(async () => {
    [qaUser] = await db.insert(schema.users).values({
      email: `qa-${Date.now()}@test.local`,
      fullName: "QA Tester",
      passwordHash: await hashPassword(PASS),
      status: "ACTIVE",
    }).returning();
    await db.insert(schema.userRoles).values({ userId: qaUser.id, role: "QA", grantedByUserId: qaUser.id });

    [labTechUser] = await db.insert(schema.users).values({
      email: `lt-${Date.now()}@test.local`,
      fullName: "Lab Tech",
      passwordHash: await hashPassword(PASS),
      status: "ACTIVE",
    }).returning();
    await db.insert(schema.userRoles).values({ userId: labTechUser.id, role: "LAB_TECH", grantedByUserId: labTechUser.id });

    const [product] = await db.insert(schema.products).values({ sku: `P-${Date.now()}`, name: "P" }).returning();
    const [lot] = await db.insert(schema.lots).values({
      productId: product.id, lotNumber: `LOT-${Date.now()}`, quarantineStatus: "PENDING_QC",
    }).returning();
    lotId = lot.id;
    const [coa] = await db.insert(schema.coaDocuments).values({ lotId }).returning();
    coaId = coa.id;
    const [tr] = await db.insert(schema.labTestResults).values({
      coaDocumentId: coaId, analyteName: "potency", resultValue: "85",
      specMin: "90", specMax: "110", pass: false, testedByUserId: qaUser.id,
    }).returning();
    labTestResultId = tr.id;
    const inv = await db.transaction((tx) => storage.getOrCreateOpenOosInvestigation(coaId, lotId, labTestResultId, qaUser.id, "rid", "POST /seed", tx));
    investigationId = inv.id;
  });

  it("GET /api/oos-investigations defaults to OPEN", async () => {
    const res = await request(app).get("/api/oos-investigations").set("x-test-user-id", qaUser.id);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.every((i: { status: string }) => i.status === "OPEN")).toBe(true);
  });

  it("GET /api/oos-investigations/:id returns detail", async () => {
    const res = await request(app).get(`/api/oos-investigations/${investigationId}`).set("x-test-user-id", qaUser.id);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(investigationId);
    expect(res.body.testResults).toHaveLength(1);
  });

  it("POST .../assign-lead rejects LAB_TECH with 403", async () => {
    const res = await request(app)
      .post(`/api/oos-investigations/${investigationId}/assign-lead`)
      .set("x-test-user-id", labTechUser.id)
      .send({ leadInvestigatorUserId: labTechUser.id });
    expect(res.status).toBe(403);
  });

  it("POST .../assign-lead succeeds for QA", async () => {
    const res = await request(app)
      .post(`/api/oos-investigations/${investigationId}/assign-lead`)
      .set("x-test-user-id", qaUser.id)
      .send({ leadInvestigatorUserId: qaUser.id });
    expect(res.status).toBe(200);
    expect(res.body.leadInvestigatorUserId).toBe(qaUser.id);
  });

  it("POST .../retest-pending then /clear-retest toggles status", async () => {
    const r1 = await request(app).post(`/api/oos-investigations/${investigationId}/retest-pending`).set("x-test-user-id", qaUser.id).send({});
    expect(r1.status).toBe(200);
    expect(r1.body.status).toBe("RETEST_PENDING");
    const r2 = await request(app).post(`/api/oos-investigations/${investigationId}/clear-retest`).set("x-test-user-id", qaUser.id).send({});
    expect(r2.status).toBe(200);
    expect(r2.body.status).toBe("OPEN");
  });

  it("POST .../close with REJECTED disposition closes investigation and flips lot", async () => {
    await request(app).post(`/api/oos-investigations/${investigationId}/assign-lead`).set("x-test-user-id", qaUser.id).send({ leadInvestigatorUserId: qaUser.id });
    const res = await request(app)
      .post(`/api/oos-investigations/${investigationId}/close`)
      .set("x-test-user-id", qaUser.id)
      .send({
        disposition: "REJECTED",
        dispositionReason: "Confirmed OOS, lot fails spec",
        leadInvestigatorUserId: qaUser.id,
        signaturePassword: PASS,
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CLOSED");
    expect(res.body.disposition).toBe("REJECTED");
    const [lot] = await db.select().from(schema.lots).where(eq(schema.lots.id, lotId));
    expect(lot.quarantineStatus).toBe("REJECTED");
  });

  it("POST .../close with wrong password returns 401 and leaves investigation OPEN", async () => {
    await request(app).post(`/api/oos-investigations/${investigationId}/assign-lead`).set("x-test-user-id", qaUser.id).send({ leadInvestigatorUserId: qaUser.id });
    const res = await request(app)
      .post(`/api/oos-investigations/${investigationId}/close`)
      .set("x-test-user-id", qaUser.id)
      .send({
        disposition: "APPROVED", dispositionReason: "x",
        leadInvestigatorUserId: qaUser.id, signaturePassword: "wrong-password",
      });
    expect(res.status).toBe(401);
    const [inv] = await db.select().from(schema.oosInvestigations).where(eq(schema.oosInvestigations.id, investigationId));
    expect(inv.status).toBe("OPEN");
  });

  it("POST .../close on already-closed investigation returns 409", async () => {
    // First close successfully
    await request(app)
      .post(`/api/oos-investigations/${investigationId}/assign-lead`)
      .set("x-test-user-id", qaUser.id)
      .send({ leadInvestigatorUserId: qaUser.id });
    await request(app)
      .post(`/api/oos-investigations/${investigationId}/close`)
      .set("x-test-user-id", qaUser.id)
      .send({
        disposition: "APPROVED",
        dispositionReason: "Lab error confirmed, lot passes spec",
        leadInvestigatorUserId: qaUser.id,
        signaturePassword: PASS,
      });
    // Attempt to close again — should return 409
    const res = await request(app)
      .post(`/api/oos-investigations/${investigationId}/close`)
      .set("x-test-user-id", qaUser.id)
      .send({
        disposition: "APPROVED",
        dispositionReason: "Duplicate close attempt",
        leadInvestigatorUserId: qaUser.id,
        signaturePassword: PASS,
      });
    expect(res.status).toBe(409);
  });

  it("POST .../mark-no-investigation-needed closes with NO_INVESTIGATION_NEEDED", async () => {
    const res = await request(app)
      .post(`/api/oos-investigations/${investigationId}/mark-no-investigation-needed`)
      .set("x-test-user-id", qaUser.id)
      .send({
        reason: "LAB_ERROR",
        reasonNarrative: "Operator pipetting error during sample prep",
        leadInvestigatorUserId: qaUser.id,
        signaturePassword: PASS,
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CLOSED");
    expect(res.body.disposition).toBe("NO_INVESTIGATION_NEEDED");
    expect(res.body.noInvestigationReason).toBe("LAB_ERROR");
  });
});
