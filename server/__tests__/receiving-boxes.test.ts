import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { eq, inArray } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const seededUserIds: string[] = [];
const seededRoleUserIds: string[] = [];
const seededProductIds: string[] = [];
const seededSupplierIds: string[] = [];
const seededLocationIds: string[] = [];
const seededPOIds: string[] = [];
const seededLineItemIds: string[] = [];
const seededReceivingIds: string[] = [];
const seededBoxIds: string[] = [];

let adminId: string;
let productId: string;
let supplierId: string;
let locationId: string;
let poId: string;
let lineItemId: string;

beforeAll(async () => {
  if (!dbUrl) return;

  const [admin] = await db.insert(schema.users).values({
    email: `rcvbox-admin-${Date.now()}@test.com`,
    fullName: "RcvBox Admin",
    passwordHash: await hashPassword("Neurogan1!Secure"),
    createdByUserId: null as unknown as string,
  }).returning();
  adminId = admin!.id;
  seededUserIds.push(adminId);
  await db.insert(schema.userRoles).values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });
  seededRoleUserIds.push(adminId);

  const [supplier] = await db.insert(schema.suppliers).values({
    name: `BoxTestSupplier-${Date.now()}`,
    contactEmail: "supplier@test.com",
  }).returning();
  supplierId = supplier!.id;
  seededSupplierIds.push(supplierId);

  const [product] = await db.insert(schema.products).values({
    name: "Test Ingredient",
    sku: `SKU-RCVBOX-${Date.now()}`,
    category: "ACTIVE_INGREDIENT",
    uom: "kg",
  }).returning();
  productId = product!.id;
  seededProductIds.push(productId);

  const [location] = await db.insert(schema.locations).values({
    name: `WarehouseA-${Date.now()}`,
  }).returning();
  locationId = location!.id;
  seededLocationIds.push(locationId);

  const [po] = await db.insert(schema.purchaseOrders).values({
    poNumber: `PO-RCVBOX-${Date.now()}`,
    supplierId,
    status: "SUBMITTED",
    orderDate: new Date().toISOString().slice(0, 10),
    createdBy: adminId,
  }).returning();
  poId = po!.id;
  seededPOIds.push(poId);

  const [li] = await db.insert(schema.poLineItems).values({
    purchaseOrderId: poId,
    productId,
    quantityOrdered: "100",
    quantityReceived: "0",
    unitPrice: "10.00",
    uom: "kg",
  }).returning();
  lineItemId = li!.id;
  seededLineItemIds.push(lineItemId);
});

afterAll(async () => {
  if (!dbUrl) return;
  if (seededBoxIds.length) await db.delete(schema.receivingBoxes).where(
    inArray(schema.receivingBoxes.id, seededBoxIds)
  );
  for (const id of seededReceivingIds) {
    await db.delete(schema.receivingRecords).where(eq(schema.receivingRecords.id, id));
  }
  for (const id of seededLineItemIds) {
    await db.delete(schema.poLineItems).where(eq(schema.poLineItems.id, id));
  }
  for (const id of seededPOIds) {
    await db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id));
  }
  for (const id of seededLocationIds) {
    await db.delete(schema.locations).where(eq(schema.locations.id, id));
  }
  for (const id of seededProductIds) {
    await db.delete(schema.products).where(eq(schema.products.id, id));
  }
  for (const id of seededSupplierIds) {
    await db.delete(schema.suppliers).where(eq(schema.suppliers.id, id));
  }
  for (const id of seededRoleUserIds) {
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, id));
  }
  for (const id of seededUserIds) {
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
});

describeIfDb("createReceivingBoxes", () => {
  it("creates N boxes with sequential labels", async () => {
    const uniqueId = "RCV-99990101-001";
    const [rcv] = await db.insert(schema.receivingRecords).values({
      purchaseOrderId: poId,
      lotId: "00000000-0000-0000-0000-000000000001",
      uniqueIdentifier: uniqueId,
      dateReceived: "2026-05-05",
      quantityReceived: "5",
      uom: "kg",
      supplierLotNumber: "TESTLOT-001",
      status: "QUARANTINED",
    }).returning();
    seededReceivingIds.push(rcv!.id);

    const boxes = await storage.createReceivingBoxes(rcv!.id, 3, uniqueId);
    boxes.forEach(b => seededBoxIds.push(b.id));

    expect(boxes).toHaveLength(3);
    expect(boxes[0]!.boxLabel).toBe("RCV-99990101-001-BOX-01");
    expect(boxes[1]!.boxLabel).toBe("RCV-99990101-001-BOX-02");
    expect(boxes[2]!.boxLabel).toBe("RCV-99990101-001-BOX-03");
    expect(boxes[0]!.boxNumber).toBe(1);
    expect(boxes[2]!.boxNumber).toBe(3);
  });
});

describeIfDb("getReceivingBoxes", () => {
  it("returns boxes ordered by boxNumber", async () => {
    const uniqueId = "RCV-99990101-002";
    const [rcv] = await db.insert(schema.receivingRecords).values({
      purchaseOrderId: poId,
      lotId: "00000000-0000-0000-0000-000000000001",
      uniqueIdentifier: uniqueId,
      dateReceived: "2026-05-05",
      quantityReceived: "5",
      uom: "kg",
      supplierLotNumber: "TESTLOT-002",
      status: "QUARANTINED",
    }).returning();
    seededReceivingIds.push(rcv!.id);

    const created = await storage.createReceivingBoxes(rcv!.id, 5, uniqueId);
    created.forEach(b => seededBoxIds.push(b.id));

    const fetched = await storage.getReceivingBoxes(rcv!.id);
    expect(fetched).toHaveLength(5);
    expect(fetched.map(b => b.boxNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns empty array when no boxes exist", async () => {
    const uniqueId = "RCV-99990101-003";
    const [rcv] = await db.insert(schema.receivingRecords).values({
      purchaseOrderId: poId,
      lotId: "00000000-0000-0000-0000-000000000001",
      uniqueIdentifier: uniqueId,
      dateReceived: "2026-05-05",
      quantityReceived: "5",
      uom: "kg",
      supplierLotNumber: "TESTLOT-003",
      status: "QUARANTINED",
    }).returning();
    seededReceivingIds.push(rcv!.id);

    const fetched = await storage.getReceivingBoxes(rcv!.id);
    expect(fetched).toHaveLength(0);
  });
});

describeIfDb("receivePOLineItem with boxCount", () => {
  it("returns boxes when boxCount > 0", async () => {
    const result = await storage.receivePOLineItem(
      lineItemId,
      10,
      `LOT-BOXES-${Date.now()}`,
      locationId,
      undefined,
      undefined,
      undefined,
      3,
    );
    expect(result.boxes).toHaveLength(3);
    expect(result.receivingUniqueId).toMatch(/^RCV-\d{8}-\d{3}$/);
    expect(result.receivingRecordId).toBeTruthy();
    expect(result.boxes[0]!.boxLabel).toBe(`${result.receivingUniqueId}-BOX-01`);
    result.boxes.forEach(b => seededBoxIds.push(b.id));
    seededReceivingIds.push(result.receivingRecordId);
  });

  it("returns empty boxes array when boxCount is 0", async () => {
    const [newLi] = await db.insert(schema.poLineItems).values({
      purchaseOrderId: poId,
      productId,
      quantityOrdered: "50",
      quantityReceived: "0",
      unitPrice: "10.00",
      uom: "kg",
    }).returning();
    seededLineItemIds.push(newLi!.id);

    const result = await storage.receivePOLineItem(
      newLi!.id,
      5,
      `LOT-NOBOXES-${Date.now()}`,
      locationId,
      undefined,
      undefined,
      undefined,
      0,
    );
    expect(result.boxes).toHaveLength(0);
    seededReceivingIds.push(result.receivingRecordId);
  });
});
