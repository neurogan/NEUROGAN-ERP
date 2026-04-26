import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { storage } from "../storage";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { hashPassword } from "../auth/password";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

describeIfDb("OOS investigation storage", () => {
  let qaUser: schema.User;
  let lotId: string;
  let coaId: string;
  let labTestResult1: schema.LabTestResult;
  let labTestResult2: schema.LabTestResult;

  beforeAll(async () => {
    // wipe in dependency order
    await db.delete(schema.oosInvestigationTestResults);
    await db.delete(schema.oosInvestigations);
    await db.delete(schema.oosInvestigationCounter);
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
      fullName: "QA User",
      passwordHash: await hashPassword("Test1234!Password"),
      status: "ACTIVE",
    }).returning();
    await db.insert(schema.userRoles).values({ userId: qaUser.id, role: "QA", grantedByUserId: qaUser.id });

    const [product] = await db.insert(schema.products).values({ sku: `P-${Date.now()}`, name: "Test Product" }).returning();
    const [lot] = await db.insert(schema.lots).values({
      productId: product.id, lotNumber: `LOT-${Date.now()}`, quarantineStatus: "PENDING_QC",
    }).returning();
    lotId = lot.id;

    const [coa] = await db.insert(schema.coaDocuments).values({ lotId }).returning();
    coaId = coa.id;

    [labTestResult1] = await db.insert(schema.labTestResults).values({
      coaDocumentId: coaId, analyteName: "potency", resultValue: "85",
      specMin: "90", specMax: "110", pass: false, testedByUserId: qaUser.id,
    }).returning();
    [labTestResult2] = await db.insert(schema.labTestResults).values({
      coaDocumentId: coaId, analyteName: "microbial", resultValue: "1500",
      specMin: "0", specMax: "1000", pass: false, testedByUserId: qaUser.id,
    }).returning();
  });

  it("creates investigation with OOS-YYYY-001 number on first failure", async () => {
    const inv = await db.transaction(async (tx) => {
      return await storage.getOrCreateOpenOosInvestigation(coaId, lotId, labTestResult1.id, qaUser.id, "rid-1", "POST /test", tx);
    });
    expect(inv.status).toBe("OPEN");
    const year = new Date().getFullYear();
    expect(inv.oosNumber).toBe(`OOS-${year}-001`);
    expect(inv.coaDocumentId).toBe(coaId);
    expect(inv.lotId).toBe(lotId);
    const junction = await db.select().from(schema.oosInvestigationTestResults).where(eq(schema.oosInvestigationTestResults.investigationId, inv.id));
    expect(junction).toHaveLength(1);
    expect(junction[0].labTestResultId).toBe(labTestResult1.id);
    const audit = await db.select().from(schema.auditTrail).where(and(eq(schema.auditTrail.entityType, "oos_investigation"), eq(schema.auditTrail.entityId, inv.id), eq(schema.auditTrail.action, "OOS_OPENED")));
    expect(audit).toHaveLength(1);
  });

  it("is idempotent on same COA — returns existing, attaches second test result, no new audit", async () => {
    const inv1 = await db.transaction(async (tx) =>
      storage.getOrCreateOpenOosInvestigation(coaId, lotId, labTestResult1.id, qaUser.id, "rid-1", "POST /test", tx));
    const inv2 = await db.transaction(async (tx) =>
      storage.getOrCreateOpenOosInvestigation(coaId, lotId, labTestResult2.id, qaUser.id, "rid-2", "POST /test", tx));
    expect(inv2.id).toBe(inv1.id);
    const junction = await db.select().from(schema.oosInvestigationTestResults).where(eq(schema.oosInvestigationTestResults.investigationId, inv1.id));
    expect(junction).toHaveLength(2);
    const audit = await db.select().from(schema.auditTrail).where(and(eq(schema.auditTrail.entityType, "oos_investigation"), eq(schema.auditTrail.entityId, inv1.id), eq(schema.auditTrail.action, "OOS_OPENED")));
    expect(audit).toHaveLength(1);
  });

  it("increments counter for second investigation in the same year", async () => {
    const inv1 = await db.transaction(async (tx) =>
      storage.getOrCreateOpenOosInvestigation(coaId, lotId, labTestResult1.id, qaUser.id, "rid-1", "POST /test", tx));
    // Parse the sequence number from the first investigation
    const seq1 = parseInt(inv1.oosNumber.split("-")[2], 10);

    const [coa2] = await db.insert(schema.coaDocuments).values({ lotId }).returning();
    const [r3] = await db.insert(schema.labTestResults).values({
      coaDocumentId: coa2.id, analyteName: "ph", resultValue: "2", specMin: "5", specMax: "9", pass: false, testedByUserId: qaUser.id,
    }).returning();
    const inv2 = await db.transaction(async (tx) =>
      storage.getOrCreateOpenOosInvestigation(coa2.id, lotId, r3.id, qaUser.id, "rid-3", "POST /test", tx));
    const seq2 = parseInt(inv2.oosNumber.split("-")[2], 10);
    expect(seq2).toBe(seq1 + 1);
    expect(inv2.oosNumber).toMatch(/^OOS-\d{4}-\d{3}$/);
  });

  it("getOosInvestigationById returns full detail", async () => {
    const inv = await db.transaction(async (tx) =>
      storage.getOrCreateOpenOosInvestigation(coaId, lotId, labTestResult1.id, qaUser.id, "rid-1", "POST /test", tx));
    const detail = await storage.getOosInvestigationById(inv.id);
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(inv.id);
    expect(detail!.lotId).toBe(lotId);
    expect(detail!.testResults).toHaveLength(1);
    expect(detail!.testResults[0].id).toBe(labTestResult1.id);
  });

  it("listOosInvestigations filters by status default OPEN", async () => {
    await db.transaction(async (tx) =>
      storage.getOrCreateOpenOosInvestigation(coaId, lotId, labTestResult1.id, qaUser.id, "rid-1", "POST /test", tx));
    const open = await storage.listOosInvestigations({ status: "OPEN" });
    expect(open.length).toBeGreaterThanOrEqual(1);
    const closed = await storage.listOosInvestigations({ status: "CLOSED" });
    expect(closed.every((i) => i.status === "CLOSED")).toBe(true);
  });

  describe("transitions and closures", () => {
    let inv: schema.OosInvestigation;
    let signatureId: string;

    beforeEach(async () => {
      inv = await db.transaction(async (tx) =>
        storage.getOrCreateOpenOosInvestigation(coaId, lotId, labTestResult1.id, qaUser.id, "rid-x", "POST /x", tx));
      // Insert a signature row to use as closure_signature_id
      const [sig] = await db.insert(schema.electronicSignatures).values({
        userId: qaUser.id, meaning: "OOS_INVESTIGATION_CLOSE",
        entityType: "oos_investigation", entityId: inv.id,
        fullNameAtSigning: qaUser.fullName,
        requestId: "rid-sig",
        manifestationJson: { meaning: "OOS_INVESTIGATION_CLOSE" },
      }).returning();
      signatureId = sig!.id;
    });

    it("assignOosLeadInvestigator sets the user, idempotent on same user", async () => {
      await db.transaction((tx) => storage.assignOosLeadInvestigator(inv.id, qaUser.id, qaUser.id, "rid-1", "POST /assign", tx));
      const [after1] = await db.select().from(schema.oosInvestigations).where(eq(schema.oosInvestigations.id, inv.id));
      expect(after1.leadInvestigatorUserId).toBe(qaUser.id);
      // second call with same user is a no-op
      await db.transaction((tx) => storage.assignOosLeadInvestigator(inv.id, qaUser.id, qaUser.id, "rid-2", "POST /assign", tx));
      const auditRows = await db.select().from(schema.auditTrail).where(and(eq(schema.auditTrail.entityType, "oos_investigation"), eq(schema.auditTrail.entityId, inv.id)));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(auditRows.filter(r => r.action === "UPDATE" && (r.meta as any)?.subtype === "ASSIGN_LEAD_INVESTIGATOR")).toHaveLength(1);
    });

    it("setOosRetestPending and clearOosRetestPending flip status", async () => {
      await db.transaction((tx) => storage.setOosRetestPending(inv.id, qaUser.id, "rid-r1", "POST /retest", tx));
      const [a] = await db.select().from(schema.oosInvestigations).where(eq(schema.oosInvestigations.id, inv.id));
      expect(a.status).toBe("RETEST_PENDING");
      await db.transaction((tx) => storage.clearOosRetestPending(inv.id, qaUser.id, "rid-r2", "POST /clear", tx));
      const [b] = await db.select().from(schema.oosInvestigations).where(eq(schema.oosInvestigations.id, inv.id));
      expect(b.status).toBe("OPEN");
    });

    it("closeOosInvestigation REJECTED flips lot to REJECTED", async () => {
      await db.transaction((tx) => storage.assignOosLeadInvestigator(inv.id, qaUser.id, qaUser.id, "rid-l", "POST /a", tx));
      // Step 1: close inside transaction (no signature yet)
      await db.transaction((tx) => storage.closeOosInvestigation(
        inv.id,
        { disposition: "REJECTED", dispositionReason: "Confirmed OOS, lot fails spec", leadInvestigatorUserId: qaUser.id },
        qaUser.id, "rid-c", "POST /close", tx,
      ));
      // Step 2: finalize with signature
      await storage.finalizeOosClosure(inv.id, signatureId);
      const [closed] = await db.select().from(schema.oosInvestigations).where(eq(schema.oosInvestigations.id, inv.id));
      expect(closed.status).toBe("CLOSED");
      expect(closed.disposition).toBe("REJECTED");
      expect(closed.closureSignatureId).toBe(signatureId);
      const [lotRow] = await db.select().from(schema.lots).where(eq(schema.lots.id, lotId));
      expect(lotRow.quarantineStatus).toBe("REJECTED");
    });

    it("closeOosInvestigation RECALL requires recallDetails", async () => {
      await db.transaction((tx) => storage.assignOosLeadInvestigator(inv.id, qaUser.id, qaUser.id, "rid-l", "POST /a", tx));
      await expect(db.transaction((tx) => storage.closeOosInvestigation(
        inv.id,
        { disposition: "RECALL", dispositionReason: "needs recall", leadInvestigatorUserId: qaUser.id },
        qaUser.id, "rid-c", "POST /close", tx,
      ))).rejects.toThrow(/recall/i);
    });

    it("closeOosInvestigation RECALL with full details persists recall fields", async () => {
      await db.transaction((tx) => storage.assignOosLeadInvestigator(inv.id, qaUser.id, qaUser.id, "rid-l", "POST /a", tx));
      // Step 1: close inside transaction (no signature yet)
      await db.transaction((tx) => storage.closeOosInvestigation(
        inv.id,
        {
          disposition: "RECALL",
          dispositionReason: "Class II recall — distributed",
          leadInvestigatorUserId: qaUser.id,
          recallDetails: {
            class: "II", distributionScope: "Sold to 4 distributors in CA, OR",
            fdaNotificationDate: new Date("2026-04-30"),
            customerNotificationDate: new Date("2026-04-29"),
            recoveryTargetDate: new Date("2026-05-15"),
            affectedLotIds: [],
          },
        },
        qaUser.id, "rid-c", "POST /close", tx,
      ));
      // Step 2: finalize with signature
      await storage.finalizeOosClosure(inv.id, signatureId);
      const [closed] = await db.select().from(schema.oosInvestigations).where(eq(schema.oosInvestigations.id, inv.id));
      expect(closed.recallClass).toBe("II");
      expect(closed.recallDistributionScope).toContain("4 distributors");
    });

    it("markOosNoInvestigationNeeded fast-path closure", async () => {
      // Step 1: set closure fields (no signature yet)
      await db.transaction((tx) => storage.markOosNoInvestigationNeeded(
        inv.id, "LAB_ERROR", "Operator pipetting error during sample prep", qaUser.id, qaUser.id, "rid-n", "POST /n", tx,
      ));
      // Step 2: finalize with signature
      await storage.finalizeOosClosure(inv.id, signatureId);
      const [closed] = await db.select().from(schema.oosInvestigations).where(eq(schema.oosInvestigations.id, inv.id));
      expect(closed.status).toBe("CLOSED");
      expect(closed.disposition).toBe("NO_INVESTIGATION_NEEDED");
      expect(closed.noInvestigationReason).toBe("LAB_ERROR");
      expect(closed.leadInvestigatorUserId).toBe(qaUser.id);
      const [lotRow] = await db.select().from(schema.lots).where(eq(schema.lots.id, lotId));
      expect(lotRow.quarantineStatus).not.toBe("REJECTED");
    });

    it("close on already-CLOSED rejects", async () => {
      await db.transaction((tx) => storage.assignOosLeadInvestigator(inv.id, qaUser.id, qaUser.id, "rid-l", "POST /a", tx));
      await db.transaction((tx) => storage.closeOosInvestigation(
        inv.id,
        { disposition: "APPROVED", dispositionReason: "retest passed", leadInvestigatorUserId: qaUser.id },
        qaUser.id, "rid-c1", "POST /close", tx,
      ));
      // After step 1, closedAt is set — second attempt should fail even before finalize
      await expect(db.transaction((tx) => storage.closeOosInvestigation(
        inv.id,
        { disposition: "APPROVED", dispositionReason: "again", leadInvestigatorUserId: qaUser.id },
        qaUser.id, "rid-c2", "POST /close", tx,
      ))).rejects.toThrow(/already closed/i);
    });

    it("close without lead investigator rejects", async () => {
      await expect(db.transaction((tx) => storage.closeOosInvestigation(
        inv.id,
        { disposition: "APPROVED", dispositionReason: "retest passed", leadInvestigatorUserId: null as unknown as string },
        qaUser.id, "rid-c", "POST /close", tx,
      ))).rejects.toThrow(/lead investigator/i);
    });
  });
});
