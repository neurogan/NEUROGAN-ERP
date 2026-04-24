import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import * as schema from "../../shared/schema";
import { storage } from "../db-storage";
import { hashPassword } from "../auth/password";
import { inArray } from "drizzle-orm";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

let adminId: string;
const seededLotIds: string[] = [];
const seededRecordIds: string[] = [];
const seededCoaIds: string[] = [];
const seededUserIds: string[] = [];

beforeAll(async () => {
  const [admin] = await db.insert(schema.users).values({
    email: `t03-admin-${Date.now()}@test.com`,
    fullName: "T03 Admin",
    passwordHash: await hashPassword("Neurogan1!Secure"),
    createdByUserId: null as unknown as string,
  }).returning();
  adminId = admin!.id;
  seededUserIds.push(adminId);
  await db.insert(schema.userRoles).values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });
});

afterAll(async () => {
  if (seededCoaIds.length) await db.delete(schema.coaDocuments).where(inArray(schema.coaDocuments.id, seededCoaIds));
  if (seededRecordIds.length) await db.delete(schema.receivingRecords).where(inArray(schema.receivingRecords.id, seededRecordIds));
  if (seededLotIds.length) await db.delete(schema.lots).where(inArray(schema.lots.id, seededLotIds));
  if (seededUserIds.length) {
    await db.delete(schema.userRoles).where(inArray(schema.userRoles.userId, seededUserIds));
    await db.delete(schema.users).where(inArray(schema.users.id, seededUserIds));
  }
});

async function seedForWorkflow(
  workflowType: "FULL_LAB_TEST" | "IDENTITY_CHECK" | "COA_REVIEW" | "EXEMPT",
  identityConfirmed: "true" | "false" | null,
) {
  const [product] = await db.select().from(schema.products).limit(1);
  if (!product) throw new Error("No product seeded — run seed:test first");
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [lot] = await db.insert(schema.lots).values({
    productId: product.id,
    lotNumber: `T03-LOT-${suffix}`,
    supplierName: "Test Supplier",
    quarantineStatus: "PENDING_QC",
  }).returning();
  seededLotIds.push(lot!.id);

  const [record] = await db.insert(schema.receivingRecords).values({
    lotId: lot!.id,
    uniqueIdentifier: `T03-RCV-${suffix}`,
    status: "PENDING_QC",
    qcWorkflowType: workflowType,
    requiresQualification: false,
    dateReceived: "2026-04-24",
    quantityReceived: "10",
    uom: "kg",
  }).returning();
  seededRecordIds.push(record!.id);

  const [coa] = await db.insert(schema.coaDocuments).values({
    lotId: lot!.id,
    receivingRecordId: record!.id,
    sourceType: "SUPPLIER",
    overallResult: "PASS",
    identityConfirmed: identityConfirmed ?? undefined,
  }).returning();
  seededCoaIds.push(coa!.id);

  return { lot: lot!, record: record!, coa: coa! };
}

describeIfDb("T03 — identity test gate on qcReviewReceivingRecord", () => {
  it("FULL_LAB_TEST without identity confirmed → 422", async () => {
    const { record } = await seedForWorkflow("FULL_LAB_TEST", "false");
    await expect(
      storage.qcReviewReceivingRecord(record.id, "APPROVED", adminId),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("FULL_LAB_TEST with identity confirmed → APPROVED", async () => {
    const { record } = await seedForWorkflow("FULL_LAB_TEST", "true");
    const result = await storage.qcReviewReceivingRecord(record.id, "APPROVED", adminId);
    expect(result?.status).toBe("APPROVED");
  });

  it("IDENTITY_CHECK without identity confirmed → 422", async () => {
    const { record } = await seedForWorkflow("IDENTITY_CHECK", "false");
    await expect(
      storage.qcReviewReceivingRecord(record.id, "APPROVED", adminId),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("IDENTITY_CHECK with identity confirmed → APPROVED", async () => {
    const { record } = await seedForWorkflow("IDENTITY_CHECK", "true");
    const result = await storage.qcReviewReceivingRecord(record.id, "APPROVED", adminId);
    expect(result?.status).toBe("APPROVED");
  });

  it("COA_REVIEW without identity confirmed → APPROVED (gate not applied)", async () => {
    const { record } = await seedForWorkflow("COA_REVIEW", "false");
    const result = await storage.qcReviewReceivingRecord(record.id, "APPROVED", adminId);
    expect(result?.status).toBe("APPROVED");
  });

  it("EXEMPT without identity confirmed → APPROVED (gate not applied)", async () => {
    const { record } = await seedForWorkflow("EXEMPT", "false");
    const result = await storage.qcReviewReceivingRecord(record.id, "APPROVED", adminId);
    expect(result?.status).toBe("APPROVED");
  });

  it("FULL_LAB_TEST with identityConfirmed never set (null) → 422", async () => {
    const { record } = await seedForWorkflow("FULL_LAB_TEST", null);
    await expect(
      storage.qcReviewReceivingRecord(record.id, "APPROVED", adminId),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("FULL_LAB_TEST with APPROVED_WITH_CONDITIONS + no identity confirmed → 422", async () => {
    const { record } = await seedForWorkflow("FULL_LAB_TEST", "false");
    await expect(
      storage.qcReviewReceivingRecord(record.id, "APPROVED_WITH_CONDITIONS", adminId),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("FULL_LAB_TEST with APPROVED_WITH_CONDITIONS + identity confirmed → APPROVED", async () => {
    const { record } = await seedForWorkflow("FULL_LAB_TEST", "true");
    const result = await storage.qcReviewReceivingRecord(record.id, "APPROVED_WITH_CONDITIONS", adminId);
    expect(result?.status).toBe("APPROVED");
  });
});
