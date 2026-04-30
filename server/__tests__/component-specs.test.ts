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
let qaId: string;
let productId: string;
let specId: string;
let versionId: string;
let attributeId: string;
let secondVersionId: string;

describeIfDb("Component Specifications lifecycle", () => {
  beforeAll(async () => {
    app = await buildTestApp();
    const sfx = Date.now();

    const [qa] = await db
      .insert(schema.users)
      .values({
        email: `cs-qa-${sfx}@t.com`,
        fullName: "CS QA",
        passwordHash: await hashPassword(VALID_PASSWORD),
        createdByUserId: null as unknown as string,
      })
      .returning();
    qaId = qa!.id;
    await db.insert(schema.userRoles).values({
      userId: qaId,
      role: "QA",
      grantedByUserId: qaId,
    });

    const [p] = await db
      .insert(schema.products)
      .values({
        name: `CS TestComponent ${sfx}`,
        sku: `CS-SKU-${sfx}`,
        category: "ACTIVE_INGREDIENT",
        defaultUom: "kg",
      })
      .returning();
    productId = p!.id;
  });

  afterAll(async () => {
    // Clean up in reverse FK order
    if (secondVersionId) {
      await db
        .delete(schema.componentSpecAttributes)
        .where(eq(schema.componentSpecAttributes.specVersionId, secondVersionId))
        .catch(() => {});
      await db
        .delete(schema.componentSpecVersions)
        .where(eq(schema.componentSpecVersions.id, secondVersionId))
        .catch(() => {});
    }
    if (specId) {
      await db
        .delete(schema.componentSpecAttributes)
        .where(eq(schema.componentSpecAttributes.specVersionId, versionId))
        .catch(() => {});
      await db
        .delete(schema.componentSpecVersions)
        .where(eq(schema.componentSpecVersions.specId, specId))
        .catch(() => {});
      await db
        .delete(schema.componentSpecs)
        .where(eq(schema.componentSpecs.id, specId))
        .catch(() => {});
    }
    if (productId)
      await db.delete(schema.products).where(eq(schema.products.id, productId)).catch(() => {});
    if (qaId) {
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, qaId)).catch(() => {});
      await db.delete(schema.users).where(eq(schema.users.id, qaId)).catch(() => {});
    }
  });

  it("1. GET /api/component-specs returns 200 with array", async () => {
    const res = await request(app).get("/api/component-specs").set("x-test-user-id", qaId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Our product should appear in the list even without a spec yet
    const found = res.body.find((s: { productId: string }) => s.productId === productId);
    expect(found).toBeDefined();
  });

  it("2. POST /api/component-specs creates spec with v1 DRAFT", async () => {
    const res = await request(app)
      .post("/api/component-specs")
      .set("x-test-user-id", qaId)
      .send({ productId });
    expect(res.status).toBe(201);
    expect(res.body.productId).toBe(productId);
    expect(Array.isArray(res.body.versions)).toBe(true);
    expect(res.body.versions).toHaveLength(1);
    expect(res.body.versions[0].status).toBe("DRAFT");
    expect(res.body.versions[0].versionNumber).toBe(1);
    specId = res.body.id;
    versionId = res.body.versions[0].id;
  });

  it("3. GET /api/component-specs/:specId returns 200 with full spec", async () => {
    const res = await request(app)
      .get(`/api/component-specs/${specId}`)
      .set("x-test-user-id", qaId);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(specId);
    expect(Array.isArray(res.body.versions)).toBe(true);
  });

  it("4. POST attributes → 201, attribute added", async () => {
    const res = await request(app)
      .post(`/api/component-specs/${specId}/versions/${versionId}/attributes`)
      .set("x-test-user-id", qaId)
      .send({
        name: "Moisture Content",
        category: "PHYSICAL",
        specMin: "0",
        specMax: "5",
        units: "%",
        testMethod: "USP <731>",
        sortOrder: 0,
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Moisture Content");
    expect(res.body.category).toBe("PHYSICAL");
    attributeId = res.body.id;
  });

  it("5. PATCH attribute → 200, attribute updated", async () => {
    const res = await request(app)
      .patch(`/api/component-specs/${specId}/versions/${versionId}/attributes/${attributeId}`)
      .set("x-test-user-id", qaId)
      .send({
        name: "Moisture Content (updated)",
        category: "PHYSICAL",
        specMin: "0",
        specMax: "4",
        units: "%",
        testMethod: "USP <731>",
        sortOrder: 0,
      });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Moisture Content (updated)");
    expect(res.body.specMax).toBe("4");
  });

  it("6. POST approve with valid password → 200, status APPROVED", async () => {
    const res = await request(app)
      .post(`/api/component-specs/${specId}/versions/${versionId}/approve`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD, commentary: "Approved in test" });
    expect(res.status).toBe(200);
    const approvedVersion = res.body.versions.find((v: { id: string }) => v.id === versionId);
    expect(approvedVersion).toBeDefined();
    expect(approvedVersion.status).toBe("APPROVED");
  });

  it("7. GET /api/component-specs/by-product/:productId → 200, active version returned", async () => {
    const res = await request(app)
      .get(`/api/component-specs/by-product/${productId}`)
      .set("x-test-user-id", qaId);
    expect(res.status).toBe(200);
    expect(res.body).not.toBeNull();
    expect(res.body.version).toBeDefined();
    expect(res.body.version.status).toBe("APPROVED");
    expect(Array.isArray(res.body.attributes)).toBe(true);
  });

  it("8. POST /:specId/versions creates new DRAFT v2", async () => {
    const res = await request(app)
      .post(`/api/component-specs/${specId}/versions`)
      .set("x-test-user-id", qaId);
    expect(res.status).toBe(201);
    expect(res.body.versionNumber).toBe(2);
    expect(res.body.status).toBe("DRAFT");
    secondVersionId = res.body.id;
  });

  it("10. Cannot approve already-approved version → 400", async () => {
    const res = await request(app)
      .post(`/api/component-specs/${specId}/versions/${versionId}/approve`)
      .set("x-test-user-id", qaId)
      .send({ password: VALID_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/DRAFT/i);
  });

  it("9. DELETE /versions/:vId on a DRAFT → 204", async () => {
    const res = await request(app)
      .delete(`/api/component-specs/${specId}/versions/${secondVersionId}`)
      .set("x-test-user-id", qaId);
    expect(res.status).toBe(204);
    secondVersionId = ""; // already deleted, skip afterAll cleanup
  });
});
