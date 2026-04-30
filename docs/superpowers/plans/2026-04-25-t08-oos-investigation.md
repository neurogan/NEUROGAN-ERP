# T-08 OOS Investigation Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a lab test result records `pass=false`, automatically open an OOS investigation that QC must close with a documented disposition and electronic signature.

**Architecture:** Mirrors T-07 lab qualifications — routes in `server/routes.ts`, storage methods in `server/db-storage.ts`, schema in `shared/schema.ts`, single-page React UI. Closure ceremonies use the existing `performSignature` wrapper which inserts the signature and the state mutation in the same transaction. Lifecycle is a thin state machine (`OPEN ↔ RETEST_PENDING → CLOSED`) backed by DB CHECK constraints.

**Tech Stack:** PostgreSQL + Drizzle ORM + drizzle-zod, Express + Zod, React + wouter + Radix UI + @tanstack/react-query + react-hook-form, vitest, supertest.

**Spec source:** `docs/superpowers/specs/2026-04-25-t08-oos-investigation-design.md`

---

## Spec deviation note

The spec referenced roles `QC_MANAGER` and `PCQI`. The actual `userRoleEnum` (`shared/schema.ts:33`) only contains `ADMIN, QA, PRODUCTION, WAREHOUSE, LAB_TECH, VIEWER`. QC ceremonies in this codebase (lab qualify/disqualify, BPR QC review, COA QC review) all use `requireRole("QA", "ADMIN")`. **This plan uses `requireRole("QA", "ADMIN")` for every OOS write action** to match the existing pattern.

## File structure

| File | Responsibility |
|---|---|
| `migrations/0016_t08_oos_investigations.sql` | Three new tables, partial unique index, three CHECK constraints |
| `migrations/meta/_journal.json` | Journal entry for migration 0016 |
| `shared/schema.ts` | Drizzle table defs, enums, insert schemas, type exports; new audit and signature meaning enum values |
| `server/db-storage.ts` | Storage methods: create/read/transition/close OOS investigations; hook into `addLabTestResult` |
| `server/routes.ts` | 7 new HTTP routes for OOS investigations |
| `server/__tests__/oos-investigations.storage.test.ts` | Storage method unit tests (vitest) |
| `server/__tests__/oos-investigations.routes.test.ts` | Route integration tests (supertest) |
| `server/__tests__/oos-investigations.hook.test.ts` | `addLabTestResult` hook integration test |
| `client/src/pages/OosInvestigations.tsx` | Single-page React UI: list, detail dialog, action buttons, modals |
| `client/src/App.tsx` | Register `/oos-investigations` route + nav item |

---

## Task 1: Migration 0016, Drizzle schema, enum extensions

**Goal:** All schema, types, and enum values in place. No application logic yet.

**Files:**
- Create: `migrations/0016_t08_oos_investigations.sql`
- Modify: `migrations/meta/_journal.json` (append entry idx 16)
- Modify: `shared/schema.ts` (lines 33, 786-801, 834-849, append new tables)

**Acceptance Criteria:**
- [ ] `pnpm typecheck` passes
- [ ] `pnpm check:migrations` passes
- [ ] `pnpm migrate:up` against fresh local DB applies 0016 cleanly
- [ ] `signatureMeaningEnum` includes `OOS_INVESTIGATION_CLOSE`
- [ ] `auditActionEnum` includes `OOS_OPENED`, `OOS_CLOSED`
- [ ] Tables `erp_oos_investigations`, `erp_oos_investigation_test_results`, `erp_oos_investigation_counter` exist with all columns from the spec
- [ ] Unique partial index `oos_one_open_per_coa` on `(coa_document_id) WHERE status != 'CLOSED'` exists
- [ ] CHECK constraints `oos_closed_consistency`, `oos_recall_fields_required`, `oos_no_investigation_reason_consistency` exist

**Verify:** `pnpm typecheck && pnpm check:migrations && DATABASE_URL=$LOCAL_DB pnpm migrate:up` → exit 0

**Steps:**

- [ ] **Step 1: Branch from `FDA-EQMS-feature-package`**
```bash
git fetch origin
git checkout -b ticket/t-08-oos-investigation origin/FDA-EQMS-feature-package
```

- [ ] **Step 2: Add audit and signature meaning enum values**

Edit `shared/schema.ts` lines 786-801, append `"OOS_OPENED"` and `"OOS_CLOSED"` to `auditActionEnum`:
```typescript
export const auditActionEnum = z.enum([
  "CREATE", "UPDATE", "DELETE_BLOCKED", "TRANSITION", "SIGN",
  "LOGIN", "LOGIN_FAILED", "LOGOUT",
  "ROLE_GRANT", "ROLE_REVOKE", "PASSWORD_ROTATE",
  "LAB_RESULT_ADDED", "LAB_QUALIFIED", "LAB_DISQUALIFIED",
  "OOS_OPENED",
  "OOS_CLOSED",
]);
```

Edit lines 834-849, append `"OOS_INVESTIGATION_CLOSE"` to `signatureMeaningEnum`:
```typescript
export const signatureMeaningEnum = z.enum([
  "AUTHORED", "REVIEWED", "APPROVED", "REJECTED",
  "QC_DISPOSITION", "QA_RELEASE", "DEVIATION_DISPOSITION",
  "RETURN_DISPOSITION", "COMPLAINT_REVIEW", "SAER_SUBMIT",
  "MMR_APPROVAL", "SPEC_APPROVAL",
  "LAB_APPROVAL", "LAB_DISQUALIFICATION",
  "OOS_INVESTIGATION_CLOSE",
]);
```

- [ ] **Step 3: Create migration SQL**

Create `migrations/0016_t08_oos_investigations.sql`:
```sql
-- 0016: T-08 OOS investigation workflow.
-- Auto-creates an investigation when a lab test result records pass=false.
-- QC closes with disposition + signature per 21 CFR §111.113 / §111.123 / SOP-QC-006.
-- This migration touches no user-adjacent tables; pnpm check:migrations passes by construction.

CREATE TABLE "erp_oos_investigations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "oos_number" text NOT NULL UNIQUE,
  "coa_document_id" varchar NOT NULL REFERENCES "erp_coa_documents"("id"),
  "lot_id" varchar NOT NULL REFERENCES "erp_lots"("id"),
  "status" text NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN','RETEST_PENDING','CLOSED')),
  "disposition" text CHECK ("disposition" IS NULL OR "disposition" IN ('APPROVED','REJECTED','RECALL','NO_INVESTIGATION_NEEDED')),
  "disposition_reason" text,
  "no_investigation_reason" text CHECK ("no_investigation_reason" IS NULL OR "no_investigation_reason" IN ('LAB_ERROR','SAMPLE_INVALID','INSTRUMENT_OUT_OF_CALIBRATION','OTHER')),
  "recall_class" text CHECK ("recall_class" IS NULL OR "recall_class" IN ('I','II','III')),
  "recall_distribution_scope" text,
  "recall_fda_notification_date" date,
  "recall_customer_notification_date" date,
  "recall_recovery_target_date" date,
  "recall_affected_lot_ids" varchar[],
  "lead_investigator_user_id" uuid REFERENCES "erp_users"("id"),
  "auto_created_at" timestamptz NOT NULL DEFAULT now(),
  "closed_by_user_id" uuid REFERENCES "erp_users"("id"),
  "closed_at" timestamptz,
  "closure_signature_id" uuid REFERENCES "erp_electronic_signatures"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "oos_closed_consistency" CHECK (
    ("status" = 'CLOSED') = (
      "closed_by_user_id" IS NOT NULL
      AND "closed_at" IS NOT NULL
      AND "closure_signature_id" IS NOT NULL
      AND "disposition" IS NOT NULL
      AND "lead_investigator_user_id" IS NOT NULL
      AND "disposition_reason" IS NOT NULL
    )
  ),
  CONSTRAINT "oos_recall_fields_required" CHECK (
    ("disposition" = 'RECALL') = (
      "recall_class" IS NOT NULL AND "recall_distribution_scope" IS NOT NULL
    )
  ),
  CONSTRAINT "oos_no_investigation_reason_consistency" CHECK (
    ("no_investigation_reason" IS NOT NULL) = ("disposition" = 'NO_INVESTIGATION_NEEDED')
  )
);

CREATE UNIQUE INDEX "oos_one_open_per_coa"
  ON "erp_oos_investigations" ("coa_document_id")
  WHERE "status" != 'CLOSED';

CREATE INDEX "oos_status_idx"          ON "erp_oos_investigations" ("status");
CREATE INDEX "oos_lot_id_idx"          ON "erp_oos_investigations" ("lot_id");
CREATE INDEX "oos_auto_created_at_idx" ON "erp_oos_investigations" ("auto_created_at" DESC);

CREATE TABLE "erp_oos_investigation_test_results" (
  "investigation_id"   uuid NOT NULL REFERENCES "erp_oos_investigations"("id") ON DELETE CASCADE,
  "lab_test_result_id" uuid NOT NULL REFERENCES "erp_lab_test_results"("id"),
  PRIMARY KEY ("investigation_id", "lab_test_result_id")
);

CREATE TABLE "erp_oos_investigation_counter" (
  "year" integer PRIMARY KEY,
  "last_seq" integer NOT NULL DEFAULT 0
);
```

- [ ] **Step 4: Add Drizzle schema definitions**

Append to `shared/schema.ts` after the `insertSignatureSchema` block (around line 873):

```typescript
// ─── T-08 OOS investigations ──────────────────────────────────────────────

export const oosStatusEnum = z.enum(["OPEN", "RETEST_PENDING", "CLOSED"]);
export type OosStatus = z.infer<typeof oosStatusEnum>;

export const oosDispositionEnum = z.enum(["APPROVED", "REJECTED", "RECALL", "NO_INVESTIGATION_NEEDED"]);
export type OosDisposition = z.infer<typeof oosDispositionEnum>;

export const oosNoInvestigationReasonEnum = z.enum([
  "LAB_ERROR", "SAMPLE_INVALID", "INSTRUMENT_OUT_OF_CALIBRATION", "OTHER",
]);
export type OosNoInvestigationReason = z.infer<typeof oosNoInvestigationReasonEnum>;

export const oosRecallClassEnum = z.enum(["I", "II", "III"]);
export type OosRecallClass = z.infer<typeof oosRecallClassEnum>;

export const oosInvestigations = pgTable("erp_oos_investigations", {
  id:                              uuid("id").primaryKey().defaultRandom(),
  oosNumber:                       text("oos_number").notNull().unique(),
  coaDocumentId:                   varchar("coa_document_id").notNull(),
  lotId:                           varchar("lot_id").notNull(),
  status:                          text("status").$type<OosStatus>().notNull().default("OPEN"),
  disposition:                     text("disposition").$type<OosDisposition | null>(),
  dispositionReason:               text("disposition_reason"),
  noInvestigationReason:           text("no_investigation_reason").$type<OosNoInvestigationReason | null>(),
  recallClass:                     text("recall_class").$type<OosRecallClass | null>(),
  recallDistributionScope:         text("recall_distribution_scope"),
  recallFdaNotificationDate:       date("recall_fda_notification_date"),
  recallCustomerNotificationDate:  date("recall_customer_notification_date"),
  recallRecoveryTargetDate:        date("recall_recovery_target_date"),
  recallAffectedLotIds:            varchar("recall_affected_lot_ids").array(),
  leadInvestigatorUserId:          uuid("lead_investigator_user_id").references(() => users.id),
  autoCreatedAt:                   timestamp("auto_created_at", { withTimezone: true }).notNull().defaultNow(),
  closedByUserId:                  uuid("closed_by_user_id").references(() => users.id),
  closedAt:                        timestamp("closed_at", { withTimezone: true }),
  closureSignatureId:              uuid("closure_signature_id").references(() => electronicSignatures.id),
  createdAt:                       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:                       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OosInvestigation = typeof oosInvestigations.$inferSelect;

export const oosInvestigationTestResults = pgTable("erp_oos_investigation_test_results", {
  investigationId:  uuid("investigation_id").notNull().references(() => oosInvestigations.id, { onDelete: "cascade" }),
  labTestResultId:  uuid("lab_test_result_id").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.investigationId, t.labTestResultId] }),
}));

export const oosInvestigationCounter = pgTable("erp_oos_investigation_counter", {
  year:    integer("year").primaryKey(),
  lastSeq: integer("last_seq").notNull().default(0),
});
```

Confirm the imports at the top of `shared/schema.ts` already include `pgTable, uuid, text, varchar, timestamp, date, integer, primaryKey`. If `primaryKey` is missing, add it to the `drizzle-orm/pg-core` import.

- [ ] **Step 5: Append migration journal entry**

Edit `migrations/meta/_journal.json`, append after the `0015_t07_lab_qualifications` entry (inside the `entries` array, before the closing `]`):
```json
{
  "idx": 16,
  "version": "7",
  "when": 1745500800000,
  "tag": "0016_t08_oos_investigations",
  "breakpoints": true
}
```

- [ ] **Step 6: Run typecheck and migration safety check**

Run: `pnpm typecheck && pnpm check:migrations`
Expected: exit 0, no output errors.

- [ ] **Step 7: Apply migration to local DB and verify schema**

Run:
```bash
DATABASE_URL=$LOCAL_DB pnpm migrate:up
psql $LOCAL_DB -c "\d erp_oos_investigations" \
  -c "\d erp_oos_investigation_test_results" \
  -c "\d erp_oos_investigation_counter" \
  -c "\d+ erp_oos_investigations" | grep oos_one_open_per_coa
```
Expected: tables show all columns; partial index appears in indexes section.

- [ ] **Step 8: Commit**
```bash
git add shared/schema.ts migrations/0016_t08_oos_investigations.sql migrations/meta/_journal.json
git commit -m "feat(t-08): schema for OOS investigations (migration 0016)"
```

---

## Task 2: Storage methods — counter, create, read, list

**Goal:** Idempotent `getOrCreateOpenOosInvestigation`, plus `getOosInvestigationById` and `listOosInvestigations`. Counter logic exercised through these methods.

**Files:**
- Modify: `server/db-storage.ts` (add a new `// ─── OOS investigations (T-08) ─` section after `getLabTestResults` around line 1928)
- Create: `server/__tests__/oos-investigations.storage.test.ts`

**Acceptance Criteria:**
- [ ] First call to `getOrCreateOpenOosInvestigation` for a year returns `oos_number = 'OOS-<year>-001'`; second returns `'OOS-<year>-002'`; year rollover resets to `001`
- [ ] Second call with same `coaDocumentId` returns the existing investigation and attaches the new test result via junction (no duplicate row)
- [ ] `getOrCreateOpenOosInvestigation` writes one `OOS_OPENED` audit row when creating; no audit row when attaching to existing
- [ ] `getOosInvestigationById` returns full detail (linked test results, lot, COA, lead investigator, closure signature if any)
- [ ] `listOosInvestigations` filters by status, lotId, dateFrom, dateTo, sorts `auto_created_at DESC`
- [ ] All tests pass; typecheck passes

**Verify:** `pnpm test oos-investigations.storage` → all PASS

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/oos-investigations.storage.test.ts`:
```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { storage } from "../storage";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { hashPassword } from "../auth/password";

describe("OOS investigation storage", () => {
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

  beforeEach(async () => {
    // Re-seed users, lot, COA, two failing test results before each test
    [qaUser] = await db.insert(schema.users).values({
      email: `qa-${Date.now()}@test.local`,
      fullName: "QA User",
      passwordHash: await hashPassword("Test1234!Password"),
      status: "ACTIVE",
    }).returning();
    await db.insert(schema.userRoles).values({ userId: qaUser.id, role: "QA" });

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
    await db.transaction(async (tx) =>
      storage.getOrCreateOpenOosInvestigation(coaId, lotId, labTestResult1.id, qaUser.id, "rid-1", "POST /test", tx));
    // Create second COA + new failing result for same lot
    const [coa2] = await db.insert(schema.coaDocuments).values({ lotId }).returning();
    const [r3] = await db.insert(schema.labTestResults).values({
      coaDocumentId: coa2.id, analyteName: "ph", resultValue: "2", specMin: "5", specMax: "9", pass: false, testedByUserId: qaUser.id,
    }).returning();
    const inv2 = await db.transaction(async (tx) =>
      storage.getOrCreateOpenOosInvestigation(coa2.id, lotId, r3.id, qaUser.id, "rid-3", "POST /test", tx));
    const year = new Date().getFullYear();
    expect(inv2.oosNumber).toBe(`OOS-${year}-002`);
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test oos-investigations.storage`
Expected: FAIL with "storage.getOrCreateOpenOosInvestigation is not a function" (or similar).

- [ ] **Step 3: Implement storage methods**

In `server/db-storage.ts`, add a private counter helper and the four storage methods. Place after `getLabTestResults` (around line 1928), before the `// ─── Supplier Qualifications` section:

```typescript
// ─── OOS investigations (T-08) ───────────────────────

private async nextOosNumber(tx: Tx): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await tx
    .insert(schema.oosInvestigationCounter)
    .values({ year, lastSeq: 1 })
    .onConflictDoUpdate({
      target: schema.oosInvestigationCounter.year,
      set: { lastSeq: sql`${schema.oosInvestigationCounter.lastSeq} + 1` },
    })
    .returning({ lastSeq: schema.oosInvestigationCounter.lastSeq });
  const seq = String(row!.lastSeq).padStart(3, "0");
  return `OOS-${year}-${seq}`;
}

async getOrCreateOpenOosInvestigation(
  coaDocumentId: string,
  lotId: string,
  labTestResultId: string,
  userId: string,
  requestId: string,
  route: string,
  tx: Tx,
): Promise<schema.OosInvestigation> {
  // Look for existing OPEN/RETEST_PENDING investigation for this COA
  const existing = await tx
    .select()
    .from(schema.oosInvestigations)
    .where(and(
      eq(schema.oosInvestigations.coaDocumentId, coaDocumentId),
      inArray(schema.oosInvestigations.status, ["OPEN", "RETEST_PENDING"]),
    ))
    .limit(1);

  let investigation: schema.OosInvestigation;
  let opened = false;
  if (existing[0]) {
    investigation = existing[0];
  } else {
    const oosNumber = await this.nextOosNumber(tx);
    const [created] = await tx
      .insert(schema.oosInvestigations)
      .values({ oosNumber, coaDocumentId, lotId })
      .returning();
    investigation = created!;
    opened = true;
  }

  // Attach test result via junction (idempotent — ON CONFLICT DO NOTHING)
  await tx
    .insert(schema.oosInvestigationTestResults)
    .values({ investigationId: investigation.id, labTestResultId })
    .onConflictDoNothing();

  if (opened) {
    await tx.insert(schema.auditTrail).values({
      userId, action: "OOS_OPENED", entityType: "oos_investigation",
      entityId: investigation.id,
      after: { oosNumber: investigation.oosNumber, coaDocumentId, lotId, labTestResultId },
      requestId, route,
    });
  }

  return investigation;
}

async getOosInvestigationById(id: string): Promise<OosInvestigationDetail | null> {
  const [inv] = await db.select().from(schema.oosInvestigations).where(eq(schema.oosInvestigations.id, id));
  if (!inv) return null;
  const [lot] = await db.select().from(schema.lots).where(eq(schema.lots.id, inv.lotId));
  const [coa] = await db.select().from(schema.coaDocuments).where(eq(schema.coaDocuments.id, inv.coaDocumentId));
  const trJoin = await db
    .select({
      id: schema.labTestResults.id,
      analyteName: schema.labTestResults.analyteName,
      resultValue: schema.labTestResults.resultValue,
      specMin: schema.labTestResults.specMin,
      specMax: schema.labTestResults.specMax,
      pass: schema.labTestResults.pass,
      testedAt: schema.labTestResults.testedAt,
      testedByUserId: schema.labTestResults.testedByUserId,
      testedByName: schema.users.fullName,
      notes: schema.labTestResults.notes,
    })
    .from(schema.oosInvestigationTestResults)
    .innerJoin(schema.labTestResults, eq(schema.oosInvestigationTestResults.labTestResultId, schema.labTestResults.id))
    .leftJoin(schema.users, eq(schema.labTestResults.testedByUserId, schema.users.id))
    .where(eq(schema.oosInvestigationTestResults.investigationId, id));

  let leadInvestigatorName: string | null = null;
  if (inv.leadInvestigatorUserId) {
    const [u] = await db.select({ fullName: schema.users.fullName }).from(schema.users).where(eq(schema.users.id, inv.leadInvestigatorUserId));
    leadInvestigatorName = u?.fullName ?? null;
  }
  let closedByName: string | null = null;
  if (inv.closedByUserId) {
    const [u] = await db.select({ fullName: schema.users.fullName }).from(schema.users).where(eq(schema.users.id, inv.closedByUserId));
    closedByName = u?.fullName ?? null;
  }
  return {
    ...inv,
    lotNumber: lot?.lotNumber ?? null,
    coaDocumentNumber: coa?.documentNumber ?? null,
    testResults: trJoin,
    leadInvestigatorName,
    closedByName,
  };
}

async listOosInvestigations(filters: {
  status?: schema.OosStatus | "ALL";
  lotId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}): Promise<OosInvestigationSummary[]> {
  const conditions: SQL[] = [];
  if (filters.status && filters.status !== "ALL") {
    conditions.push(eq(schema.oosInvestigations.status, filters.status));
  } else if (!filters.status) {
    conditions.push(eq(schema.oosInvestigations.status, "OPEN"));
  }
  if (filters.lotId) conditions.push(eq(schema.oosInvestigations.lotId, filters.lotId));
  if (filters.dateFrom) conditions.push(gte(schema.oosInvestigations.autoCreatedAt, filters.dateFrom));
  if (filters.dateTo) conditions.push(lte(schema.oosInvestigations.autoCreatedAt, filters.dateTo));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: schema.oosInvestigations.id,
      oosNumber: schema.oosInvestigations.oosNumber,
      lotId: schema.oosInvestigations.lotId,
      lotNumber: schema.lots.lotNumber,
      coaDocumentId: schema.oosInvestigations.coaDocumentId,
      status: schema.oosInvestigations.status,
      disposition: schema.oosInvestigations.disposition,
      autoCreatedAt: schema.oosInvestigations.autoCreatedAt,
      closedAt: schema.oosInvestigations.closedAt,
    })
    .from(schema.oosInvestigations)
    .leftJoin(schema.lots, eq(schema.oosInvestigations.lotId, schema.lots.id))
    .where(whereClause)
    .orderBy(desc(schema.oosInvestigations.autoCreatedAt));
  return rows;
}
```

Add type exports near the top of `db-storage.ts` (or in `shared/schema.ts` if a shared types section already exists; mirror the `LabQualificationWithDetails` pattern at line 2546):

```typescript
export type OosInvestigationDetail = schema.OosInvestigation & {
  lotNumber: string | null;
  coaDocumentNumber: string | null;
  testResults: Array<{
    id: string;
    analyteName: string;
    resultValue: string;
    specMin: string | null;
    specMax: string | null;
    pass: boolean;
    testedAt: Date;
    testedByUserId: string;
    testedByName: string | null;
    notes: string | null;
  }>;
  leadInvestigatorName: string | null;
  closedByName: string | null;
};

export type OosInvestigationSummary = {
  id: string;
  oosNumber: string;
  lotId: string;
  lotNumber: string | null;
  coaDocumentId: string;
  status: schema.OosStatus;
  disposition: schema.OosDisposition | null;
  autoCreatedAt: Date;
  closedAt: Date | null;
};
```

If `inArray`, `gte`, `lte`, `sql` are not already imported from `drizzle-orm` at the top of `db-storage.ts`, add them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test oos-investigations.storage`
Expected: 5/5 PASS.

- [ ] **Step 5: Commit**
```bash
git add server/db-storage.ts server/__tests__/oos-investigations.storage.test.ts
git commit -m "feat(t-08): storage methods for create/read/list OOS investigations"
```

---

## Task 3: Storage methods — transitions and closures

**Goal:** `assignOosLeadInvestigator`, `setOosRetestPending`, `clearOosRetestPending`, `closeOosInvestigation`, `markOosNoInvestigationNeeded` with audit + lot side-effects.

**Files:**
- Modify: `server/db-storage.ts` (append to OOS section)
- Modify: `server/__tests__/oos-investigations.storage.test.ts` (add tests)

**Acceptance Criteria:**
- [ ] `assignOosLeadInvestigator` sets `leadInvestigatorUserId`; idempotent if same user; writes `UPDATE` audit row with `meta.subtype="ASSIGN_LEAD_INVESTIGATOR"`
- [ ] `setOosRetestPending` flips `OPEN → RETEST_PENDING`; rejects with status=400 if already CLOSED
- [ ] `clearOosRetestPending` flips `RETEST_PENDING → OPEN`; rejects if already CLOSED
- [ ] `closeOosInvestigation` with `disposition='APPROVED'` sets all closure columns and leaves lot in current `quarantineStatus`
- [ ] `closeOosInvestigation` with `disposition='REJECTED'` flips `lots.quarantineStatus` to `REJECTED`
- [ ] `closeOosInvestigation` with `disposition='RECALL'` requires `recallDetails` (rejects if missing class/scope), sets all recall columns, leaves lot in current status
- [ ] `markOosNoInvestigationNeeded` sets `disposition='NO_INVESTIGATION_NEEDED'`, `noInvestigationReason`, `dispositionReason`, leaves lot in current status
- [ ] Closure on already-CLOSED investigation rejects with status=409
- [ ] Closure rejects with status=422 if `leadInvestigatorUserId` is null

**Verify:** `pnpm test oos-investigations.storage` → all PASS

**Steps:**

- [ ] **Step 1: Append failing tests**

Append to `server/__tests__/oos-investigations.storage.test.ts` inside the existing `describe`:
```typescript
  describe("transitions and closures", () => {
    let inv: schema.OosInvestigation;
    let signatureId: string;

    beforeEach(async () => {
      inv = await db.transaction(async (tx) =>
        storage.getOrCreateOpenOosInvestigation(coaId, lotId, labTestResult1.id, qaUser.id, "rid-x", "POST /x", tx));
      // Create a signature row to attach as the closure_signature_id
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
      // calling again with same user is a no-op (no error)
      await db.transaction((tx) => storage.assignOosLeadInvestigator(inv.id, qaUser.id, qaUser.id, "rid-2", "POST /assign", tx));
      const auditRows = await db.select().from(schema.auditTrail).where(and(eq(schema.auditTrail.entityType, "oos_investigation"), eq(schema.auditTrail.entityId, inv.id)));
      // 1 OOS_OPENED + 1 ASSIGN_LEAD_INVESTIGATOR (second call is no-op, no audit)
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
      await db.transaction((tx) => storage.closeOosInvestigation(
        inv.id,
        { disposition: "REJECTED", dispositionReason: "Confirmed OOS, lot fails spec", leadInvestigatorUserId: qaUser.id },
        qaUser.id, signatureId, "rid-c", "POST /close", tx,
      ));
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
        qaUser.id, signatureId, "rid-c", "POST /close", tx,
      ))).rejects.toThrow(/recall/i);
    });

    it("closeOosInvestigation RECALL with full details persists recall fields", async () => {
      await db.transaction((tx) => storage.assignOosLeadInvestigator(inv.id, qaUser.id, qaUser.id, "rid-l", "POST /a", tx));
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
        qaUser.id, signatureId, "rid-c", "POST /close", tx,
      ));
      const [closed] = await db.select().from(schema.oosInvestigations).where(eq(schema.oosInvestigations.id, inv.id));
      expect(closed.recallClass).toBe("II");
      expect(closed.recallDistributionScope).toContain("4 distributors");
    });

    it("markOosNoInvestigationNeeded fast-path closure", async () => {
      await db.transaction((tx) => storage.markOosNoInvestigationNeeded(
        inv.id, "LAB_ERROR", "Operator pipetting error during sample prep", qaUser.id, qaUser.id, signatureId, "rid-n", "POST /n", tx,
      ));
      const [closed] = await db.select().from(schema.oosInvestigations).where(eq(schema.oosInvestigations.id, inv.id));
      expect(closed.status).toBe("CLOSED");
      expect(closed.disposition).toBe("NO_INVESTIGATION_NEEDED");
      expect(closed.noInvestigationReason).toBe("LAB_ERROR");
      expect(closed.leadInvestigatorUserId).toBe(qaUser.id);
      const [lotRow] = await db.select().from(schema.lots).where(eq(schema.lots.id, lotId));
      // Lot stays in whatever state it was
      expect(lotRow.quarantineStatus).not.toBe("REJECTED");
    });

    it("close on already-CLOSED rejects", async () => {
      await db.transaction((tx) => storage.assignOosLeadInvestigator(inv.id, qaUser.id, qaUser.id, "rid-l", "POST /a", tx));
      await db.transaction((tx) => storage.closeOosInvestigation(
        inv.id,
        { disposition: "APPROVED", dispositionReason: "retest passed", leadInvestigatorUserId: qaUser.id },
        qaUser.id, signatureId, "rid-c1", "POST /close", tx,
      ));
      await expect(db.transaction((tx) => storage.closeOosInvestigation(
        inv.id,
        { disposition: "APPROVED", dispositionReason: "again", leadInvestigatorUserId: qaUser.id },
        qaUser.id, signatureId, "rid-c2", "POST /close", tx,
      ))).rejects.toThrow(/already closed/i);
    });

    it("close without lead investigator rejects", async () => {
      await expect(db.transaction((tx) => storage.closeOosInvestigation(
        inv.id,
        { disposition: "APPROVED", dispositionReason: "retest passed", leadInvestigatorUserId: null as unknown as string },
        qaUser.id, signatureId, "rid-c", "POST /close", tx,
      ))).rejects.toThrow(/lead investigator/i);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test oos-investigations.storage`
Expected: FAIL — methods not defined.

- [ ] **Step 3: Implement transition and closure storage methods**

Append to the OOS section of `server/db-storage.ts`:
```typescript
async assignOosLeadInvestigator(
  investigationId: string,
  leadUserId: string,
  actingUserId: string,
  requestId: string,
  route: string,
  tx: Tx,
): Promise<schema.OosInvestigation> {
  const [existing] = await tx.select().from(schema.oosInvestigations).where(eq(schema.oosInvestigations.id, investigationId));
  if (!existing) throw Object.assign(new Error("Investigation not found"), { status: 404 });
  if (existing.leadInvestigatorUserId === leadUserId) return existing; // idempotent no-op
  const [updated] = await tx
    .update(schema.oosInvestigations)
    .set({ leadInvestigatorUserId: leadUserId, updatedAt: new Date() })
    .where(eq(schema.oosInvestigations.id, investigationId))
    .returning();
  await tx.insert(schema.auditTrail).values({
    userId: actingUserId, action: "UPDATE", entityType: "oos_investigation", entityId: investigationId,
    before: { leadInvestigatorUserId: existing.leadInvestigatorUserId },
    after: { leadInvestigatorUserId: leadUserId },
    meta: { subtype: "ASSIGN_LEAD_INVESTIGATOR" },
    requestId, route,
  });
  return updated!;
}

async setOosRetestPending(investigationId: string, actingUserId: string, requestId: string, route: string, tx: Tx): Promise<schema.OosInvestigation> {
  const [existing] = await tx.select().from(schema.oosInvestigations).where(eq(schema.oosInvestigations.id, investigationId));
  if (!existing) throw Object.assign(new Error("Investigation not found"), { status: 404 });
  if (existing.status === "CLOSED") throw Object.assign(new Error("Investigation already closed"), { status: 409 });
  if (existing.status === "RETEST_PENDING") return existing;
  const [updated] = await tx
    .update(schema.oosInvestigations)
    .set({ status: "RETEST_PENDING", updatedAt: new Date() })
    .where(eq(schema.oosInvestigations.id, investigationId))
    .returning();
  await tx.insert(schema.auditTrail).values({
    userId: actingUserId, action: "UPDATE", entityType: "oos_investigation", entityId: investigationId,
    before: { status: existing.status }, after: { status: "RETEST_PENDING" },
    meta: { subtype: "RETEST_PENDING_SET" }, requestId, route,
  });
  return updated!;
}

async clearOosRetestPending(investigationId: string, actingUserId: string, requestId: string, route: string, tx: Tx): Promise<schema.OosInvestigation> {
  const [existing] = await tx.select().from(schema.oosInvestigations).where(eq(schema.oosInvestigations.id, investigationId));
  if (!existing) throw Object.assign(new Error("Investigation not found"), { status: 404 });
  if (existing.status === "CLOSED") throw Object.assign(new Error("Investigation already closed"), { status: 409 });
  if (existing.status === "OPEN") return existing;
  const [updated] = await tx
    .update(schema.oosInvestigations)
    .set({ status: "OPEN", updatedAt: new Date() })
    .where(eq(schema.oosInvestigations.id, investigationId))
    .returning();
  await tx.insert(schema.auditTrail).values({
    userId: actingUserId, action: "UPDATE", entityType: "oos_investigation", entityId: investigationId,
    before: { status: existing.status }, after: { status: "OPEN" },
    meta: { subtype: "RETEST_PENDING_CLEARED" }, requestId, route,
  });
  return updated!;
}

async closeOosInvestigation(
  investigationId: string,
  payload: {
    disposition: "APPROVED" | "REJECTED" | "RECALL";
    dispositionReason: string;
    leadInvestigatorUserId: string;
    recallDetails?: {
      class: schema.OosRecallClass;
      distributionScope: string;
      fdaNotificationDate?: Date;
      customerNotificationDate?: Date;
      recoveryTargetDate?: Date;
      affectedLotIds?: string[];
    };
  },
  closedByUserId: string,
  signatureId: string,
  requestId: string,
  route: string,
  tx: Tx,
): Promise<schema.OosInvestigation> {
  const [existing] = await tx.select().from(schema.oosInvestigations).where(eq(schema.oosInvestigations.id, investigationId));
  if (!existing) throw Object.assign(new Error("Investigation not found"), { status: 404 });
  if (existing.status === "CLOSED") throw Object.assign(new Error("Investigation already closed"), { status: 409 });
  if (!payload.leadInvestigatorUserId) throw Object.assign(new Error("lead investigator required for closure"), { status: 422 });
  if (!payload.dispositionReason) throw Object.assign(new Error("dispositionReason required"), { status: 422 });
  if (payload.disposition === "RECALL" && !payload.recallDetails?.class) {
    throw Object.assign(new Error("recallDetails.class required for RECALL disposition"), { status: 422 });
  }
  if (payload.disposition === "RECALL" && !payload.recallDetails?.distributionScope) {
    throw Object.assign(new Error("recallDetails.distributionScope required for RECALL disposition"), { status: 422 });
  }

  const isoDate = (d?: Date) => d ? d.toISOString().slice(0, 10) : null;

  const [updated] = await tx
    .update(schema.oosInvestigations)
    .set({
      status: "CLOSED",
      disposition: payload.disposition,
      dispositionReason: payload.dispositionReason,
      leadInvestigatorUserId: payload.leadInvestigatorUserId,
      recallClass: payload.recallDetails?.class ?? null,
      recallDistributionScope: payload.recallDetails?.distributionScope ?? null,
      recallFdaNotificationDate: isoDate(payload.recallDetails?.fdaNotificationDate),
      recallCustomerNotificationDate: isoDate(payload.recallDetails?.customerNotificationDate),
      recallRecoveryTargetDate: isoDate(payload.recallDetails?.recoveryTargetDate),
      recallAffectedLotIds: payload.recallDetails?.affectedLotIds ?? null,
      closedByUserId,
      closedAt: new Date(),
      closureSignatureId: signatureId,
      updatedAt: new Date(),
    })
    .where(eq(schema.oosInvestigations.id, investigationId))
    .returning();

  if (payload.disposition === "REJECTED") {
    await tx
      .update(schema.lots)
      .set({ quarantineStatus: "REJECTED" })
      .where(eq(schema.lots.id, existing.lotId));
  }

  await tx.insert(schema.auditTrail).values({
    userId: closedByUserId, action: "OOS_CLOSED", entityType: "oos_investigation", entityId: investigationId,
    before: { status: existing.status, disposition: existing.disposition },
    after: { status: "CLOSED", disposition: payload.disposition, dispositionReason: payload.dispositionReason, closureSignatureId: signatureId },
    requestId, route,
  });

  return updated!;
}

async markOosNoInvestigationNeeded(
  investigationId: string,
  reason: schema.OosNoInvestigationReason,
  reasonNarrative: string,
  leadInvestigatorUserId: string,
  closedByUserId: string,
  signatureId: string,
  requestId: string,
  route: string,
  tx: Tx,
): Promise<schema.OosInvestigation> {
  const [existing] = await tx.select().from(schema.oosInvestigations).where(eq(schema.oosInvestigations.id, investigationId));
  if (!existing) throw Object.assign(new Error("Investigation not found"), { status: 404 });
  if (existing.status === "CLOSED") throw Object.assign(new Error("Investigation already closed"), { status: 409 });
  if (!leadInvestigatorUserId) throw Object.assign(new Error("lead investigator required for closure"), { status: 422 });
  if (!reasonNarrative) throw Object.assign(new Error("reasonNarrative required"), { status: 422 });

  const [updated] = await tx
    .update(schema.oosInvestigations)
    .set({
      status: "CLOSED",
      disposition: "NO_INVESTIGATION_NEEDED",
      dispositionReason: reasonNarrative,
      noInvestigationReason: reason,
      leadInvestigatorUserId,
      closedByUserId,
      closedAt: new Date(),
      closureSignatureId: signatureId,
      updatedAt: new Date(),
    })
    .where(eq(schema.oosInvestigations.id, investigationId))
    .returning();

  await tx.insert(schema.auditTrail).values({
    userId: closedByUserId, action: "OOS_CLOSED", entityType: "oos_investigation", entityId: investigationId,
    before: { status: existing.status }, after: { status: "CLOSED", disposition: "NO_INVESTIGATION_NEEDED", noInvestigationReason: reason },
    requestId, route,
  });

  return updated!;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test oos-investigations.storage`
Expected: all tests PASS (12+ tests including the 5 from Task 2).

- [ ] **Step 5: Commit**
```bash
git add server/db-storage.ts server/__tests__/oos-investigations.storage.test.ts
git commit -m "feat(t-08): storage methods for OOS investigation transitions and closures"
```

---

## Task 4: Hook into `addLabTestResult`

**Goal:** When `addLabTestResult` is called with `pass=false`, the hook auto-creates (or attaches to) the investigation in the same transaction and flips the lot to `ON_HOLD` when not already in a terminal state.

**Files:**
- Modify: `server/db-storage.ts:1908-1922` (`addLabTestResult`)
- Create: `server/__tests__/oos-investigations.hook.test.ts`

**Acceptance Criteria:**
- [ ] Inserting a `pass=false` test result triggers investigation creation in same `tx`
- [ ] Inserting `pass=true` does NOT create an investigation
- [ ] Lot in `PENDING_QC` flips to `ON_HOLD` after first failing result
- [ ] Lot already in `REJECTED` does NOT flip to `ON_HOLD` after a new failing result
- [ ] Second failing result on same COA attaches to existing investigation
- [ ] Tests pass

**Verify:** `pnpm test oos-investigations.hook` → all PASS

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/oos-investigations.hook.test.ts`:
```typescript
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { storage } from "../storage";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../auth/password";

describe("addLabTestResult OOS hook", () => {
  let qaUser: schema.User;
  let lotId: string;
  let coaId: string;

  beforeEach(async () => {
    [qaUser] = await db.insert(schema.users).values({
      email: `qa-${Date.now()}@test.local`,
      fullName: "QA User",
      passwordHash: await hashPassword("Test1234!Password"),
      status: "ACTIVE",
    }).returning();
    const [product] = await db.insert(schema.products).values({ sku: `P-${Date.now()}`, name: "P" }).returning();
    const [lot] = await db.insert(schema.lots).values({
      productId: product.id, lotNumber: `LOT-${Date.now()}`, quarantineStatus: "PENDING_QC",
    }).returning();
    lotId = lot.id;
    const [coa] = await db.insert(schema.coaDocuments).values({ lotId }).returning();
    coaId = coa.id;
  });

  it("pass=true does NOT create an investigation", async () => {
    await db.transaction((tx) => storage.addLabTestResult(coaId, {
      analyteName: "moisture", resultValue: "5", specMin: "0", specMax: "10", pass: true,
    } as any, qaUser.id, tx));
    const invs = await db.select().from(schema.oosInvestigations).where(eq(schema.oosInvestigations.coaDocumentId, coaId));
    expect(invs).toHaveLength(0);
  });

  it("pass=false creates an investigation and flips lot to ON_HOLD", async () => {
    await db.transaction((tx) => storage.addLabTestResult(coaId, {
      analyteName: "potency", resultValue: "85", specMin: "90", specMax: "110", pass: false,
    } as any, qaUser.id, tx));
    const invs = await db.select().from(schema.oosInvestigations).where(eq(schema.oosInvestigations.coaDocumentId, coaId));
    expect(invs).toHaveLength(1);
    const [lot] = await db.select().from(schema.lots).where(eq(schema.lots.id, lotId));
    expect(lot.quarantineStatus).toBe("ON_HOLD");
  });

  it("second pass=false on same COA attaches to existing investigation", async () => {
    await db.transaction((tx) => storage.addLabTestResult(coaId, {
      analyteName: "potency", resultValue: "85", specMin: "90", specMax: "110", pass: false,
    } as any, qaUser.id, tx));
    await db.transaction((tx) => storage.addLabTestResult(coaId, {
      analyteName: "microbial", resultValue: "1500", specMin: "0", specMax: "1000", pass: false,
    } as any, qaUser.id, tx));
    const invs = await db.select().from(schema.oosInvestigations).where(eq(schema.oosInvestigations.coaDocumentId, coaId));
    expect(invs).toHaveLength(1);
    const junction = await db.select().from(schema.oosInvestigationTestResults).where(eq(schema.oosInvestigationTestResults.investigationId, invs[0].id));
    expect(junction).toHaveLength(2);
  });

  it("REJECTED lot is NOT flipped back to ON_HOLD by a failing test", async () => {
    await db.update(schema.lots).set({ quarantineStatus: "REJECTED" }).where(eq(schema.lots.id, lotId));
    await db.transaction((tx) => storage.addLabTestResult(coaId, {
      analyteName: "potency", resultValue: "85", specMin: "90", specMax: "110", pass: false,
    } as any, qaUser.id, tx));
    const [lot] = await db.select().from(schema.lots).where(eq(schema.lots.id, lotId));
    expect(lot.quarantineStatus).toBe("REJECTED");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test oos-investigations.hook`
Expected: tests fail (lot stays PENDING_QC, no investigation created).

- [ ] **Step 3: Modify `addLabTestResult`**

Replace the body of `addLabTestResult` in `server/db-storage.ts:1908-1922`:
```typescript
async addLabTestResult(coaId: string, data: InsertLabTestResult, userId: string, tx?: Tx): Promise<LabTestResult> {
  const txOrDb = tx ?? db;
  const [result] = await txOrDb.insert(schema.labTestResults).values({
    ...data,
    coaDocumentId: coaId,
    testedByUserId: userId,
  }).returning();

  if (!data.pass) {
    await txOrDb.update(schema.coaDocuments)
      .set({ overallResult: "FAIL" })
      .where(eq(schema.coaDocuments.id, coaId));

    // T-08 hook: auto-create or attach to OOS investigation, flip lot to ON_HOLD if not terminal
    const [coa] = await txOrDb.select({ lotId: schema.coaDocuments.lotId })
      .from(schema.coaDocuments)
      .where(eq(schema.coaDocuments.id, coaId));
    if (coa?.lotId) {
      await this.getOrCreateOpenOosInvestigation(
        coaId, coa.lotId, result!.id, userId,
        "auto-hook", "addLabTestResult", txOrDb as Tx,
      );
      await txOrDb.update(schema.lots)
        .set({ quarantineStatus: "ON_HOLD" })
        .where(and(
          eq(schema.lots.id, coa.lotId),
          notInArray(schema.lots.quarantineStatus, ["ON_HOLD", "REJECTED"]),
        ));
    }
  }

  return result!;
}
```

If `notInArray` is not already imported from `drizzle-orm`, add it.

The hook receives `tx?: Tx` from the caller, but `getOrCreateOpenOosInvestigation` requires `Tx`. The cast `txOrDb as Tx` is safe here because in production this method is always called from inside `withAudit`, which passes a real `Tx`. In test code where `tx` is undefined, `txOrDb` is `db`, and Drizzle's `db` and `Tx` share the same query API for our usage — but for test cleanliness, the hook tests above always wrap calls in `db.transaction(...)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test oos-investigations.hook && pnpm test oos-investigations.storage`
Expected: all tests PASS.

- [ ] **Step 5: Commit**
```bash
git add server/db-storage.ts server/__tests__/oos-investigations.hook.test.ts
git commit -m "feat(t-08): hook addLabTestResult to auto-open OOS investigations on pass=false"
```

---

## Task 5: API routes

**Goal:** 7 HTTP routes wired into `server/routes.ts`, with role gating, Zod validation, `performSignature` for closure ceremonies, and `withAudit` for non-signature mutations.

**Files:**
- Modify: `server/routes.ts` (add new section after `/api/labs/:id/qualifications` route around line 1556)
- Create: `server/__tests__/oos-investigations.routes.test.ts`

**Acceptance Criteria:**
- [ ] `GET /api/oos-investigations` lists investigations with status default OPEN; supports `status`, `lotId`, `dateFrom`, `dateTo` query params
- [ ] `GET /api/oos-investigations/:id` returns full detail or 404
- [ ] `POST /api/oos-investigations/:id/assign-lead` requires QA/ADMIN; rejects 403 for LAB_TECH; rejects identity in body (`leadInvestigatorUserId` parsed from body but `assignedByUserId` rejected)
- [ ] `POST /api/oos-investigations/:id/retest-pending` and `/clear-retest` require QA/ADMIN; reject closed investigations with 409
- [ ] `POST /api/oos-investigations/:id/close` requires QA/ADMIN; with valid signature password creates a signature row and closes investigation atomically; 401 on bad password
- [ ] `POST /api/oos-investigations/:id/mark-no-investigation-needed` same shape as close, with reason instead of disposition
- [ ] All tests pass

**Verify:** `pnpm test oos-investigations.routes` → all PASS

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/oos-investigations.routes.test.ts`:
```typescript
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../auth/password";
import { storage } from "../storage";

const PASS = "Test1234!Password";

describe("OOS investigation routes", () => {
  let app: Express;
  let qaUser: schema.User;
  let labTechUser: schema.User;
  let lotId: string;
  let coaId: string;
  let investigationId: string;
  let labTestResultId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    [qaUser] = await db.insert(schema.users).values({
      email: `qa-${Date.now()}@test.local`,
      fullName: "QA Tester",
      passwordHash: await hashPassword(PASS),
      status: "ACTIVE",
    }).returning();
    await db.insert(schema.userRoles).values({ userId: qaUser.id, role: "QA" });

    [labTechUser] = await db.insert(schema.users).values({
      email: `lt-${Date.now()}@test.local`,
      fullName: "Lab Tech",
      passwordHash: await hashPassword(PASS),
      status: "ACTIVE",
    }).returning();
    await db.insert(schema.userRoles).values({ userId: labTechUser.id, role: "LAB_TECH" });

    const [product] = await db.insert(schema.products).values({ sku: `P-${Date.now()}`, name: "P" }).returning();
    const [lot] = await db.insert(schema.lots).values({
      productId: product.id, lotNumber: `LOT-${Date.now()}`, quarantineStatus: "PENDING_QC",
    }).returning();
    lotId = lot.id;
    const [coa] = await db.insert(schema.coaDocuments).values({ lotId }).returning();
    coaId = coa.id;
    const [tr] = await db.insert(schema.labTestResults).values({
      coaDocumentId: coaId, analyteName: "potency", resultValue: "85",
      specMin: "90", specMax: "110", pass: false, testedByUserId: qaUser.id,
    }).returning();
    labTestResultId = tr.id;
    const inv = await db.transaction((tx) => storage.getOrCreateOpenOosInvestigation(coaId, lotId, labTestResultId, qaUser.id, "rid", "POST /seed", tx));
    investigationId = inv.id;
  });

  it("GET /api/oos-investigations defaults to OPEN", async () => {
    const res = await request(app).get("/api/oos-investigations").set("x-test-user-id", qaUser.id);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.every((i: any) => i.status === "OPEN")).toBe(true);
  });

  it("GET /api/oos-investigations/:id returns detail", async () => {
    const res = await request(app).get(`/api/oos-investigations/${investigationId}`).set("x-test-user-id", qaUser.id);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(investigationId);
    expect(res.body.testResults).toHaveLength(1);
  });

  it("POST .../assign-lead rejects LAB_TECH", async () => {
    const res = await request(app)
      .post(`/api/oos-investigations/${investigationId}/assign-lead`)
      .set("x-test-user-id", labTechUser.id)
      .send({ leadInvestigatorUserId: labTechUser.id });
    expect(res.status).toBe(403);
  });

  it("POST .../assign-lead succeeds for QA", async () => {
    const res = await request(app)
      .post(`/api/oos-investigations/${investigationId}/assign-lead`)
      .set("x-test-user-id", qaUser.id)
      .send({ leadInvestigatorUserId: qaUser.id });
    expect(res.status).toBe(200);
    expect(res.body.leadInvestigatorUserId).toBe(qaUser.id);
  });

  it("POST .../retest-pending then /clear-retest", async () => {
    const r1 = await request(app).post(`/api/oos-investigations/${investigationId}/retest-pending`).set("x-test-user-id", qaUser.id).send({});
    expect(r1.status).toBe(200);
    expect(r1.body.status).toBe("RETEST_PENDING");
    const r2 = await request(app).post(`/api/oos-investigations/${investigationId}/clear-retest`).set("x-test-user-id", qaUser.id).send({});
    expect(r2.status).toBe(200);
    expect(r2.body.status).toBe("OPEN");
  });

  it("POST .../close happy path with REJECTED disposition flips lot", async () => {
    await request(app).post(`/api/oos-investigations/${investigationId}/assign-lead`).set("x-test-user-id", qaUser.id).send({ leadInvestigatorUserId: qaUser.id });
    const res = await request(app)
      .post(`/api/oos-investigations/${investigationId}/close`)
      .set("x-test-user-id", qaUser.id)
      .send({
        disposition: "REJECTED",
        dispositionReason: "Confirmed OOS, lot fails spec",
        leadInvestigatorUserId: qaUser.id,
        signaturePassword: PASS,
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CLOSED");
    expect(res.body.disposition).toBe("REJECTED");
    const [lot] = await db.select().from(schema.lots).where(eq(schema.lots.id, lotId));
    expect(lot.quarantineStatus).toBe("REJECTED");
  });

  it("POST .../close with wrong password returns 401", async () => {
    await request(app).post(`/api/oos-investigations/${investigationId}/assign-lead`).set("x-test-user-id", qaUser.id).send({ leadInvestigatorUserId: qaUser.id });
    const res = await request(app)
      .post(`/api/oos-investigations/${investigationId}/close`)
      .set("x-test-user-id", qaUser.id)
      .send({
        disposition: "APPROVED", dispositionReason: "x",
        leadInvestigatorUserId: qaUser.id, signaturePassword: "wrong-password",
      });
    expect(res.status).toBe(401);
    const [stillOpen] = await db.select().from(schema.oosInvestigations).where(eq(schema.oosInvestigations.id, investigationId));
    expect(stillOpen.status).toBe("OPEN");
  });

  it("POST .../mark-no-investigation-needed fast-path closure", async () => {
    const res = await request(app)
      .post(`/api/oos-investigations/${investigationId}/mark-no-investigation-needed`)
      .set("x-test-user-id", qaUser.id)
      .send({
        reason: "LAB_ERROR",
        reasonNarrative: "Operator pipetting error during sample prep",
        leadInvestigatorUserId: qaUser.id,
        signaturePassword: PASS,
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CLOSED");
    expect(res.body.disposition).toBe("NO_INVESTIGATION_NEEDED");
    expect(res.body.noInvestigationReason).toBe("LAB_ERROR");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test oos-investigations.routes`
Expected: all fail with 404 (routes not registered).

- [ ] **Step 3: Add routes to `server/routes.ts`**

After the `/api/labs/:id/qualifications` GET route (around line 1556), add:
```typescript
// ─── OOS investigations (T-08 §111.113 / §111.123 / SOP-QC-006) ───────

const oosListQuerySchema = z.object({
  status: z.enum(["OPEN", "RETEST_PENDING", "CLOSED", "ALL"]).optional(),
  lotId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const oosCloseBodySchema = z.object({
  disposition: z.enum(["APPROVED", "REJECTED", "RECALL"]),
  dispositionReason: z.string().min(1),
  leadInvestigatorUserId: z.string().uuid(),
  recallDetails: z.object({
    class: z.enum(["I", "II", "III"]),
    distributionScope: z.string().min(1),
    fdaNotificationDate: z.string().optional(),
    customerNotificationDate: z.string().optional(),
    recoveryTargetDate: z.string().optional(),
    affectedLotIds: z.array(z.string()).optional(),
  }).optional(),
  signaturePassword: z.string().min(1),
});

const oosNoInvestigationBodySchema = z.object({
  reason: z.enum(["LAB_ERROR", "SAMPLE_INVALID", "INSTRUMENT_OUT_OF_CALIBRATION", "OTHER"]),
  reasonNarrative: z.string().min(1),
  leadInvestigatorUserId: z.string().uuid(),
  signaturePassword: z.string().min(1),
});

const oosAssignLeadBodySchema = z.object({
  leadInvestigatorUserId: z.string().uuid(),
});

app.get("/api/oos-investigations", requireAuth, async (req, res, next) => {
  try {
    const q = oosListQuerySchema.parse(req.query);
    const items = await storage.listOosInvestigations({
      status: q.status,
      lotId: q.lotId,
      dateFrom: q.dateFrom ? new Date(q.dateFrom) : undefined,
      dateTo: q.dateTo ? new Date(q.dateTo) : undefined,
    });
    res.json(items);
  } catch (err) { next(err); }
});

app.get<{ id: string }>("/api/oos-investigations/:id", requireAuth, async (req, res, next) => {
  try {
    const detail = await storage.getOosInvestigationById(req.params.id);
    if (!detail) return res.status(404).json({ message: "OOS investigation not found" });
    res.json(detail);
  } catch (err) { next(err); }
});

app.post<{ id: string }>(
  "/api/oos-investigations/:id/assign-lead",
  requireAuth, requireRole("QA", "ADMIN"), rejectIdentityInBody(["assignedByUserId"]),
  async (req, res, next) => {
    try {
      const { leadInvestigatorUserId } = oosAssignLeadBodySchema.parse(req.body);
      const updated = await withAudit(
        { userId: req.user!.id, action: "UPDATE", entityType: "oos_investigation",
          entityId: req.params.id, before: null,
          route: `${req.method} ${req.path}`, requestId: req.requestId,
          meta: { subtype: "ASSIGN_LEAD_INVESTIGATOR" } },
        (tx) => storage.assignOosLeadInvestigator(req.params.id, leadInvestigatorUserId, req.user!.id, req.requestId, `${req.method} ${req.path}`, tx),
      );
      res.json(updated);
    } catch (err) { next(err); }
  },
);

app.post<{ id: string }>(
  "/api/oos-investigations/:id/retest-pending",
  requireAuth, requireRole("QA", "ADMIN"),
  async (req, res, next) => {
    try {
      const updated = await withAudit(
        { userId: req.user!.id, action: "UPDATE", entityType: "oos_investigation",
          entityId: req.params.id, before: null,
          route: `${req.method} ${req.path}`, requestId: req.requestId,
          meta: { subtype: "RETEST_PENDING_SET" } },
        (tx) => storage.setOosRetestPending(req.params.id, req.user!.id, req.requestId, `${req.method} ${req.path}`, tx),
      );
      res.json(updated);
    } catch (err) { next(err); }
  },
);

app.post<{ id: string }>(
  "/api/oos-investigations/:id/clear-retest",
  requireAuth, requireRole("QA", "ADMIN"),
  async (req, res, next) => {
    try {
      const updated = await withAudit(
        { userId: req.user!.id, action: "UPDATE", entityType: "oos_investigation",
          entityId: req.params.id, before: null,
          route: `${req.method} ${req.path}`, requestId: req.requestId,
          meta: { subtype: "RETEST_PENDING_CLEARED" } },
        (tx) => storage.clearOosRetestPending(req.params.id, req.user!.id, req.requestId, `${req.method} ${req.path}`, tx),
      );
      res.json(updated);
    } catch (err) { next(err); }
  },
);

app.post<{ id: string }>(
  "/api/oos-investigations/:id/close",
  requireAuth, requireRole("QA", "ADMIN"), rejectIdentityInBody(["closedByUserId"]),
  async (req, res, next) => {
    try {
      const body = oosCloseBodySchema.parse(req.body);
      const recall = body.recallDetails;
      const updated = await performSignature(
        {
          userId: req.user!.id,
          password: body.signaturePassword,
          meaning: "OOS_INVESTIGATION_CLOSE",
          entityType: "oos_investigation",
          entityId: req.params.id,
          commentary: body.dispositionReason,
          recordSnapshot: { disposition: body.disposition, recallClass: recall?.class },
          route: `${req.method} ${req.path}`,
          requestId: req.requestId,
        },
        async (tx) => {
          // Look up the signature we just created — performSignature inserts before invoking the callback
          const [sig] = await tx.select({ id: schema.electronicSignatures.id })
            .from(schema.electronicSignatures)
            .where(and(
              eq(schema.electronicSignatures.entityType, "oos_investigation"),
              eq(schema.electronicSignatures.entityId, req.params.id),
              eq(schema.electronicSignatures.requestId, req.requestId),
            ))
            .orderBy(desc(schema.electronicSignatures.signedAt))
            .limit(1);
          return storage.closeOosInvestigation(
            req.params.id,
            {
              disposition: body.disposition,
              dispositionReason: body.dispositionReason,
              leadInvestigatorUserId: body.leadInvestigatorUserId,
              recallDetails: recall ? {
                class: recall.class,
                distributionScope: recall.distributionScope,
                fdaNotificationDate: recall.fdaNotificationDate ? new Date(recall.fdaNotificationDate) : undefined,
                customerNotificationDate: recall.customerNotificationDate ? new Date(recall.customerNotificationDate) : undefined,
                recoveryTargetDate: recall.recoveryTargetDate ? new Date(recall.recoveryTargetDate) : undefined,
                affectedLotIds: recall.affectedLotIds,
              } : undefined,
            },
            req.user!.id, sig!.id, req.requestId, `${req.method} ${req.path}`, tx,
          );
        },
      );
      res.json(updated);
    } catch (err) { next(err); }
  },
);

app.post<{ id: string }>(
  "/api/oos-investigations/:id/mark-no-investigation-needed",
  requireAuth, requireRole("QA", "ADMIN"), rejectIdentityInBody(["closedByUserId"]),
  async (req, res, next) => {
    try {
      const body = oosNoInvestigationBodySchema.parse(req.body);
      const updated = await performSignature(
        {
          userId: req.user!.id,
          password: body.signaturePassword,
          meaning: "OOS_INVESTIGATION_CLOSE",
          entityType: "oos_investigation",
          entityId: req.params.id,
          commentary: body.reasonNarrative,
          recordSnapshot: { disposition: "NO_INVESTIGATION_NEEDED", reason: body.reason },
          route: `${req.method} ${req.path}`,
          requestId: req.requestId,
        },
        async (tx) => {
          const [sig] = await tx.select({ id: schema.electronicSignatures.id })
            .from(schema.electronicSignatures)
            .where(and(
              eq(schema.electronicSignatures.entityType, "oos_investigation"),
              eq(schema.electronicSignatures.entityId, req.params.id),
              eq(schema.electronicSignatures.requestId, req.requestId),
            ))
            .orderBy(desc(schema.electronicSignatures.signedAt))
            .limit(1);
          return storage.markOosNoInvestigationNeeded(
            req.params.id, body.reason, body.reasonNarrative,
            body.leadInvestigatorUserId, req.user!.id, sig!.id,
            req.requestId, `${req.method} ${req.path}`, tx,
          );
        },
      );
      res.json(updated);
    } catch (err) { next(err); }
  },
);
```

If `desc`, `and`, `eq` aren't already imported in `server/routes.ts`, add them; same for `z` from zod.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test oos-investigations.routes`
Expected: all 8 tests PASS.

- [ ] **Step 5: Run full test suite (regression check)**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS.

- [ ] **Step 6: Commit**
```bash
git add server/routes.ts server/__tests__/oos-investigations.routes.test.ts
git commit -m "feat(t-08): API routes for OOS investigations with signature ceremonies"
```

---

## Task 6: Frontend page — list, detail dialog, modals

**Goal:** Single-page React UI at `/oos-investigations` mirroring `LabsSettings.tsx` layout.

**Files:**
- Create: `client/src/pages/OosInvestigations.tsx`

**Acceptance Criteria:**
- [ ] Page renders a filter bar (status default OPEN), table with columns OOS#, lot, opened-at, status, disposition, days-open, "View"
- [ ] "View" opens a dialog with header info, failing test results table, lead-investigator section with "Assign me" button, status-action panel
- [ ] "Mark no investigation needed" modal: reason dropdown + narrative textarea + signature password → POST
- [ ] "Close investigation" modal: disposition dropdown; if RECALL, expand structured recall form (class radio, distribution scope, date pickers, affected lots multi-select); signature password → POST
- [ ] Read-only mode after closure (action buttons hidden)
- [ ] On mutation success: react-query invalidates `["/api/oos-investigations"]` and closes dialog/modal

**Verify:** Manual smoke test — start `pnpm dev`, log in as a QA user, create a failing lab result, navigate to `/oos-investigations`, perform full close flow with each disposition.

**Steps:**

- [ ] **Step 1: Create the page**

Create `client/src/pages/OosInvestigations.tsx`. Use `LabsSettings.tsx` (`client/src/pages/settings/LabsSettings.tsx`) as the structural template. Top-level shape:

```typescript
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface OosSummary {
  id: string;
  oosNumber: string;
  lotId: string;
  lotNumber: string | null;
  coaDocumentId: string;
  status: "OPEN" | "RETEST_PENDING" | "CLOSED";
  disposition: "APPROVED" | "REJECTED" | "RECALL" | "NO_INVESTIGATION_NEEDED" | null;
  autoCreatedAt: string;
  closedAt: string | null;
}

interface OosDetail extends OosSummary {
  dispositionReason: string | null;
  noInvestigationReason: string | null;
  recallClass: "I" | "II" | "III" | null;
  recallDistributionScope: string | null;
  recallFdaNotificationDate: string | null;
  recallCustomerNotificationDate: string | null;
  recallRecoveryTargetDate: string | null;
  recallAffectedLotIds: string[] | null;
  leadInvestigatorUserId: string | null;
  leadInvestigatorName: string | null;
  closedByUserId: string | null;
  closedByName: string | null;
  testResults: Array<{
    id: string;
    analyteName: string;
    resultValue: string;
    specMin: string | null;
    specMax: string | null;
    pass: boolean;
    testedAt: string;
    testedByName: string | null;
    notes: string | null;
  }>;
}

export default function OosInvestigations() {
  const { user } = useAuth();
  const isQc = user?.roles.includes("QA") || user?.roles.includes("ADMIN");
  const qc = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<"OPEN" | "RETEST_PENDING" | "CLOSED" | "ALL">("OPEN");
  const [openInvestigationId, setOpenInvestigationId] = useState<string | null>(null);
  const [closeMode, setCloseMode] = useState<"none" | "close" | "no-investigation">("none");

  const { data: investigations = [] } = useQuery<OosSummary[]>({
    queryKey: ["/api/oos-investigations", { status: statusFilter }],
    queryFn: async () => {
      const params = statusFilter === "ALL" ? "" : `?status=${statusFilter}`;
      const res = await apiRequest("GET", `/api/oos-investigations${params}`);
      return res.json();
    },
  });

  const { data: detail } = useQuery<OosDetail | null>({
    queryKey: ["/api/oos-investigations", openInvestigationId],
    queryFn: async () => {
      if (!openInvestigationId) return null;
      const res = await apiRequest("GET", `/api/oos-investigations/${openInvestigationId}`);
      return res.json();
    },
    enabled: !!openInvestigationId,
  });

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ["/api/oos-investigations"] });
  };

  // Mutations
  const assignLead = useMutation({
    mutationFn: ({ id, leadInvestigatorUserId }: { id: string; leadInvestigatorUserId: string }) =>
      apiRequest("POST", `/api/oos-investigations/${id}/assign-lead`, { leadInvestigatorUserId }).then(r => r.json()),
    onSuccess: () => { refetchAll(); toast({ title: "Lead investigator assigned" }); },
  });

  const setRetestPending = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/oos-investigations/${id}/retest-pending`, {}).then(r => r.json()),
    onSuccess: () => { refetchAll(); toast({ title: "Retest pending" }); },
  });

  const clearRetest = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/oos-investigations/${id}/clear-retest`, {}).then(r => r.json()),
    onSuccess: () => { refetchAll(); toast({ title: "Retest cleared" }); },
  });

  const closeInvestigation = useMutation({
    mutationFn: (body: any) =>
      apiRequest("POST", `/api/oos-investigations/${openInvestigationId}/close`, body).then(r => r.json()),
    onSuccess: () => { refetchAll(); setCloseMode("none"); setOpenInvestigationId(null); toast({ title: "Investigation closed" }); },
  });

  const markNoInvestigation = useMutation({
    mutationFn: (body: any) =>
      apiRequest("POST", `/api/oos-investigations/${openInvestigationId}/mark-no-investigation-needed`, body).then(r => r.json()),
    onSuccess: () => { refetchAll(); setCloseMode("none"); setOpenInvestigationId(null); toast({ title: "Marked as no investigation needed" }); },
  });

  // Render filter bar + table
  return (
    <div className="container mx-auto py-6">
      <h1 className="text-2xl font-semibold mb-4">OOS Investigations</h1>
      <div className="flex gap-4 mb-4">
        <div>
          <Label>Status</Label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="OPEN">Open</SelectItem>
              <SelectItem value="RETEST_PENDING">Retest Pending</SelectItem>
              <SelectItem value="CLOSED">Closed</SelectItem>
              <SelectItem value="ALL">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>OOS #</TableHead>
            <TableHead>Lot</TableHead>
            <TableHead>Opened</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Disposition</TableHead>
            <TableHead>Days open</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {investigations.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No OOS investigations match the current filters.</TableCell></TableRow>
          )}
          {investigations.map((i) => {
            const opened = new Date(i.autoCreatedAt);
            const daysOpen = Math.floor((Date.now() - opened.getTime()) / 86400000);
            return (
              <TableRow key={i.id}>
                <TableCell>{i.oosNumber}</TableCell>
                <TableCell>{i.lotNumber ?? i.lotId.slice(0, 8)}</TableCell>
                <TableCell>{opened.toLocaleDateString()}</TableCell>
                <TableCell><Badge>{i.status}</Badge></TableCell>
                <TableCell>{i.disposition && <Badge variant="secondary">{i.disposition}</Badge>}</TableCell>
                <TableCell>{daysOpen}</TableCell>
                <TableCell><Button size="sm" variant="outline" onClick={() => setOpenInvestigationId(i.id)}>View</Button></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Detail dialog */}
      <Dialog open={!!openInvestigationId && closeMode === "none"} onOpenChange={(o) => !o && setOpenInvestigationId(null)}>
        <DialogContent className="max-w-3xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.oosNumber}</DialogTitle>
                <DialogDescription>Lot {detail.lotNumber} · COA {detail.coaDocumentId.slice(0, 8)} · <Badge>{detail.status}</Badge></DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <section>
                  <h3 className="font-medium mb-2">Failing test results</h3>
                  <Table>
                    <TableHeader><TableRow><TableHead>Analyte</TableHead><TableHead>Spec</TableHead><TableHead>Result</TableHead><TableHead>Tester</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {detail.testResults.map(tr => (
                        <TableRow key={tr.id}>
                          <TableCell>{tr.analyteName}</TableCell>
                          <TableCell>{tr.specMin}–{tr.specMax}</TableCell>
                          <TableCell className={tr.pass ? "" : "text-red-600 font-medium"}>{tr.resultValue}</TableCell>
                          <TableCell>{tr.testedByName}</TableCell>
                          <TableCell>{new Date(tr.testedAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>

                <section>
                  <h3 className="font-medium mb-2">Lead investigator</h3>
                  <p>{detail.leadInvestigatorName ?? <em>none assigned</em>}</p>
                  {isQc && detail.status !== "CLOSED" && detail.leadInvestigatorUserId !== user!.id && (
                    <Button size="sm" onClick={() => assignLead.mutate({ id: detail.id, leadInvestigatorUserId: user!.id })}>Assign me as lead investigator</Button>
                  )}
                </section>

                {isQc && detail.status !== "CLOSED" && (
                  <section className="space-x-2">
                    {detail.status === "OPEN" ? (
                      <Button variant="outline" onClick={() => setRetestPending.mutate(detail.id)}>Mark retest pending</Button>
                    ) : (
                      <Button variant="outline" onClick={() => clearRetest.mutate(detail.id)}>Clear retest pending</Button>
                    )}
                    <Button variant="outline" onClick={() => setCloseMode("no-investigation")}>Mark no investigation needed</Button>
                    <Button onClick={() => setCloseMode("close")}>Close investigation</Button>
                  </section>
                )}

                {detail.status === "CLOSED" && (
                  <section>
                    <h3 className="font-medium mb-2">Closure</h3>
                    <p>Disposition: <Badge>{detail.disposition}</Badge></p>
                    <p>Reason: {detail.dispositionReason}</p>
                    <p>Closed by: {detail.closedByName} · {detail.closedAt && new Date(detail.closedAt).toLocaleString()}</p>
                  </section>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Close investigation modal */}
      <CloseInvestigationModal
        open={closeMode === "close"}
        onOpenChange={(o) => !o && setCloseMode("none")}
        leadUserId={detail?.leadInvestigatorUserId ?? null}
        onSubmit={(body) => closeInvestigation.mutate(body)}
        pending={closeInvestigation.isPending}
      />

      {/* No-investigation-needed modal */}
      <NoInvestigationNeededModal
        open={closeMode === "no-investigation"}
        onOpenChange={(o) => !o && setCloseMode("none")}
        leadUserId={detail?.leadInvestigatorUserId ?? user?.id ?? null}
        onSubmit={(body) => markNoInvestigation.mutate(body)}
        pending={markNoInvestigation.isPending}
      />
    </div>
  );
}

function CloseInvestigationModal({ open, onOpenChange, leadUserId, onSubmit, pending }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  leadUserId: string | null;
  onSubmit: (body: any) => void; pending: boolean;
}) {
  const [disposition, setDisposition] = useState<"APPROVED" | "REJECTED" | "RECALL">("APPROVED");
  const [reason, setReason] = useState("");
  const [recallClass, setRecallClass] = useState<"I" | "II" | "III">("II");
  const [distributionScope, setDistributionScope] = useState("");
  const [fdaNot, setFdaNot] = useState("");
  const [custNot, setCustNot] = useState("");
  const [recovTarget, setRecovTarget] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Close OOS Investigation</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Disposition</Label>
            <Select value={disposition} onValueChange={(v) => setDisposition(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="APPROVED">APPROVED — release</SelectItem>
                <SelectItem value="REJECTED">REJECTED — fails spec</SelectItem>
                <SelectItem value="RECALL">RECALL — distributed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Disposition reason</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
          </div>
          {disposition === "RECALL" && (
            <div className="space-y-2 border rounded p-3 bg-amber-50">
              <Label>Recall class</Label>
              <RadioGroup value={recallClass} onValueChange={(v) => setRecallClass(v as any)}>
                <div className="flex items-center gap-2"><RadioGroupItem value="I" id="rc1" /><Label htmlFor="rc1">Class I</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="II" id="rc2" /><Label htmlFor="rc2">Class II</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="III" id="rc3" /><Label htmlFor="rc3">Class III</Label></div>
              </RadioGroup>
              <Label>Distribution scope</Label>
              <Textarea value={distributionScope} onChange={(e) => setDistributionScope(e.target.value)} required />
              <Label>FDA notification date</Label>
              <Input type="date" value={fdaNot} onChange={(e) => setFdaNot(e.target.value)} />
              <Label>Customer notification date</Label>
              <Input type="date" value={custNot} onChange={(e) => setCustNot(e.target.value)} />
              <Label>Recovery target date</Label>
              <Input type="date" value={recovTarget} onChange={(e) => setRecovTarget(e.target.value)} />
            </div>
          )}
          <div>
            <Label>Your password (e-signature)</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={pending || !leadUserId || !reason || !password} onClick={() => onSubmit({
            disposition, dispositionReason: reason,
            leadInvestigatorUserId: leadUserId,
            recallDetails: disposition === "RECALL" ? {
              class: recallClass, distributionScope,
              fdaNotificationDate: fdaNot || undefined,
              customerNotificationDate: custNot || undefined,
              recoveryTargetDate: recovTarget || undefined,
            } : undefined,
            signaturePassword: password,
          })}>{pending ? "Closing…" : "Sign and close"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoInvestigationNeededModal({ open, onOpenChange, leadUserId, onSubmit, pending }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  leadUserId: string | null;
  onSubmit: (body: any) => void; pending: boolean;
}) {
  const [reason, setReason] = useState<"LAB_ERROR" | "SAMPLE_INVALID" | "INSTRUMENT_OUT_OF_CALIBRATION" | "OTHER">("LAB_ERROR");
  const [narrative, setNarrative] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Mark "No Investigation Needed"</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="LAB_ERROR">Lab error (sample prep, dilution, etc.)</SelectItem>
                <SelectItem value="SAMPLE_INVALID">Sample invalid</SelectItem>
                <SelectItem value="INSTRUMENT_OUT_OF_CALIBRATION">Instrument out of calibration</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Narrative (required)</Label>
            <Textarea value={narrative} onChange={(e) => setNarrative(e.target.value)} required />
          </div>
          <div>
            <Label>Your password (e-signature)</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={pending || !leadUserId || !narrative || !password} onClick={() => onSubmit({
            reason, reasonNarrative: narrative,
            leadInvestigatorUserId: leadUserId,
            signaturePassword: password,
          })}>{pending ? "Submitting…" : "Sign"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify the page builds**

Run: `pnpm typecheck`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit**
```bash
git add client/src/pages/OosInvestigations.tsx
git commit -m "feat(t-08): OOS investigation page with list, detail, and close modals"
```

---

## Task 7: Wire route + nav link, end-to-end smoke test

**Goal:** New page reachable from the top nav for QA/ADMIN roles. Manual smoke test confirms the full flow works in a browser.

**Files:**
- Modify: `client/src/App.tsx` (register `/oos-investigations` route + add `navItems` entry)

**Acceptance Criteria:**
- [ ] Route `/oos-investigations` renders `OosInvestigations` component
- [ ] Top-nav shows "OOS" link for users with `QA` or `ADMIN` role
- [ ] Top-nav HIDES the link for `LAB_TECH` role
- [ ] Manual smoke test passes: log in as QA, create a failing test result, navigate to OOS page, see new investigation, assign lead, close with each disposition

**Verify:** `pnpm dev`; perform smoke flow in a browser.

**Steps:**

- [ ] **Step 1: Register route in `App.tsx`**

In `client/src/App.tsx`, add the import near the top with other page imports:
```typescript
import OosInvestigations from "@/pages/OosInvestigations";
```

In the `<Switch>` block (around line 177), add the route:
```tsx
<Route path="/oos-investigations" component={OosInvestigations} />
```

- [ ] **Step 2: Add nav item**

In `client/src/App.tsx`, find the `navItems` array (around line 36-44). Add a new entry following the existing shape:
```typescript
{ path: "/oos-investigations", label: "OOS", roles: ["QA", "ADMIN"] },
```

(Verify the existing `navItems` shape — if it uses different field names like `href`/`name`/`requiredRoles`, match those exactly.)

- [ ] **Step 3: Manual smoke test**

```bash
pnpm dev
```

In the browser:
1. Log in as a QA user (or ADMIN)
2. Navigate to a lot, create a COA, add a failing lab test result (e.g., potency 85, spec 90–110, pass=false)
3. Confirm the lot's `quarantineStatus` shows ON_HOLD on the lot detail page
4. Navigate to "OOS" in top nav → see the auto-created investigation
5. Click "View" → confirm the failing result appears
6. Click "Assign me as lead investigator"
7. Click "Mark retest pending" → confirm status flips
8. Click "Clear retest pending" → confirm status flips back
9. Click "Close investigation" → pick `RECALL` → fill the recall form → enter password → submit
10. Confirm investigation now shows CLOSED + RECALL disposition + recall details
11. Confirm action buttons hidden in read-only mode
12. Log out, log in as a LAB_TECH user → confirm "OOS" link is NOT in top nav

- [ ] **Step 4: Run full test suite (regression)**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm check:migrations`
Expected: all PASS.

- [ ] **Step 5: Commit and push**
```bash
git add client/src/App.tsx
git commit -m "feat(t-08): wire OOS investigations route and nav link"
git push -u origin ticket/t-08-oos-investigation
```

- [ ] **Step 6: Open PR**
```bash
gh pr create --base FDA-EQMS-feature-package --title "T-08 OOS investigation workflow" --body "$(cat <<'EOF'
## Summary
- Adds OOS investigation workflow per spec `docs/superpowers/specs/2026-04-25-t08-oos-investigation-design.md`
- Auto-opens investigation on `pass=false` lab test result; QC closes with disposition + signature
- Three closure dispositions: APPROVED, REJECTED, RECALL — plus fast-path NO_INVESTIGATION_NEEDED
- Migration 0016: 3 new tables, partial unique index, 3 CHECK constraints; no user mutations
- Closes regulatory floor for FDA 483 Observation 4 + SOP-QC-006 (21 CFR §111.113 / §111.123)

## Test plan
- [x] `pnpm test` all pass
- [x] `pnpm typecheck` and `pnpm lint` pass
- [x] `pnpm check:migrations` passes
- [x] Manual smoke test: QA closes investigation with each disposition, LAB_TECH sees no nav link

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**1. Spec coverage**
| Spec section | Implemented in |
|---|---|
| §3 Scope (in-scope) | All tasks |
| §3 Out-of-scope items | Not implemented (correct) |
| §4 Architecture (mirror T-07) | Tasks 2-5 |
| §5 Schema (3 tables, indexes, CHECK constraints) | Task 1 |
| §6 Signature meaning code | Task 1 (Step 2) |
| §7 Storage methods | Tasks 2-3 |
| §7 Hook into addLabTestResult | Task 4 |
| §7 7 API routes | Task 5 |
| §8 Frontend page + modals | Task 6 |
| §8 Side nav link + role gating | Task 7 |
| §9 Data flow | Implicit in route + storage logic |
| §10 Error handling | Validated via tests in Tasks 2, 3, 4, 5 |
| §11 Testing strategy | Tasks 2, 3, 4, 5 unit + integration tests |
| §12 Files created/modified | All 7 tasks |

**2. Placeholder scan:** No "TBD", "TODO", "implement later". Every step has either code blocks or exact commands. Recall details handling shows the exact transformation (Date → ISO string slice).

**3. Type consistency:**
- `OosStatus`, `OosDisposition`, `OosRecallClass`, `OosNoInvestigationReason` enum names consistent across schema, storage, routes, frontend
- Storage method names consistent: `getOrCreateOpenOosInvestigation`, `getOosInvestigationById`, `listOosInvestigations`, `assignOosLeadInvestigator`, `setOosRetestPending`, `clearOosRetestPending`, `closeOosInvestigation`, `markOosNoInvestigationNeeded`
- Field names match between SQL DDL, Drizzle defs, storage methods, route handlers, frontend types: `oosNumber`/`oos_number`, `coaDocumentId`/`coa_document_id`, `lotId`/`lot_id`, `leadInvestigatorUserId`/`lead_investigator_user_id`, `closedByUserId`/`closed_by_user_id`, `closureSignatureId`/`closure_signature_id`, `autoCreatedAt`/`auto_created_at`, `noInvestigationReason`/`no_investigation_reason`
- Audit action codes: `OOS_OPENED`, `OOS_CLOSED` added to enum (Task 1) and used in Tasks 2-5
- Signature meaning code: `OOS_INVESTIGATION_CLOSE` added to enum (Task 1) and used in Task 5

**Plan is consistent and ready for execution.**
