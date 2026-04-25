import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { db } from "../db";
import * as schema from "@shared/schema";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const VALID_PASSWORD = "Neurogan1!Secure";

async function seedAdmin(email: string) {
  const hash = await hashPassword(VALID_PASSWORD);
  return storage.createUser({
    email,
    fullName: "Test Admin",
    title: "Administrator",
    passwordHash: hash,
    roles: ["ADMIN"],
    createdByUserId: null,
    grantedByUserId: null,
  });
}

async function seedViewer(email: string, adminId: string) {
  const hash = await hashPassword(VALID_PASSWORD);
  return storage.createUser({
    email,
    fullName: "Test Viewer",
    title: null,
    passwordHash: hash,
    roles: ["VIEWER"],
    createdByUserId: adminId,
    grantedByUserId: adminId,
  });
}

async function cleanDb() {
  await db.update(schema.validationDocuments).set({ signatureId: null });
  await db.delete(schema.electronicSignatures);
  await db.delete(schema.auditTrail);
  await db.delete(schema.passwordHistory);
  await db.delete(schema.userRoles);
  await db.delete(schema.users);
  await db.delete(schema.labs);
}

describeIfDb("R-01 — labs registry", () => {
  let app: Express;
  let adminId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await cleanDb();
    const admin = await seedAdmin("admin@labs.test");
    adminId = admin.id;
  });

  afterAll(async () => {
    await cleanDb();
  });

  it("GET /api/labs returns seeded labs for ADMIN", async () => {
    const res = await request(app)
      .get("/api/labs")
      .set("x-test-user-id", adminId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /api/labs creates a lab", async () => {
    const res = await request(app)
      .post("/api/labs")
      .set("x-test-user-id", adminId)
      .send({ name: "Test Lab", address: "123 Main St", type: "THIRD_PARTY" });
    expect(res.status).toBe(201);
    expect((res.body as { name: string }).name).toBe("Test Lab");
  });

  it("PATCH /api/labs/:id deactivates a lab", async () => {
    const created = await request(app)
      .post("/api/labs")
      .set("x-test-user-id", adminId)
      .send({ name: "Lab To Deactivate", address: "", type: "THIRD_PARTY" });
    const labId = (created.body as { id: string }).id;

    const res = await request(app)
      .patch(`/api/labs/${labId}`)
      .set("x-test-user-id", adminId)
      .send({ status: "INACTIVE" });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("INACTIVE");
  });

  it("GET /api/labs returns 403 for VIEWER", async () => {
    const viewer = await seedViewer("viewer@labs.test", adminId);
    const res = await request(app)
      .get("/api/labs")
      .set("x-test-user-id", viewer.id);
    expect(res.status).toBe(403);
  });

  it("POST /api/labs returns 403 for VIEWER", async () => {
    const viewer = await seedViewer("viewer-post@labs.test", adminId);
    const res = await request(app)
      .post("/api/labs")
      .set("x-test-user-id", viewer.id)
      .send({ name: "Unauthorized Lab", type: "THIRD_PARTY" });
    expect(res.status).toBe(403);
  });

  it("PATCH /api/labs/:id returns 403 for VIEWER", async () => {
    const created = await request(app)
      .post("/api/labs")
      .set("x-test-user-id", adminId)
      .send({ name: "Lab For Patch Auth Test", type: "IN_HOUSE" });
    const viewer = await seedViewer("viewer-patch@labs.test", adminId);
    const res = await request(app)
      .patch(`/api/labs/${(created.body as { id: string }).id}`)
      .set("x-test-user-id", viewer.id)
      .send({ status: "INACTIVE" });
    expect(res.status).toBe(403);
  });
});
