import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { eq } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

let adminId: string;
let labActive: string;
let labInactive: string;
let labDisqualified: string;

// Track seeded products/suppliers/lots/records/coas for cleanup
const seededLotIds: string[] = [];
const seededRecordIds: string[] = [];
const seededCoaIds: string[] = [];
const seededProductIds: string[] = [];
const seededSupplierIds: string[] = [];

beforeAll(async () => {
  if (!dbUrl) return;
  const [admin] = await db.insert(schema.users).values({
    email: `t02-admin-${Date.now()}@test.com`,
    fullName: "T02 Admin",
    passwordHash: await hashPassword("Neurogan1!Secure"),
    createdByUserId: null as unknown as string,
  }).returning();
  adminId = admin!.id;
  await db.insert(schema.userRoles).values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });

  const [la] = await db.insert(schema.labs).values({ name: `ActiveLab-${Date.now()}`, type: "THIRD_PARTY", status: "ACTIVE" }).returning();
  labActive = la!.id;
  const [li] = await db.insert(schema.labs).values({ name: `InactiveLab-${Date.now()}`, type: "THIRD_PARTY", status: "INACTIVE" }).returning();
  labInactive = li!.id;
  const [ld] = await db.insert(schema.labs).values({ name: `DisqualLab-${Date.now()}`, type: "THIRD_PARTY", status: "DISQUALIFIED" }).returning();
  labDisqualified = ld!.id;
});

afterAll(async () => {
  if (!dbUrl) return;
  // Clean up in dependency order
  for (const id of seededCoaIds) {
    await db.delete(schema.coaDocuments).where(eq(schema.coaDocuments.id, id));
  }
  for (const id of seededRecordIds) {
    await db.delete(schema.receivingRecords).where(eq(schema.receivingRecords.id, id));
  }
  for (const id of seededLotIds) {
    await db.delete(schema.lots).where(eq(schema.lots.id, id));
  }
  for (const id of seededProductIds) {
    await db.delete(schema.products).where(eq(schema.products.id, id));
  }
  for (const id of seededSupplierIds) {
    await db.delete(schema.suppliers).where(eq(schema.suppliers.id, id));
  }
  await db.delete(schema.labs).where(eq(schema.labs.id, labActive));
  await db.delete(schema.labs).where(eq(schema.labs.id, labInactive));
  await db.delete(schema.labs).where(eq(schema.labs.id, labDisqualified));
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, adminId));
  await db.delete(schema.users).where(eq(schema.users.id, adminId));
});

async function seedLotAndCoa(labId: string) {
  const suffix = Date.now();
  const [product] = await db.insert(schema.products).values({
    name: `T02-Product-${suffix}`,
    sku: `T02-SKU-${suffix}`,
    category: "ACTIVE_INGREDIENT",
    defaultUom: "g",
    status: "ACTIVE",
  }).returning();
  seededProductIds.push(product!.id);

  const [supplier] = await db.insert(schema.suppliers).values({ name: `T02-Supplier-${suffix}` }).returning();
  seededSupplierIds.push(supplier!.id);

  const [lot] = await db.insert(schema.lots).values({
    productId: product!.id,
    lotNumber: `T02-LOT-${suffix}`,
    supplierName: supplier!.name,
    quarantineStatus: "PENDING_QC",
  }).returning();
  seededLotIds.push(lot!.id);

  const [record] = await db.insert(schema.receivingRecords).values({
    lotId: lot!.id,
    supplierId: supplier!.id,
    uniqueIdentifier: `T02-RCV-${suffix}`,
    status: "PENDING_QC",
    qcWorkflowType: "FULL_LAB_TEST",
    requiresQualification: false,
    dateReceived: "2026-04-24",
    quantityReceived: "10",
    uom: "kg",
  }).returning();
  seededRecordIds.push(record!.id);

  const [coa] = await db.insert(schema.coaDocuments).values({
    lotId: lot!.id,
    receivingRecordId: record!.id,
    sourceType: "THIRD_PARTY_LAB",
    labId: labId,
    overallResult: "PASS",
  }).returning();
  seededCoaIds.push(coa!.id);

  return { lot: lot!, record: record!, coa: coa! };
}

describeIfDb("T02 — lab accreditation gate on qcReviewCoa", () => {
  it("accepts COA when lab is ACTIVE", async () => {
    const { coa } = await seedLotAndCoa(labActive);
    const result = await storage.qcReviewCoa(coa.id, true, adminId);
    expect(result?.qcAccepted).toBe("true");
  });

  it("rejects COA when lab is INACTIVE (422)", async () => {
    const { coa } = await seedLotAndCoa(labInactive);
    await expect(storage.qcReviewCoa(coa.id, true, adminId)).rejects.toMatchObject({ status: 422 });
  });

  it("rejects COA when lab is DISQUALIFIED (422)", async () => {
    const { coa } = await seedLotAndCoa(labDisqualified);
    await expect(storage.qcReviewCoa(coa.id, true, adminId)).rejects.toMatchObject({ status: 422 });
  });
});

describeIfDb("T02 — lab accreditation gate on qcReviewReceivingRecord", () => {
  it("rejects APPROVED disposition when COA lab is INACTIVE (422)", async () => {
    const { record } = await seedLotAndCoa(labInactive);
    await expect(
      storage.qcReviewReceivingRecord(record.id, "APPROVED", adminId),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("approves when COA lab is ACTIVE", async () => {
    const { record } = await seedLotAndCoa(labActive);
    const result = await storage.qcReviewReceivingRecord(record.id, "APPROVED", adminId);
    expect(result?.status).toBe("APPROVED");
  });
});
