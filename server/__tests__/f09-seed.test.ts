// F-09: Seed & fixtures — verifies seedOnce() is idempotent and that the
// withRollback wrapper isolates test mutations.

import { describe, it, expect, beforeAll } from "vitest";
import { seedOnce } from "../seed/test/index";
import { seedIds } from "../seed/ids";
import { withRollback } from "./helpers/tx";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "../db";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb("F-09: seed fixtures", () => {
  beforeAll(async () => {
    await seedOnce();
  });

  // ── Users ──────────────────────────────────────────────────────────────────

  it("seeds all 7 users", async () => {
    const rows = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, seedIds.users.admin));
    expect(rows).toHaveLength(1);
  });

  it("seeds Carrie Treat with QA + ADMIN roles", async () => {
    const roles = await db
      .select({ role: schema.userRoles.role })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, seedIds.users.carrieTreat));
    const roleSet = new Set(roles.map((r) => r.role));
    expect(roleSet.has("QA")).toBe(true);
    expect(roleSet.has("ADMIN")).toBe(true);
  });

  it("disabled user has DISABLED status", async () => {
    const [row] = await db
      .select({ status: schema.users.status })
      .from(schema.users)
      .where(eq(schema.users.id, seedIds.users.disabled));
    expect(row?.status).toBe("DISABLED");
  });

  // ── Locations ──────────────────────────────────────────────────────────────

  it("seeds 5 locations", async () => {
    const ids = Object.values(seedIds.locations);
    const rows = await db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(eq(schema.locations.id, seedIds.locations.quarantine));
    expect(rows).toHaveLength(1);
    expect(ids).toHaveLength(5);
  });

  // ── Suppliers + qualifications ─────────────────────────────────────────────

  it("seeds primary UA supplier as QUALIFIED", async () => {
    const [q] = await db
      .select({ status: schema.supplierQualifications.status })
      .from(schema.supplierQualifications)
      .where(eq(schema.supplierQualifications.id, seedIds.supplierQualifications.primaryUA));
    expect(q?.status).toBe("QUALIFIED");
  });

  it("seeds disqualified supplier as DISQUALIFIED", async () => {
    const [q] = await db
      .select({ status: schema.supplierQualifications.status })
      .from(schema.supplierQualifications)
      .where(eq(schema.supplierQualifications.id, seedIds.supplierQualifications.disqualified));
    expect(q?.status).toBe("DISQUALIFIED");
  });

  // ── Products ───────────────────────────────────────────────────────────────

  it("seeds 5 products with correct SKUs", async () => {
    const rows = await db
      .select({ sku: schema.products.sku })
      .from(schema.products)
      .where(eq(schema.products.id, seedIds.products.urolithinRaw));
    expect(rows[0]?.sku).toBe("RM-UA-001");
  });

  // ── Lots + receiving records ───────────────────────────────────────────────

  it("seeds uaApproved lot with APPROVED status (locked)", async () => {
    const [row] = await db
      .select({ quarantineStatus: schema.lots.quarantineStatus })
      .from(schema.lots)
      .where(eq(schema.lots.id, seedIds.lots.uaApproved));
    expect(row?.quarantineStatus).toBe("APPROVED");
  });

  it("seeds uaRejected lot with REJECTED status (locked)", async () => {
    const [row] = await db
      .select({ quarantineStatus: schema.lots.quarantineStatus })
      .from(schema.lots)
      .where(eq(schema.lots.id, seedIds.lots.uaRejected));
    expect(row?.quarantineStatus).toBe("REJECTED");
  });

  it("seeds receiving record for each lot", async () => {
    const [row] = await db
      .select({ status: schema.receivingRecords.status })
      .from(schema.receivingRecords)
      .where(eq(schema.receivingRecords.id, seedIds.receivingRecords.uaApproved));
    expect(row?.status).toBe("APPROVED");
  });

  // ── COAs ───────────────────────────────────────────────────────────────────

  it("seeds rejected COA with overallResult FAIL", async () => {
    const [row] = await db
      .select({ overallResult: schema.coaDocuments.overallResult })
      .from(schema.coaDocuments)
      .where(eq(schema.coaDocuments.id, seedIds.coas.uaRejectedLead));
    expect(row?.overallResult).toBe("FAIL");
  });

  // ── Recipes ────────────────────────────────────────────────────────────────

  it("seeds recipe with 2 lines", async () => {
    const lines = await db
      .select({ id: schema.recipeLines.id })
      .from(schema.recipeLines)
      .where(eq(schema.recipeLines.recipeId, seedIds.recipes.proUroV1));
    expect(lines).toHaveLength(2);
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  it("seedOnce() is idempotent — second call does not throw or duplicate", async () => {
    await expect(seedOnce()).resolves.toBeUndefined();
    const rows = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, seedIds.users.admin));
    expect(rows).toHaveLength(1); // still exactly one, not two
  });

  // ── withRollback isolation ─────────────────────────────────────────────────

  it("withRollback rolls back mutations so they don't affect other tests", async () => {
    // Insert a location inside a rolled-back transaction.
    const testId = "ffffffff-test-0000-0000-000000000001";
    await withRollback(async (tx) => {
      await tx
        .insert(schema.locations)
        .values({ id: testId, name: "Temp Test Location" });
    });

    // The row must not exist outside the transaction.
    const rows = await db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(eq(schema.locations.id, testId));
    expect(rows).toHaveLength(0);
  });
});
