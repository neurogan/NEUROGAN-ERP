import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { eq } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

// Track seeded IDs for cleanup
const seededUserIds: string[] = [];
const seededRoleUserIds: string[] = [];
const seededProductIds: string[] = [];
const seededSupplierIds: string[] = [];
const seededLotIds: string[] = [];
const seededRecordIds: string[] = [];
const seededPOIds: string[] = [];
const seededLineItemIds: string[] = [];
const seededLocationIds: string[] = [];
const seededTransactionIds: string[] = [];

let adminId: string;

beforeAll(async () => {
  if (!dbUrl) return;
  const [admin] = await db.insert(schema.users).values({
    email: `t06-admin-${Date.now()}@test.com`,
    fullName: "T06 Admin",
    passwordHash: await hashPassword("Neurogan1!Secure"),
    createdByUserId: null as unknown as string,
  }).returning();
  adminId = admin!.id;
  seededUserIds.push(adminId);
  await db.insert(schema.userRoles).values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });
  seededRoleUserIds.push(adminId);
});

afterAll(async () => {
  if (!dbUrl) return;
  // Clean up in dependency order
  for (const id of seededTransactionIds) {
    await db.delete(schema.transactions).where(eq(schema.transactions.id, id));
  }
  for (const id of seededRecordIds) {
    await db.delete(schema.receivingRecords).where(eq(schema.receivingRecords.id, id));
  }
  for (const id of seededLineItemIds) {
    await db.delete(schema.poLineItems).where(eq(schema.poLineItems.id, id));
  }
  for (const id of seededPOIds) {
    await db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id));
  }
  for (const id of seededLotIds) {
    await db.delete(schema.lots).where(eq(schema.lots.id, id));
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

/**
 * Seeds a minimal PO + line item + location for use in receivePOLineItem tests.
 */
async function seedPOAndLineItem() {
  const suffix = Date.now();

  const [product] = await db.insert(schema.products).values({
    name: `T06-Product-${suffix}`,
    sku: `T06-SKU-${suffix}`,
    category: "ACTIVE_INGREDIENT",
    defaultUom: "kg",
    status: "ACTIVE",
  }).returning();
  seededProductIds.push(product!.id);

  const [supplier] = await db.insert(schema.suppliers).values({
    name: `T06-Supplier-${suffix}`,
  }).returning();
  seededSupplierIds.push(supplier!.id);

  const [po] = await db.insert(schema.purchaseOrders).values({
    poNumber: `T06-PO-${suffix}`,
    supplierId: supplier!.id,
    status: "DRAFT",
  }).returning();
  seededPOIds.push(po!.id);

  const [lineItem] = await db.insert(schema.poLineItems).values({
    purchaseOrderId: po!.id,
    productId: product!.id,
    quantityOrdered: "100",
    quantityReceived: "0",
    uom: "kg",
  }).returning();
  seededLineItemIds.push(lineItem!.id);

  const [location] = await db.insert(schema.locations).values({
    name: `T06-Location-${suffix}`,
    type: "WAREHOUSE",
  }).returning();
  seededLocationIds.push(location!.id);

  return { product: product!, supplier: supplier!, po: po!, lineItem: lineItem!, location: location! };
}

// ─── T06-A: Lot-existence routing ────────────────────────────────────────────

describeIfDb("T06-A — lot-existence routing in receivePOLineItem", () => {
  it("creates a new lot when no matching lot exists (normal flow)", async () => {
    // Arrange
    const { lineItem, location } = await seedPOAndLineItem();
    const lotNumber = `T06-NEW-${Date.now()}`;

    // Act
    const result = await storage.receivePOLineItem(
      lineItem.id,
      10,
      lotNumber,
      location.id,
    );

    // Assert: a brand-new lot should be created with the standard workflow
    expect(result.lot.lotNumber).toBe(lotNumber);
    expect(result.lot.quarantineStatus).toBe("QUARANTINED");
    seededLotIds.push(result.lot.id);
    seededTransactionIds.push(result.transaction.id);
  });

  it("second receipt of APPROVED lot → EXEMPT workflow, attaches to existing lot", async () => {
    // Arrange: create a lot in APPROVED state
    const { product, supplier, lineItem, location } = await seedPOAndLineItem();
    const lotNumber = `T06-APPROVED-${Date.now()}`;

    const [existingLot] = await db.insert(schema.lots).values({
      productId: product.id,
      lotNumber,
      supplierName: supplier.name,
      quarantineStatus: "APPROVED",
    }).returning();
    seededLotIds.push(existingLot!.id);

    // Act: receive second shipment of same lot
    const result = await storage.receivePOLineItem(
      lineItem.id,
      5,
      lotNumber,
      location.id,
    );

    // Assert: returned lot is the existing one, no new lot created
    expect(result.lot.id).toBe(existingLot!.id);
    expect(result.lot.quarantineStatus).toBe("APPROVED");
    seededTransactionIds.push(result.transaction.id);

    // Assert: receiving record has EXEMPT workflow
    const records = await db
      .select()
      .from(schema.receivingRecords)
      .where(eq(schema.receivingRecords.lotId, existingLot!.id));
    const exemptRecord = records.find(r => r.qcWorkflowType === "EXEMPT");
    expect(exemptRecord).toBeDefined();
    expect(exemptRecord!.qcWorkflowType).toBe("EXEMPT");
    for (const r of records) seededRecordIds.push(r.id);
  });

  it("second receipt of in-progress lot (QUARANTINED) → attaches to existing lot, derives proper QC workflow", async () => {
    // Arrange: create a lot still in quarantine (workflow in progress)
    const { product, supplier, lineItem, location } = await seedPOAndLineItem();
    const lotNumber = `T06-INPROG-${Date.now()}`;

    const [inProgressLot] = await db.insert(schema.lots).values({
      productId: product.id,
      lotNumber,
      supplierName: supplier.name,
      quarantineStatus: "QUARANTINED",
    }).returning();
    seededLotIds.push(inProgressLot!.id);

    // Act
    const result = await storage.receivePOLineItem(
      lineItem.id,
      5,
      lotNumber,
      location.id,
    );

    // Assert: returned lot is the existing one
    expect(result.lot.id).toBe(inProgressLot!.id);
    seededTransactionIds.push(result.transaction.id);

    // ACTIVE_INGREDIENT with no approved_materials entry → FULL_LAB_TEST (not hardcoded EXEMPT)
    const records = await db
      .select()
      .from(schema.receivingRecords)
      .where(eq(schema.receivingRecords.lotId, inProgressLot!.id));
    expect(records[0]?.qcWorkflowType).toBe("FULL_LAB_TEST");
    for (const r of records) seededRecordIds.push(r.id);
  });

  it("second receipt of in-progress lot (SAMPLING) → attaches to existing lot, derives proper QC workflow", async () => {
    const { product, supplier, lineItem, location } = await seedPOAndLineItem();
    const lotNumber = `T06-SAMPLING-${Date.now()}`;

    const [samplingLot] = await db.insert(schema.lots).values({
      productId: product.id,
      lotNumber,
      supplierName: supplier.name,
      quarantineStatus: "SAMPLING",
    }).returning();
    seededLotIds.push(samplingLot!.id);

    const result = await storage.receivePOLineItem(lineItem.id, 5, lotNumber, location.id);

    expect(result.lot.id).toBe(samplingLot!.id);
    seededTransactionIds.push(result.transaction.id);

    // ACTIVE_INGREDIENT with no approved_materials entry → FULL_LAB_TEST (not hardcoded EXEMPT)
    const records = await db
      .select()
      .from(schema.receivingRecords)
      .where(eq(schema.receivingRecords.lotId, samplingLot!.id));
    expect(records[0]?.qcWorkflowType).toBe("FULL_LAB_TEST");
    for (const r of records) seededRecordIds.push(r.id);
  });

  it("second receipt of in-progress lot (PENDING_QC) → attaches to existing lot, derives proper QC workflow", async () => {
    const { product, supplier, lineItem, location } = await seedPOAndLineItem();
    const lotNumber = `T06-PENDING-${Date.now()}`;

    const [pendingLot] = await db.insert(schema.lots).values({
      productId: product.id,
      lotNumber,
      supplierName: supplier.name,
      quarantineStatus: "PENDING_QC",
    }).returning();
    seededLotIds.push(pendingLot!.id);

    const result = await storage.receivePOLineItem(lineItem.id, 5, lotNumber, location.id);

    expect(result.lot.id).toBe(pendingLot!.id);
    seededTransactionIds.push(result.transaction.id);

    // ACTIVE_INGREDIENT with no approved_materials entry → FULL_LAB_TEST (not hardcoded EXEMPT)
    const records = await db
      .select()
      .from(schema.receivingRecords)
      .where(eq(schema.receivingRecords.lotId, pendingLot!.id));
    expect(records[0]?.qcWorkflowType).toBe("FULL_LAB_TEST");
    for (const r of records) seededRecordIds.push(r.id);
  });

  it("SECONDARY_PACKAGING with no lot number → auto-generates NOLOT- lot, EXEMPT workflow", async () => {
    // Seed a SECONDARY_PACKAGING product + PO line item
    const suffix = Date.now();
    const [pkgProduct] = await db.insert(schema.products).values({
      name: `T06-PKG-${suffix}`,
      sku: `T06-PKG-SKU-${suffix}`,
      category: "SECONDARY_PACKAGING",
      defaultUom: "pcs",
      status: "ACTIVE",
    }).returning();
    seededProductIds.push(pkgProduct!.id);

    const [supplier] = await db.insert(schema.suppliers).values({ name: `T06-PKG-Sup-${suffix}` }).returning();
    seededSupplierIds.push(supplier!.id);

    const [po] = await db.insert(schema.purchaseOrders).values({
      poNumber: `T06-PKG-PO-${suffix}`, supplierId: supplier!.id, status: "DRAFT",
    }).returning();
    seededPOIds.push(po!.id);

    const [lineItem] = await db.insert(schema.poLineItems).values({
      purchaseOrderId: po!.id, productId: pkgProduct!.id,
      quantityOrdered: "500", quantityReceived: "0", uom: "pcs",
    }).returning();
    seededLineItemIds.push(lineItem!.id);

    const [location] = await db.insert(schema.locations).values({
      name: `T06-PKG-Loc-${suffix}`, type: "WAREHOUSE",
    }).returning();
    seededLocationIds.push(location!.id);

    // Act: receive with no lot number
    const result = await storage.receivePOLineItem(lineItem!.id, 100, undefined, location!.id);

    // Assert: a NOLOT- lot was auto-created
    expect(result.lot.lotNumber).toMatch(/^NOLOT-/);
    seededLotIds.push(result.lot.id);
    seededTransactionIds.push(result.transaction.id);

    // Assert: receiving record has EXEMPT workflow
    const records = await db.select().from(schema.receivingRecords)
      .where(eq(schema.receivingRecords.lotId, result.lot.id));
    expect(records[0]?.qcWorkflowType).toBe("EXEMPT");
    for (const r of records) seededRecordIds.push(r.id);
  });

  it("non-SECONDARY_PACKAGING with no lot number → throws 422", async () => {
    const { lineItem, location } = await seedPOAndLineItem();
    await expect(
      storage.receivePOLineItem(lineItem.id, 5, undefined, location.id),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("second receipt of REJECTED lot → throws 422", async () => {
    // Arrange: create a REJECTED lot
    const { product, supplier, lineItem, location } = await seedPOAndLineItem();
    const lotNumber = `T06-REJECTED-${Date.now()}`;

    const [rejectedLot] = await db.insert(schema.lots).values({
      productId: product.id,
      lotNumber,
      supplierName: supplier.name,
      quarantineStatus: "REJECTED",
    }).returning();
    seededLotIds.push(rejectedLot!.id);

    // Act + Assert: should throw with status 422
    await expect(
      storage.receivePOLineItem(lineItem.id, 5, lotNumber, location.id),
    ).rejects.toMatchObject({ status: 422 });
  });
});

// ─── T06-B: FULL_LAB_TEST task routing ──────────────────────────────────────

describeIfDb("T06-B — getUserTasks routes FULL_LAB_TEST to LAB_TECH, not QA", () => {
  let labTechUserId: string;
  let qaUserId: string;
  let seedRecordId: string;

  beforeAll(async () => {
    if (!dbUrl) return;
    const suffix = Date.now();

    // Create LAB_TECH user
    const [labTechUser] = await db.insert(schema.users).values({
      email: `t06-labtech-${suffix}@test.com`,
      fullName: "T06 Lab Tech",
      passwordHash: await hashPassword("Neurogan1!Secure"),
      createdByUserId: adminId,
    }).returning();
    labTechUserId = labTechUser!.id;
    seededUserIds.push(labTechUserId);
    await db.insert(schema.userRoles).values({ userId: labTechUserId, role: "LAB_TECH", grantedByUserId: adminId });
    seededRoleUserIds.push(labTechUserId);

    // Create QA user
    const [qaUser] = await db.insert(schema.users).values({
      email: `t06-qa-${suffix}@test.com`,
      fullName: "T06 QA",
      passwordHash: await hashPassword("Neurogan1!Secure"),
      createdByUserId: adminId,
    }).returning();
    qaUserId = qaUser!.id;
    seededUserIds.push(qaUserId);
    await db.insert(schema.userRoles).values({ userId: qaUserId, role: "QA", grantedByUserId: adminId });
    seededRoleUserIds.push(qaUserId);

    // Seed a FULL_LAB_TEST receiving record in QUARANTINED status
    const [product] = await db.insert(schema.products).values({
      name: `T06B-Product-${suffix}`,
      sku: `T06B-SKU-${suffix}`,
      category: "ACTIVE_INGREDIENT",
      defaultUom: "kg",
      status: "ACTIVE",
    }).returning();
    seededProductIds.push(product!.id);

    const [lot] = await db.insert(schema.lots).values({
      productId: product!.id,
      lotNumber: `T06B-LOT-${suffix}`,
      quarantineStatus: "QUARANTINED",
    }).returning();
    seededLotIds.push(lot!.id);

    const [record] = await db.insert(schema.receivingRecords).values({
      lotId: lot!.id,
      uniqueIdentifier: `T06B-RCV-${suffix}`,
      status: "QUARANTINED",
      qcWorkflowType: "FULL_LAB_TEST",
      requiresQualification: false,
      dateReceived: "2026-04-24",
      quantityReceived: "10",
      uom: "kg",
    }).returning();
    seedRecordId = record!.id;
    seededRecordIds.push(seedRecordId);
  });

  it("LAB_TECH user sees FULL_LAB_TEST tasks (LAB_TEST_REQUIRED)", async () => {
    const tasks = await storage.getUserTasks(labTechUserId, ["LAB_TECH"]);
    const labTask = tasks.find(t => t.sourceRecordId === seedRecordId);
    expect(labTask).toBeDefined();
    expect(labTask!.taskType).toBe("LAB_TEST_REQUIRED");
  });

  it("QA user does NOT see FULL_LAB_TEST tasks in getUserTasks", async () => {
    const tasks = await storage.getUserTasks(qaUserId, ["QA"]);
    const labTask = tasks.find(t => t.sourceRecordId === seedRecordId);
    expect(labTask).toBeUndefined();
  });

  it("ADMIN user sees FULL_LAB_TEST tasks (via isLabTech)", async () => {
    const tasks = await storage.getUserTasks(adminId, ["ADMIN"]);
    const labTask = tasks.find(t => t.sourceRecordId === seedRecordId);
    expect(labTask).toBeDefined();
    expect(labTask!.taskType).toBe("LAB_TEST_REQUIRED");
  });
});
