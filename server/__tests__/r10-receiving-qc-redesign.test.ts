import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { inArray, eq } from "drizzle-orm";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

let adminId: string;

const seededLotIds: string[] = [];
const seededRecordIds: string[] = [];
const seededUserIds: string[] = [];
const seededProductIds: string[] = [];

beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
  const [admin] = await db.insert(schema.users).values({
    email: `r10-admin-${Date.now()}@test.com`,
    fullName: "R10 Admin",
    passwordHash: await hashPassword("Neurogan1!Secure"),
    createdByUserId: null as unknown as string,
  }).returning();
  adminId = admin!.id;
  seededUserIds.push(adminId);
  await db.insert(schema.userRoles).values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });
});

afterAll(async () => {
  if (!process.env.DATABASE_URL) return;
  if (seededLotIds.length) await db.delete(schema.coaDocuments).where(inArray(schema.coaDocuments.lotId, seededLotIds)).catch(() => {});
  if (seededRecordIds.length) await db.delete(schema.receivingRecords).where(inArray(schema.receivingRecords.id, seededRecordIds));
  if (seededLotIds.length) await db.delete(schema.lots).where(inArray(schema.lots.id, seededLotIds));
  if (seededProductIds.length) await db.delete(schema.products).where(inArray(schema.products.id, seededProductIds));
  if (seededUserIds.length) {
    await db.delete(schema.userRoles).where(inArray(schema.userRoles.userId, seededUserIds));
    await db.delete(schema.users).where(inArray(schema.users.id, seededUserIds));
  }
});

describeIfDb("R10 — lot deduplication via receivePOLineItem", () => {
  let lotDedupProductId: string;
  let lotDedupSupplierId: string;
  let lotDedupLocationId: string;
  const seededPoIds: string[] = [];
  const seededPoLineItemIds: string[] = [];
  const seededLocationIds: string[] = [];
  const seededSupplierIds: string[] = [];
  const seededTransactionIds: string[] = [];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    const sfx = `dedup-${Date.now()}`;

    const [sup] = await db.insert(schema.suppliers)
      .values({ name: `R10-Supplier-${sfx}` }).returning();
    lotDedupSupplierId = sup!.id;
    seededSupplierIds.push(sup!.id);

    const [loc] = await db.insert(schema.locations)
      .values({ name: `R10-Location-${sfx}` }).returning();
    lotDedupLocationId = loc!.id;
    seededLocationIds.push(loc!.id);

    const [prod] = await db.insert(schema.products).values({
      name: `R10-Dedup-Prod-${sfx}`, sku: `R10-DUP-${sfx}`,
      category: "PRIMARY_PACKAGING", defaultUom: "pcs",
    }).returning();
    lotDedupProductId = prod!.id;
    seededProductIds.push(prod!.id);
  });

  afterAll(async () => {
    if (!process.env.DATABASE_URL) return;
    for (const id of seededTransactionIds) {
      await db.delete(schema.transactions).where(eq(schema.transactions.id, id)).catch(() => {});
    }
    for (const id of seededPoLineItemIds) await db.delete(schema.poLineItems).where(eq(schema.poLineItems.id, id)).catch(() => {});
    for (const id of seededPoIds) await db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id)).catch(() => {});
    for (const id of seededLocationIds) await db.delete(schema.locations).where(eq(schema.locations.id, id)).catch(() => {});
    for (const id of seededSupplierIds) await db.delete(schema.suppliers).where(eq(schema.suppliers.id, id)).catch(() => {});
  });

  async function seedPo(productId: string, supplierId: string) {
    const sfx = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const [po] = await db.insert(schema.purchaseOrders).values({
      supplierId, poNumber: `R10-PO-${sfx}`, status: "OPEN",
    }).returning();
    seededPoIds.push(po!.id);
    const [lineItem] = await db.insert(schema.poLineItems).values({
      purchaseOrderId: po!.id, productId,
      quantityOrdered: "20", quantityReceived: "0", uom: "pcs",
    }).returning();
    seededPoLineItemIds.push(lineItem!.id);
    return { po: po!, lineItem: lineItem! };
  }

  it("partial receipt of APPROVED lot → new receiving record has status APPROVED", async () => {
    const lotNumber = `R10-DEDUP-A-${Date.now()}`;
    const { lineItem } = await seedPo(lotDedupProductId, lotDedupSupplierId);

    // First receipt — creates the lot
    const first = await storage.receivePOLineItem(
      lineItem.id, 10, lotNumber, lotDedupLocationId,
      "Test Supplier", undefined, undefined, 0
    );
    seededLotIds.push(first.lot.id);
    seededRecordIds.push(first.receivingRecordId);
    if (first.transaction?.id) seededTransactionIds.push(first.transaction.id);

    // Mark the lot as APPROVED (simulate QC approval)
    await db.update(schema.lots)
      .set({ quarantineStatus: "APPROVED" })
      .where(eq(schema.lots.id, first.lot.id));
    await db.update(schema.receivingRecords)
      .set({ status: "APPROVED" })
      .where(eq(schema.receivingRecords.id, first.receivingRecordId));

    // Second receipt of the same lot number
    const { lineItem: lineItem2 } = await seedPo(lotDedupProductId, lotDedupSupplierId);
    const second = await storage.receivePOLineItem(
      lineItem2.id, 5, lotNumber, lotDedupLocationId,
      "Test Supplier", undefined, undefined, 0
    );
    seededRecordIds.push(second.receivingRecordId);
    if (second.transaction?.id) seededTransactionIds.push(second.transaction.id);

    const [secondRecord] = await db.select()
      .from(schema.receivingRecords)
      .where(eq(schema.receivingRecords.id, second.receivingRecordId));

    expect(secondRecord!.status).toBe("APPROVED");
    expect(secondRecord!.lotId).toBe(first.lot.id); // same lot
  });

  it("partial receipt of QUARANTINED lot → new receiving record has proper qcWorkflowType", async () => {
    const lotNumber = `R10-DEDUP-Q-${Date.now()}`;
    const { lineItem } = await seedPo(lotDedupProductId, lotDedupSupplierId);

    // First receipt — creates the lot (QUARANTINED state)
    const first = await storage.receivePOLineItem(
      lineItem.id, 10, lotNumber, lotDedupLocationId,
      "Test Supplier", undefined, undefined, 0
    );
    seededLotIds.push(first.lot.id);
    seededRecordIds.push(first.receivingRecordId);
    if (first.transaction?.id) seededTransactionIds.push(first.transaction.id);

    // Lot stays QUARANTINED — don't approve it

    // Second receipt of the same lot number while still quarantined
    const { lineItem: lineItem2 } = await seedPo(lotDedupProductId, lotDedupSupplierId);
    const second = await storage.receivePOLineItem(
      lineItem2.id, 5, lotNumber, lotDedupLocationId,
      "Test Supplier", undefined, undefined, 0
    );
    seededRecordIds.push(second.receivingRecordId);
    if (second.transaction?.id) seededTransactionIds.push(second.transaction.id);

    const [secondRecord] = await db.select()
      .from(schema.receivingRecords)
      .where(eq(schema.receivingRecords.id, second.receivingRecordId));

    expect(secondRecord!.status).toBe("QUARANTINED");
    // PRIMARY_PACKAGING → COA_REVIEW, not EXEMPT
    expect(secondRecord!.qcWorkflowType).toBe("COA_REVIEW");
    expect(secondRecord!.lotId).toBe(first.lot.id); // same lot
  });
});
