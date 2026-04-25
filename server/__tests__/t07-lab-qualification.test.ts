import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";
import { eq, and, desc } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const VALID_PASSWORD = "Neurogan1!Secure";

let app: Express;
let qaUserId: string;
let labId: string;
let inHouseLabId: string;
let coaId: string;
let lotId: string;

beforeAll(async () => {
  if (!dbUrl) return;
  app = await buildTestApp();
  const suffix = Date.now();

  const [qaUser] = await db.insert(schema.users).values({
    email: `t07-qa-${suffix}@test.com`,
    fullName: "T07 QA User",
    passwordHash: await hashPassword(VALID_PASSWORD),
    createdByUserId: null as unknown as string,
  }).returning();
  qaUserId = qaUser!.id;
  await db.insert(schema.userRoles).values({ userId: qaUserId, role: "QA", grantedByUserId: qaUserId });

  const [lab] = await db.insert(schema.labs).values({
    name: `T07-ThirdParty-${suffix}`,
    type: "THIRD_PARTY",
    status: "ACTIVE",
  }).returning();
  labId = lab!.id;

  const [ihLab] = await db.insert(schema.labs).values({
    name: `T07-InHouse-${suffix}`,
    type: "IN_HOUSE",
    status: "ACTIVE",
  }).returning();
  inHouseLabId = ihLab!.id;

  const [product] = await db.insert(schema.products).values({
    name: `T07-Product-${suffix}`,
    sku: `T07-SKU-${suffix}`,
    category: "ACTIVE_INGREDIENT",
    defaultUom: "g",
    status: "ACTIVE",
  }).returning();
  const [supplier] = await db.insert(schema.suppliers).values({ name: `T07-Supplier-${suffix}` }).returning();
  const [lot] = await db.insert(schema.lots).values({
    productId: product!.id,
    lotNumber: `T07-LOT-${suffix}`,
    supplierName: supplier!.name,
    quarantineStatus: "PENDING_QC",
  }).returning();
  lotId = lot!.id;

  const [coa] = await db.insert(schema.coaDocuments).values({
    lotId: lot!.id,
    labId: labId,
    sourceType: "THIRD_PARTY_LAB",
    overallResult: "PASS",
  }).returning();
  coaId = coa!.id;
});

afterAll(async () => {
  if (!dbUrl) return;
  await db.delete(schema.labQualifications).where(eq(schema.labQualifications.labId, labId)).catch(() => {});
  await db.delete(schema.coaDocuments).where(eq(schema.coaDocuments.id, coaId)).catch(() => {});
  await db.delete(schema.lots).where(eq(schema.lots.id, lotId)).catch(() => {});
  await db.delete(schema.labs).where(eq(schema.labs.id, labId)).catch(() => {});
  await db.delete(schema.labs).where(eq(schema.labs.id, inHouseLabId)).catch(() => {});
  // Delete audit trail rows referencing the lab (by entityId) and the user (by userId)
  await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, labId)).catch(() => {});
  await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, qaUserId)).catch(() => {});
  // Delete electronic signatures referencing the lab (by entityId) and the user (by userId)
  await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.entityId, labId)).catch(() => {});
  await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.userId, qaUserId)).catch(() => {});
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, qaUserId));
  await db.delete(schema.users).where(eq(schema.users.id, qaUserId));
});

describeIfDb("T07 — lab qualification lifecycle", () => {
  it("POST /api/labs/:id/qualify — 400 for IN_HOUSE lab", async () => {
    const res = await request(app)
      .post(`/api/labs/${inHouseLabId}/qualify`)
      .set("x-test-user-id", qaUserId)
      .send({ qualificationMethod: "ACCREDITATION_REVIEW", requalificationFrequencyMonths: 24, signaturePassword: VALID_PASSWORD });
    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(/THIRD_PARTY/i);
  });

  it("POST /api/labs/:id/qualify — 401 for wrong password", async () => {
    const res = await request(app)
      .post(`/api/labs/${labId}/qualify`)
      .set("x-test-user-id", qaUserId)
      .send({ qualificationMethod: "ACCREDITATION_REVIEW", requalificationFrequencyMonths: 24, signaturePassword: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("POST /api/labs/:id/qualify — 200: creates record, sets status ACTIVE, emits LAB_QUALIFIED audit row", async () => {
    const res = await request(app)
      .post(`/api/labs/${labId}/qualify`)
      .set("x-test-user-id", qaUserId)
      .send({
        qualificationMethod: "ACCREDITATION_REVIEW",
        requalificationFrequencyMonths: 24,
        notes: "ISO 17025 verified",
        signaturePassword: VALID_PASSWORD,
      });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("ACTIVE");

    const [qual] = await db
      .select()
      .from(schema.labQualifications)
      .where(and(eq(schema.labQualifications.labId, labId), eq(schema.labQualifications.eventType, "QUALIFIED")))
      .orderBy(desc(schema.labQualifications.performedAt))
      .limit(1);
    expect(qual?.qualificationMethod).toBe("ACCREDITATION_REVIEW");
    expect(qual?.requalificationFrequencyMonths).toBe(24);
    expect(qual?.nextRequalificationDue).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const [auditRow] = await db
      .select({ action: schema.auditTrail.action })
      .from(schema.auditTrail)
      .where(and(eq(schema.auditTrail.entityId, labId), eq(schema.auditTrail.action, "LAB_QUALIFIED")))
      .limit(1);
    expect(auditRow?.action).toBe("LAB_QUALIFIED");
  });

  it("GET /api/labs/:id/qualifications — returns history array newest-first with performedByName", async () => {
    const res = await request(app)
      .get(`/api/labs/${labId}/qualifications`)
      .set("x-test-user-id", qaUserId);
    expect(res.status).toBe(200);
    const body = res.body as Array<{ eventType: string; performedByName: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]!.eventType).toBe("QUALIFIED");
    expect(body[0]!.performedByName).toBeTruthy();
  });

  it("Gate 3c: qualified, current THIRD_PARTY lab → COA QC review 200", async () => {
    const res = await request(app)
      .post(`/api/coa/${coaId}/qc-review`)
      .set("x-test-user-id", qaUserId)
      .send({ accepted: true, notes: "all good", password: VALID_PASSWORD });
    expect(res.status).toBe(200);
  });

  it("Gate 3c: unqualified THIRD_PARTY lab → 422 'not been qualified'", async () => {
    const suffix2 = Date.now();
    const [unqualLab] = await db.insert(schema.labs).values({
      name: `T07-UnqualLab-${suffix2}`,
      type: "THIRD_PARTY",
      status: "ACTIVE",
    }).returning();
    const [unqualCoa] = await db.insert(schema.coaDocuments).values({
      lotId,
      labId: unqualLab!.id,
      sourceType: "THIRD_PARTY_LAB",
      overallResult: "PASS",
    }).returning();

    const res = await request(app)
      .post(`/api/coa/${unqualCoa!.id}/qc-review`)
      .set("x-test-user-id", qaUserId)
      .send({ accepted: true, password: VALID_PASSWORD });
    expect(res.status).toBe(422);
    expect((res.body as { message: string }).message).toMatch(/not been qualified/i);

    await db.delete(schema.coaDocuments).where(eq(schema.coaDocuments.id, unqualCoa!.id));
    await db.delete(schema.labs).where(eq(schema.labs.id, unqualLab!.id));
  });

  it("Gate 3c: overdue THIRD_PARTY lab → 422 'overdue'", async () => {
    const suffix3 = Date.now();
    const [overdueLab] = await db.insert(schema.labs).values({
      name: `T07-OverdueLab-${suffix3}`,
      type: "THIRD_PARTY",
      status: "ACTIVE",
    }).returning();
    await db.insert(schema.labQualifications).values({
      labId: overdueLab!.id,
      eventType: "QUALIFIED",
      performedByUserId: qaUserId,
      qualificationMethod: "ACCREDITATION_REVIEW",
      requalificationFrequencyMonths: 24,
      nextRequalificationDue: "2020-01-01",
    });
    const [overdueCoa] = await db.insert(schema.coaDocuments).values({
      lotId,
      labId: overdueLab!.id,
      sourceType: "THIRD_PARTY_LAB",
      overallResult: "PASS",
    }).returning();

    const res = await request(app)
      .post(`/api/coa/${overdueCoa!.id}/qc-review`)
      .set("x-test-user-id", qaUserId)
      .send({ accepted: true, password: VALID_PASSWORD });
    expect(res.status).toBe(422);
    expect((res.body as { message: string }).message).toMatch(/overdue/i);

    await db.delete(schema.coaDocuments).where(eq(schema.coaDocuments.id, overdueCoa!.id));
    await db.delete(schema.labQualifications).where(eq(schema.labQualifications.labId, overdueLab!.id));
    await db.delete(schema.labs).where(eq(schema.labs.id, overdueLab!.id));
  });

  it("Gate 3c: IN_HOUSE lab with no qualification record → 200 (exempt)", async () => {
    const [ihCoa] = await db.insert(schema.coaDocuments).values({
      lotId,
      labId: inHouseLabId,
      sourceType: "INTERNAL_LAB",
      overallResult: "PASS",
    }).returning();

    const res = await request(app)
      .post(`/api/coa/${ihCoa!.id}/qc-review`)
      .set("x-test-user-id", qaUserId)
      .send({ accepted: true, password: VALID_PASSWORD });
    expect(res.status).toBe(200);

    await db.delete(schema.coaDocuments).where(eq(schema.coaDocuments.id, ihCoa!.id));
  });

  it("POST /api/labs/:id/disqualify — 200: record DISQUALIFIED, status DISQUALIFIED, audit LAB_DISQUALIFIED", async () => {
    const res = await request(app)
      .post(`/api/labs/${labId}/disqualify`)
      .set("x-test-user-id", qaUserId)
      .send({ notes: "Failed proficiency test", signaturePassword: VALID_PASSWORD });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("DISQUALIFIED");

    const [qual] = await db
      .select()
      .from(schema.labQualifications)
      .where(and(eq(schema.labQualifications.labId, labId), eq(schema.labQualifications.eventType, "DISQUALIFIED")))
      .limit(1);
    expect(qual?.eventType).toBe("DISQUALIFIED");

    const [auditRow] = await db
      .select({ action: schema.auditTrail.action })
      .from(schema.auditTrail)
      .where(and(eq(schema.auditTrail.entityId, labId), eq(schema.auditTrail.action, "LAB_DISQUALIFIED")))
      .limit(1);
    expect(auditRow?.action).toBe("LAB_DISQUALIFIED");
  });

  it("POST /api/labs/:id/qualify — requalify a disqualified lab → status ACTIVE", async () => {
    const res = await request(app)
      .post(`/api/labs/${labId}/qualify`)
      .set("x-test-user-id", qaUserId)
      .send({
        qualificationMethod: "ON_SITE_AUDIT",
        requalificationFrequencyMonths: 12,
        signaturePassword: VALID_PASSWORD,
      });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("ACTIVE");
  });
});
