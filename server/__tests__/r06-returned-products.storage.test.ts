import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../auth/password";
import * as returnsStorage from "../storage/returned-products";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

describeIfDb("R-06 returned-products storage", () => {
  let userId: string;
  let lotId: string;

  beforeAll(async () => {
    await db.delete(schema.returnInvestigations);
    await db.delete(schema.returnedProducts);
  });

  afterAll(async () => {
    await db.delete(schema.returnInvestigations);
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

    const [user] = await db.insert(schema.users).values({
      email: `qa-${Date.now()}@test.local`,
      fullName: "QA Tester",
      passwordHash: await hashPassword("Test1234!Password"),
      status: "ACTIVE",
    }).returning();
    userId = user.id;
    await db.insert(schema.userRoles).values({ userId, role: "QA", grantedByUserId: userId });

    const [product] = await db.insert(schema.products).values({
      sku: `SKU-${Date.now()}`, name: "Test Product",
    }).returning();
    const [lot] = await db.insert(schema.lots).values({
      productId: product.id, lotNumber: `LOT-RET-${Date.now()}`, quarantineStatus: "APPROVED",
    }).returning();
    lotId = lot.id;
  });

  it("creates a QUARANTINE record with RET- ref", async () => {
    const { returnedProduct } = await returnsStorage.createReturnIntake({
      source: "AMAZON_FBA",
      lotCodeRaw: "LOT-RET-123",
      lotId,
      qtyReturned: 10,
      uom: "UNITS",
      receivedAt: new Date(),
      userId,
      requestId: "rid-1",
      route: "POST /test",
    });
    expect(returnedProduct.status).toBe("QUARANTINE");
    expect(returnedProduct.returnRef).toMatch(/^RET-\d{8}-\d{3}$/);
    expect(returnedProduct.source).toBe("AMAZON_FBA");
    expect(returnedProduct.lotId).toBe(lotId);
  });

  it("resolves lot via ilike when lotId not provided", async () => {
    const [lot] = await db.select().from(schema.lots).where(eq(schema.lots.id, lotId));
    const { returnedProduct } = await returnsStorage.createReturnIntake({
      source: "WHOLESALE",
      lotCodeRaw: lot.lotNumber.toUpperCase(),
      qtyReturned: 5,
      uom: "UNITS",
      receivedAt: new Date(),
      userId,
      requestId: "rid-2",
      route: "POST /test",
    });
    expect(returnedProduct.lotId).toBe(lotId);
  });

  it("opens investigation when returns_count >= threshold (default 3)", async () => {
    // Seed threshold to 2 for this test
    await db.insert(schema.appSettingsKv).values({ key: "returnsInvestigationThresholdCount", value: "2" })
      .onConflictDoUpdate({ target: schema.appSettingsKv.key, set: { value: "2" } });

    await returnsStorage.createReturnIntake({ source: "AMAZON_FBA", lotCodeRaw: "x", lotId, qtyReturned: 1, uom: "UNITS", receivedAt: new Date(), userId, requestId: "r1", route: "/" });
    const { investigationOpened } = await returnsStorage.createReturnIntake({ source: "AMAZON_FBA", lotCodeRaw: "x", lotId, qtyReturned: 1, uom: "UNITS", receivedAt: new Date(), userId, requestId: "r2", route: "/" });

    expect(investigationOpened).toBe(true);
    const invs = await returnsStorage.listReturnInvestigations({ lotId });
    expect(invs).toHaveLength(1);
    expect(invs[0].status).toBe("OPEN");

    // Reset threshold
    await db.insert(schema.appSettingsKv).values({ key: "returnsInvestigationThresholdCount", value: "3" })
      .onConflictDoUpdate({ target: schema.appSettingsKv.key, set: { value: "3" } });
  });

  it("does NOT open a second investigation when one is already open", async () => {
    await db.insert(schema.appSettingsKv).values({ key: "returnsInvestigationThresholdCount", value: "1" })
      .onConflictDoUpdate({ target: schema.appSettingsKv.key, set: { value: "1" } });

    await returnsStorage.createReturnIntake({ source: "AMAZON_FBA", lotCodeRaw: "x", lotId, qtyReturned: 1, uom: "UNITS", receivedAt: new Date(), userId, requestId: "r1", route: "/" });
    const { investigationOpened } = await returnsStorage.createReturnIntake({ source: "AMAZON_FBA", lotCodeRaw: "x", lotId, qtyReturned: 1, uom: "UNITS", receivedAt: new Date(), userId, requestId: "r2", route: "/" });

    expect(investigationOpened).toBe(false);
    expect(await returnsStorage.listReturnInvestigations({ lotId })).toHaveLength(1);

    await db.insert(schema.appSettingsKv).values({ key: "returnsInvestigationThresholdCount", value: "3" })
      .onConflictDoUpdate({ target: schema.appSettingsKv.key, set: { value: "3" } });
  });

  it("getReturnedProduct throws 404 for unknown id", async () => {
    await expect(returnsStorage.getReturnedProduct("00000000-0000-0000-0000-000000000000"))
      .rejects.toMatchObject({ status: 404 });
  });

  it("listReturnedProducts filters by status", async () => {
    await returnsStorage.createReturnIntake({ source: "AMAZON_FBA", lotCodeRaw: "x", lotId, qtyReturned: 1, uom: "UNITS", receivedAt: new Date(), userId, requestId: "r1", route: "/" });
    const quarantined = await returnsStorage.listReturnedProducts({ status: "QUARANTINE" });
    expect(quarantined.length).toBeGreaterThanOrEqual(1);
    const disposed = await returnsStorage.listReturnedProducts({ status: "DISPOSED" });
    expect(disposed.every(r => r.status === "DISPOSED")).toBe(true);
  });
});
