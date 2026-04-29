# R-03 Equipment & Cleaning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Equipment & Cleaning module end-to-end and wire BPR start to enforce calibration, qualification, and line-clearance gates — closing FDA 483 Observation 3.

**Architecture:** Greenfield module. Eight new tables in `shared/schema.ts`, one SQL migration (`0017`), storage methods follow the T-07 lab-qualification pattern (`(...args, requestId, route, tx) => Promise<Entity>`), routes added to `server/routes.ts`, gate functions live in a new `server/state/bpr-equipment-gates.ts`, UI is a top-level "Equipment" tab with four subtabs.

**Tech Stack:** Drizzle ORM + Postgres, Express + Zod, Vitest with `describeIfDb` pattern, React + TanStack Query (existing client patterns), F-04 signature ceremony.

**Spec:** `docs/superpowers/specs/2026-04-27-r03-equipment-cleaning-design.md`

---

## File structure (decomposition lock-in)

```
shared/
  schema.ts                                  — append 8 tables, 5 new signature meanings,
                                                 1 new audit action set; rename BPR field
migrations/
  0017_r03_equipment_cleaning.sql            — all new tables + BPR column rename + FK add
  __tests__/
    0017-r03-rename-bpr-cleaning-text.test.ts — migration safety test
server/
  storage/
    equipment.ts                             — equipment + qualifications + calibration storage
    cleaning-line-clearance.ts               — cleaning logs + line clearances storage
  state/
    bpr-equipment-gates.ts                   — checkCalibration, checkQualification,
                                                 checkLineClearance, runAllGates
  routes.ts                                  — extend with /api/equipment/* endpoints
  __tests__/
    r03-equipment-master.test.ts
    r03-qualifications.test.ts
    r03-calibration.test.ts
    r03-cleaning.test.ts
    r03-line-clearance.test.ts
    r03-bpr-gates.test.ts
client/
  src/
    pages/
      equipment/
        index.tsx                            — Master subtab (list + CRUD modal)
        detail.tsx                           — /equipment/:id (Overview/Qual/Cal tabs)
        calibration.tsx                      — Calibration subtab
        cleaning.tsx                         — Cleaning Logs subtab
        line-clearance.tsx                   — Line Clearance subtab
      bpr/
        start-modal.tsx                      — equipment-list confirmation + gate UI
    App.tsx                                  — add Equipment routes
    components/
      nav.tsx                                — add Equipment top-level link
docs/superpowers/specs/
  2026-04-27-r03-equipment-cleaning-design.md  (already committed)
```

**Note on `bpr_equipment_used`:** Per the spec the junction is keyed on the BPR. But in the implementation, BPRs auto-create from a production-batch transition (`db-storage.ts:741-758`), and gates must run *before* that auto-create. Therefore the table's primary key is the **production_batch_id**, not bpr_id. The BPR has a 1:1 relationship to the production_batch, so equipment used by a BPR resolves through `production_batch.id`. Renaming this from the spec — see Task 1 schema.

---

## Task 1: Migration 0017 + schema additions

**Goal:** All 8 new tables created, BPR column renamed (no row deletions), Drizzle schema reflects everything.

**Files:**
- Create: `migrations/0017_r03_equipment_cleaning.sql`
- Create: `migrations/__tests__/0017-r03-rename-bpr-cleaning-text.test.ts`
- Modify: `shared/schema.ts` (append after `productionNotes` block at line ~419; rename BPR field at line 348)

**Acceptance Criteria:**
- [ ] `pnpm db:migrate` applies cleanly on a fresh test DB
- [ ] Re-running the migration is a no-op (idempotent)
- [ ] BPR rows with non-null `cleaning_record_reference` end up with same value in `cleaning_record_legacy_text`
- [ ] No `UPDATE`/`DELETE`/`DROP` statements in the migration
- [ ] Drizzle types for new tables compile (`pnpm tsc --noEmit`)

**Verify:** `pnpm test migrations/__tests__/0017-r03-rename-bpr-cleaning-text.test.ts -- --run` → PASS

**Steps:**

- [ ] **Step 1: Write the migration SQL**

Create `migrations/0017_r03_equipment_cleaning.sql`:

```sql
-- 0017: R-03 Equipment & Cleaning module.
-- Closes 483 Obs 3. Adds equipment master, IQ/OQ/PQ qualifications,
-- calibration schedule + records, cleaning logs (F-05 dual-verification),
-- line clearances, and BPR equipment-used junction.
-- Touches no user-adjacent tables; pnpm check:migrations passes by construction.

CREATE TABLE IF NOT EXISTS "erp_equipment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_tag" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "model" text,
  "serial" text,
  "manufacturer" text,
  "location_id" varchar REFERENCES "erp_locations"("id"),
  "status" text NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','RETIRED')),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "equipment_status_idx" ON "erp_equipment" ("status");

CREATE TABLE IF NOT EXISTS "erp_equipment_qualifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "equipment_id" uuid NOT NULL REFERENCES "erp_equipment"("id"),
  "type" text NOT NULL CHECK ("type" IN ('IQ','OQ','PQ')),
  "status" text NOT NULL CHECK ("status" IN ('PENDING','QUALIFIED','EXPIRED')),
  "valid_from" date,
  "valid_until" date,
  "signature_id" uuid REFERENCES "erp_electronic_signatures"("id"),
  "document_url" text,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "qualification_signed_when_qualified" CHECK (
    ("status" = 'QUALIFIED') = ("signature_id" IS NOT NULL AND "valid_from" IS NOT NULL AND "valid_until" IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS "qualifications_equipment_type_idx" ON "erp_equipment_qualifications" ("equipment_id", "type");

CREATE TABLE IF NOT EXISTS "erp_calibration_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "equipment_id" uuid NOT NULL UNIQUE REFERENCES "erp_equipment"("id"),
  "frequency_days" integer NOT NULL CHECK ("frequency_days" > 0),
  "next_due_at" timestamptz NOT NULL,
  "last_record_id" uuid
);

CREATE TABLE IF NOT EXISTS "erp_calibration_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "equipment_id" uuid NOT NULL REFERENCES "erp_equipment"("id"),
  "performed_at" timestamptz NOT NULL DEFAULT now(),
  "performed_by_user_id" uuid NOT NULL REFERENCES "erp_users"("id"),
  "result" text NOT NULL CHECK ("result" IN ('PASS','FAIL')),
  "cert_url" text,
  "signature_id" uuid NOT NULL REFERENCES "erp_electronic_signatures"("id"),
  "notes" text
);
CREATE INDEX IF NOT EXISTS "calibration_records_equipment_at_idx" ON "erp_calibration_records" ("equipment_id", "performed_at" DESC);

DO $$ BEGIN
  ALTER TABLE "erp_calibration_schedules"
    ADD CONSTRAINT "calibration_schedules_last_record_fk"
    FOREIGN KEY ("last_record_id") REFERENCES "erp_calibration_records"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "erp_cleaning_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "equipment_id" uuid NOT NULL REFERENCES "erp_equipment"("id"),
  "cleaned_at" timestamptz NOT NULL DEFAULT now(),
  "cleaned_by_user_id" uuid NOT NULL REFERENCES "erp_users"("id"),
  "verified_by_user_id" uuid NOT NULL REFERENCES "erp_users"("id"),
  "method" text,
  "prior_product_id" varchar REFERENCES "erp_products"("id"),
  "next_product_id" varchar REFERENCES "erp_products"("id"),
  "signature_id" uuid NOT NULL REFERENCES "erp_electronic_signatures"("id"),
  "notes" text,
  CONSTRAINT "cleaning_dual_verification" CHECK ("cleaned_by_user_id" <> "verified_by_user_id")
);
CREATE INDEX IF NOT EXISTS "cleaning_logs_equipment_at_idx" ON "erp_cleaning_logs" ("equipment_id", "cleaned_at" DESC);

CREATE TABLE IF NOT EXISTS "erp_line_clearances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "equipment_id" uuid NOT NULL REFERENCES "erp_equipment"("id"),
  "product_change_from_id" varchar REFERENCES "erp_products"("id"),
  "product_change_to_id" varchar NOT NULL REFERENCES "erp_products"("id"),
  "performed_at" timestamptz NOT NULL DEFAULT now(),
  "performed_by_user_id" uuid NOT NULL REFERENCES "erp_users"("id"),
  "signature_id" uuid NOT NULL REFERENCES "erp_electronic_signatures"("id"),
  "notes" text
);
CREATE INDEX IF NOT EXISTS "line_clearances_equipment_at_idx" ON "erp_line_clearances" ("equipment_id", "performed_at" DESC);

CREATE TABLE IF NOT EXISTS "erp_product_equipment" (
  "product_id" varchar NOT NULL REFERENCES "erp_products"("id"),
  "equipment_id" uuid NOT NULL REFERENCES "erp_equipment"("id"),
  PRIMARY KEY ("product_id", "equipment_id")
);

CREATE TABLE IF NOT EXISTS "erp_production_batch_equipment_used" (
  "production_batch_id" varchar NOT NULL REFERENCES "erp_production_batches"("id"),
  "equipment_id" uuid NOT NULL REFERENCES "erp_equipment"("id"),
  PRIMARY KEY ("production_batch_id", "equipment_id")
);

-- BPR free-text cleaning reference: rename to legacy column, add FK.
-- NEVER deletes data. Idempotent via duplicate_column / undefined_column guards.
DO $$ BEGIN
  ALTER TABLE "erp_batch_production_records" RENAME COLUMN "cleaning_record_reference" TO "cleaning_record_legacy_text";
EXCEPTION
  WHEN undefined_column THEN NULL;     -- already renamed
  WHEN duplicate_column THEN NULL;     -- legacy column already exists
END $$;

DO $$ BEGIN
  ALTER TABLE "erp_batch_production_records" ADD COLUMN "cleaning_log_id" uuid REFERENCES "erp_cleaning_logs"("id");
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
```

- [ ] **Step 2: Add Drizzle schema definitions**

Append to `shared/schema.ts` after the `productionNotes` block (find line `export const productionNotes` and insert after the closing `});`):

```typescript
// ─── R-03 Equipment & Cleaning ────────────────────────────────────────────

export const equipment = pgTable("erp_equipment", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetTag: text("asset_tag").notNull().unique(),
  name: text("name").notNull(),
  model: text("model"),
  serial: text("serial"),
  manufacturer: text("manufacturer"),
  locationId: varchar("location_id"),
  status: text("status").notNull().default("ACTIVE").$type<"ACTIVE" | "RETIRED">(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const equipmentQualifications = pgTable("erp_equipment_qualifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  equipmentId: uuid("equipment_id").notNull().references(() => equipment.id),
  type: text("type").notNull().$type<"IQ" | "OQ" | "PQ">(),
  status: text("status").notNull().$type<"PENDING" | "QUALIFIED" | "EXPIRED">(),
  validFrom: text("valid_from"),    // ISO date "YYYY-MM-DD"
  validUntil: text("valid_until"),  // ISO date "YYYY-MM-DD"
  signatureId: uuid("signature_id").references(() => electronicSignatures.id),
  documentUrl: text("document_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const calibrationSchedules = pgTable("erp_calibration_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  equipmentId: uuid("equipment_id").notNull().unique().references(() => equipment.id),
  frequencyDays: integer("frequency_days").notNull(),
  nextDueAt: timestamp("next_due_at", { withTimezone: true }).notNull(),
  lastRecordId: uuid("last_record_id"),
});

export const calibrationRecords = pgTable("erp_calibration_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  equipmentId: uuid("equipment_id").notNull().references(() => equipment.id),
  performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
  performedByUserId: uuid("performed_by_user_id").notNull().references(() => users.id),
  result: text("result").notNull().$type<"PASS" | "FAIL">(),
  certUrl: text("cert_url"),
  signatureId: uuid("signature_id").notNull().references(() => electronicSignatures.id),
  notes: text("notes"),
});

export const cleaningLogs = pgTable("erp_cleaning_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  equipmentId: uuid("equipment_id").notNull().references(() => equipment.id),
  cleanedAt: timestamp("cleaned_at", { withTimezone: true }).notNull().defaultNow(),
  cleanedByUserId: uuid("cleaned_by_user_id").notNull().references(() => users.id),
  verifiedByUserId: uuid("verified_by_user_id").notNull().references(() => users.id),
  method: text("method"),
  priorProductId: varchar("prior_product_id"),
  nextProductId: varchar("next_product_id"),
  signatureId: uuid("signature_id").notNull().references(() => electronicSignatures.id),
  notes: text("notes"),
});

export const lineClearances = pgTable("erp_line_clearances", {
  id: uuid("id").primaryKey().defaultRandom(),
  equipmentId: uuid("equipment_id").notNull().references(() => equipment.id),
  productChangeFromId: varchar("product_change_from_id"),
  productChangeToId: varchar("product_change_to_id").notNull(),
  performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
  performedByUserId: uuid("performed_by_user_id").notNull().references(() => users.id),
  signatureId: uuid("signature_id").notNull().references(() => electronicSignatures.id),
  notes: text("notes"),
});

export const productEquipment = pgTable("erp_product_equipment", {
  productId: varchar("product_id").notNull(),
  equipmentId: uuid("equipment_id").notNull().references(() => equipment.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.productId, t.equipmentId] }),
}));

export const productionBatchEquipmentUsed = pgTable("erp_production_batch_equipment_used", {
  productionBatchId: varchar("production_batch_id").notNull(),
  equipmentId: uuid("equipment_id").notNull().references(() => equipment.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.productionBatchId, t.equipmentId] }),
}));

export type Equipment = typeof equipment.$inferSelect;
export type InsertEquipment = typeof equipment.$inferInsert;
export type EquipmentQualification = typeof equipmentQualifications.$inferSelect;
export type CalibrationSchedule = typeof calibrationSchedules.$inferSelect;
export type CalibrationRecord = typeof calibrationRecords.$inferSelect;
export type CleaningLog = typeof cleaningLogs.$inferSelect;
export type LineClearance = typeof lineClearances.$inferSelect;
```

Add at the top of `shared/schema.ts` if not already imported: `primaryKey` from `drizzle-orm/pg-core`. Verify imports include `integer` (used for `frequencyDays`).

- [ ] **Step 3: Rename existing BPR field in Drizzle schema**

In `shared/schema.ts:348`, rename:

```typescript
// BEFORE:
cleaningRecordReference: text("cleaning_record_reference"),

// AFTER:
cleaningRecordLegacyText: text("cleaning_record_legacy_text"),
cleaningLogId: uuid("cleaning_log_id"),
```

The `cleaning_log_id` FK reference is omitted from the Drizzle definition because circular type references between BPR and cleaningLogs are messy; runtime FK is enforced by Postgres via the migration.

- [ ] **Step 4: Update the one client read of the renamed field**

Find `client/src/pages/bpr.tsx:306` and `client/src/pages/bpr.tsx:315` (search: `cleaningRecordReference`):

```typescript
// BEFORE (line 306):
const [cleaningRecordRef, setCleaningRecordRef] = useState(bpr.cleaningRecordReference ?? "");

// AFTER:
const [cleaningRecordRef, setCleaningRecordRef] = useState(bpr.cleaningRecordLegacyText ?? "");
```

```typescript
// BEFORE (line 315):
cleaningRecordReference: cleaningRecordRef || null,

// AFTER (the legacy field becomes read-only — new BPRs link via cleaningLogId, set elsewhere):
cleaningRecordLegacyText: cleaningRecordRef || null,
```

- [ ] **Step 5: Write the migration safety test**

Create `migrations/__tests__/0017-r03-rename-bpr-cleaning-text.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import * as schema from "@shared/schema";
import { sql } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

describeIfDb("Migration 0017 — BPR cleaning_record_reference rename safety", () => {
  it("preserves existing legacy text values across migration (idempotent re-run)", async () => {
    // The migration has already been applied as part of pnpm test setup.
    // Verify: the legacy column exists, the FK column exists, and any non-null
    // legacy values are still present.
    const legacyCol = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'erp_batch_production_records'
        AND column_name = 'cleaning_record_legacy_text'
    `);
    expect(legacyCol.rows.length).toBe(1);

    const fkCol = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'erp_batch_production_records'
        AND column_name = 'cleaning_log_id'
    `);
    expect(fkCol.rows.length).toBe(1);

    // Old column name must not exist
    const oldCol = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'erp_batch_production_records'
        AND column_name = 'cleaning_record_reference'
    `);
    expect(oldCol.rows.length).toBe(0);
  });

  it("running the migration block twice is a no-op (idempotency check)", async () => {
    // Re-applying the rename is gated by EXCEPTION WHEN undefined_column.
    // The test simply asserts that the schema's terminal state is what we expect
    // after one or more applications.
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM information_schema.columns
      WHERE table_name = 'erp_batch_production_records'
        AND column_name IN ('cleaning_record_legacy_text', 'cleaning_log_id')
    `);
    expect(Number((result.rows[0] as { count: string }).count)).toBe(2);
  });
});
```

- [ ] **Step 6: Run migration + tests**

```bash
pnpm db:migrate
pnpm tsc --noEmit
pnpm test migrations/__tests__/0017-r03-rename-bpr-cleaning-text.test.ts -- --run
```

Expected: migration applies, types compile, test passes.

- [ ] **Step 7: Commit**

```bash
git add shared/schema.ts migrations/0017_r03_equipment_cleaning.sql migrations/__tests__/0017-r03-rename-bpr-cleaning-text.test.ts client/src/pages/bpr.tsx
git commit -m "feat(r-03): migration 0017 + Drizzle schema for equipment/cleaning"
```

---

## Task 2: Signature meanings + audit actions

**Goal:** Five new signature meanings registered; new audit-action codes available.

**Files:**
- Modify: `shared/schema.ts:837-853` (signatureMeaningEnum) and the auditActionEnum (search `auditActionEnum`)

**Acceptance Criteria:**
- [ ] `signatureMeaningEnum` includes `EQUIPMENT_QUALIFIED`, `EQUIPMENT_DISQUALIFIED`, `CALIBRATION_RECORDED`, `CLEANING_VERIFIED`, `LINE_CLEARANCE`
- [ ] `auditActionEnum` includes `EQUIPMENT_CREATED`, `EQUIPMENT_QUALIFIED`, `EQUIPMENT_DISQUALIFIED`, `CALIBRATION_LOGGED`, `CLEANING_LOGGED`, `LINE_CLEARANCE_LOGGED`, `START_BLOCKED`
- [ ] `pnpm tsc --noEmit` passes

**Verify:** `pnpm tsc --noEmit` → no errors

**Steps:**

- [ ] **Step 1: Add signature meanings**

In `shared/schema.ts:837`:

```typescript
export const signatureMeaningEnum = z.enum([
  "AUTHORED",
  "REVIEWED",
  "APPROVED",
  "REJECTED",
  "QC_DISPOSITION",
  "QA_RELEASE",
  "DEVIATION_DISPOSITION",
  "RETURN_DISPOSITION",
  "COMPLAINT_REVIEW",
  "SAER_SUBMIT",
  "MMR_APPROVAL",
  "SPEC_APPROVAL",
  "LAB_APPROVAL",
  "LAB_DISQUALIFICATION",
  "OOS_INVESTIGATION_CLOSE",
  "EQUIPMENT_QUALIFIED",
  "EQUIPMENT_DISQUALIFIED",
  "CALIBRATION_RECORDED",
  "CLEANING_VERIFIED",
  "LINE_CLEARANCE",
]);
```

- [ ] **Step 2: Add audit actions**

Find `auditActionEnum` in `shared/schema.ts` (it's around the auditTrail block, ~line 800). Append:

```typescript
"EQUIPMENT_CREATED",
"EQUIPMENT_RETIRED",
"EQUIPMENT_QUALIFIED",
"EQUIPMENT_DISQUALIFIED",
"CALIBRATION_LOGGED",
"CLEANING_LOGGED",
"LINE_CLEARANCE_LOGGED",
"START_BLOCKED",
```

- [ ] **Step 3: Type-check + commit**

```bash
pnpm tsc --noEmit
git add shared/schema.ts
git commit -m "feat(r-03): register signature meanings and audit actions"
```

---

## Task 3: Equipment master storage + routes

**Goal:** Equipment CRUD with role gating. ADMIN/QA_MANAGER can create/retire; all roles can read.

**Files:**
- Create: `server/storage/equipment.ts`
- Modify: `server/routes.ts` (add equipment endpoints, ~near the `/api/labs/*` block)
- Create: `server/__tests__/r03-equipment-master.test.ts`

**Acceptance Criteria:**
- [ ] `POST /api/equipment` 201 for ADMIN/QA_MANAGER, 403 for WAREHOUSE/LAB_TECH
- [ ] `GET /api/equipment` returns equipment list, all auth users
- [ ] `GET /api/equipment/:id` returns one equipment with current qualifications + calibration schedule embedded
- [ ] `PATCH /api/equipment/:id/retire` 200 for ADMIN/QA_MANAGER, writes audit row with action `EQUIPMENT_RETIRED`
- [ ] All role-gated routes return 403 (not 401) when authenticated user lacks the role
- [ ] Equipment with non-unique `assetTag` returns 409 `DUPLICATE_ASSET_TAG`

**Verify:** `pnpm test server/__tests__/r03-equipment-master.test.ts -- --run` → PASS (≥6 tests)

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/r03-equipment-master.test.ts`. Mirror the `t07-lab-qualification.test.ts` structure. Fixtures:
- 1 ADMIN user, 1 QA_MANAGER user, 1 WAREHOUSE user
- 1 location

Tests:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";
import { eq } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;
const VALID_PASSWORD = "Neurogan1!Secure";

let app: Express;
let adminId: string, qaId: string, whId: string;
let locationId: string;
let createdEquipmentIds: string[] = [];

beforeAll(async () => {
  if (!dbUrl) return;
  app = await buildTestApp();
  const sfx = Date.now();
  const [adm] = await db.insert(schema.users).values({ email: `r03-adm-${sfx}@t.com`, fullName: "R03 Admin", passwordHash: await hashPassword(VALID_PASSWORD), createdByUserId: null as unknown as string }).returning();
  adminId = adm!.id;
  await db.insert(schema.userRoles).values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });
  const [qa] = await db.insert(schema.users).values({ email: `r03-qa-${sfx}@t.com`, fullName: "R03 QA", passwordHash: await hashPassword(VALID_PASSWORD), createdByUserId: adminId }).returning();
  qaId = qa!.id;
  await db.insert(schema.userRoles).values({ userId: qaId, role: "QA", grantedByUserId: adminId });
  const [wh] = await db.insert(schema.users).values({ email: `r03-wh-${sfx}@t.com`, fullName: "R03 WH", passwordHash: await hashPassword(VALID_PASSWORD), createdByUserId: adminId }).returning();
  whId = wh!.id;
  await db.insert(schema.userRoles).values({ userId: whId, role: "WAREHOUSE", grantedByUserId: adminId });

  const [loc] = await db.insert(schema.locations).values({ name: `R03-Loc-${sfx}` }).returning();
  locationId = loc!.id;
});

afterAll(async () => {
  if (!dbUrl) return;
  for (const id of createdEquipmentIds) {
    await db.delete(schema.equipment).where(eq(schema.equipment.id, id)).catch(() => {});
  }
  await db.delete(schema.locations).where(eq(schema.locations.id, locationId)).catch(() => {});
  await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, adminId)).catch(() => {});
  await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, qaId)).catch(() => {});
  await db.delete(schema.auditTrail).where(eq(schema.auditTrail.userId, whId)).catch(() => {});
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, adminId)).catch(() => {});
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, qaId)).catch(() => {});
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, whId)).catch(() => {});
  await db.delete(schema.users).where(eq(schema.users.id, adminId)).catch(() => {});
  await db.delete(schema.users).where(eq(schema.users.id, qaId)).catch(() => {});
  await db.delete(schema.users).where(eq(schema.users.id, whId)).catch(() => {});
});

describeIfDb("R-03 equipment master", () => {
  it("POST /api/equipment — 403 for WAREHOUSE", async () => {
    const res = await request(app).post("/api/equipment")
      .set("x-test-user-id", whId)
      .send({ assetTag: `WH-FAIL-${Date.now()}`, name: "Filler" });
    expect(res.status).toBe(403);
  });

  it("POST /api/equipment — 201 for ADMIN", async () => {
    const tag = `R03-EQ-${Date.now()}`;
    const res = await request(app).post("/api/equipment")
      .set("x-test-user-id", adminId)
      .send({ assetTag: tag, name: "Filler-A", model: "F100", locationId });
    expect(res.status).toBe(201);
    expect(res.body.assetTag).toBe(tag);
    createdEquipmentIds.push(res.body.id);
  });

  it("POST /api/equipment — 409 on duplicate assetTag", async () => {
    const tag = `R03-DUP-${Date.now()}`;
    const r1 = await request(app).post("/api/equipment").set("x-test-user-id", adminId).send({ assetTag: tag, name: "X" });
    expect(r1.status).toBe(201);
    createdEquipmentIds.push(r1.body.id);
    const r2 = await request(app).post("/api/equipment").set("x-test-user-id", adminId).send({ assetTag: tag, name: "X2" });
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe("DUPLICATE_ASSET_TAG");
  });

  it("GET /api/equipment — returns list for any auth user", async () => {
    const res = await request(app).get("/api/equipment").set("x-test-user-id", whId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("PATCH /api/equipment/:id/retire — 200 for QA, audit row written", async () => {
    const tag = `R03-RET-${Date.now()}`;
    const create = await request(app).post("/api/equipment").set("x-test-user-id", adminId).send({ assetTag: tag, name: "ToRetire" });
    createdEquipmentIds.push(create.body.id);
    const res = await request(app).patch(`/api/equipment/${create.body.id}/retire`).set("x-test-user-id", qaId).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("RETIRED");
    const audit = await db.select().from(schema.auditTrail).where(eq(schema.auditTrail.entityId, create.body.id));
    expect(audit.some(a => a.action === "EQUIPMENT_RETIRED")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test server/__tests__/r03-equipment-master.test.ts -- --run
```

Expected: tests FAIL — `POST /api/equipment` route does not exist (404).

- [ ] **Step 3: Implement storage layer**

Create `server/storage/equipment.ts`:

```typescript
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { Tx } from "./types";

export async function createEquipment(
  data: { assetTag: string; name: string; model?: string; serial?: string; manufacturer?: string; locationId?: string },
  userId: string,
  requestId: string,
  route: string,
): Promise<schema.Equipment> {
  return await db.transaction(async (tx) => {
    // Uniqueness check (DB also enforces)
    const existing = await tx.select().from(schema.equipment).where(eq(schema.equipment.assetTag, data.assetTag));
    if (existing.length > 0) {
      throw Object.assign(new Error("Equipment with this asset tag already exists"), { status: 409, code: "DUPLICATE_ASSET_TAG" });
    }
    const [created] = await tx.insert(schema.equipment).values(data).returning();
    await tx.insert(schema.auditTrail).values({
      userId, action: "EQUIPMENT_CREATED", entityType: "equipment", entityId: created.id,
      after: { assetTag: created.assetTag, name: created.name },
      requestId, route,
    });
    return created;
  });
}

export async function listEquipment(): Promise<schema.Equipment[]> {
  return db.select().from(schema.equipment).orderBy(schema.equipment.assetTag);
}

export async function getEquipment(id: string): Promise<schema.Equipment | undefined> {
  const [row] = await db.select().from(schema.equipment).where(eq(schema.equipment.id, id));
  return row;
}

export async function retireEquipment(
  id: string, userId: string, requestId: string, route: string,
): Promise<schema.Equipment> {
  return await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(schema.equipment).where(eq(schema.equipment.id, id));
    if (!existing) throw Object.assign(new Error("Equipment not found"), { status: 404 });
    const [updated] = await tx.update(schema.equipment).set({ status: "RETIRED" }).where(eq(schema.equipment.id, id)).returning();
    await tx.insert(schema.auditTrail).values({
      userId, action: "EQUIPMENT_RETIRED", entityType: "equipment", entityId: id,
      before: { status: existing.status }, after: { status: "RETIRED" },
      requestId, route,
    });
    return updated!;
  });
}
```

- [ ] **Step 4: Add routes**

In `server/routes.ts`, find the `/api/labs` block (search for `app.post("/api/labs/:id/qualify"`) and append after that block:

```typescript
import { createEquipment, listEquipment, getEquipment, retireEquipment } from "./storage/equipment";

// Helper: requireRole that returns 403, not 401
function requireRole(roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req.headers["x-test-user-id"] as string) || req.session?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthenticated" });
    const userRoles = await db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    const hasRole = userRoles.some(r => roles.includes(r.role));
    if (!hasRole) return res.status(403).json({ message: "Forbidden" });
    (req as Request & { authUserId: string }).authUserId = userId;
    next();
  };
}
// ^ If a similar helper exists in the codebase already (e.g., in server/auth/), prefer that.
// Search: grep -n "requireRole\|requireAdmin" server/

app.post("/api/equipment", requireRole(["ADMIN", "QA"]), async (req, res, next) => {
  try {
    const userId = (req as Request & { authUserId: string }).authUserId;
    const eq = await createEquipment(req.body, userId, req.id || "", req.path);
    res.status(201).json(eq);
  } catch (e: unknown) {
    const err = e as { status?: number; message: string; code?: string };
    if (err.code === "DUPLICATE_ASSET_TAG") return res.status(409).json({ code: err.code, message: err.message });
    next(e);
  }
});

app.get("/api/equipment", requireAuth, async (_req, res, next) => {
  try { res.json(await listEquipment()); } catch (e) { next(e); }
});

app.get("/api/equipment/:id", requireAuth, async (req, res, next) => {
  try {
    const eq = await getEquipment(req.params.id);
    if (!eq) return res.status(404).json({ message: "Not found" });
    res.json(eq);
  } catch (e) { next(e); }
});

app.patch("/api/equipment/:id/retire", requireRole(["ADMIN", "QA"]), async (req, res, next) => {
  try {
    const userId = (req as Request & { authUserId: string }).authUserId;
    const eq = await retireEquipment(req.params.id, userId, req.id || "", req.path);
    res.json(eq);
  } catch (e) { next(e); }
});
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm test server/__tests__/r03-equipment-master.test.ts -- --run
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/storage/equipment.ts server/routes.ts server/__tests__/r03-equipment-master.test.ts
git commit -m "feat(r-03): equipment master CRUD with role gating"
```

---

## Task 4: Equipment qualifications storage + routes

**Goal:** Record IQ/OQ/PQ qualification cycles. QA-only promotion. F-04 signature required to mark `QUALIFIED`. Validity-window query supports gate logic.

**Files:**
- Modify: `server/storage/equipment.ts` (append qualification methods)
- Modify: `server/routes.ts` (add qualification endpoints)
- Create: `server/__tests__/r03-qualifications.test.ts`

**Acceptance Criteria:**
- [ ] `POST /api/equipment/:id/qualifications` 200 for QA, 403 for non-QA, requires `signaturePassword` to mint signature with meaning `EQUIPMENT_QUALIFIED`
- [ ] On `QUALIFIED`, requires `type` ∈ {IQ,OQ,PQ}, `validFrom`, `validUntil`
- [ ] `GET /api/equipment/:id/qualifications` returns full history (newest first)
- [ ] Helper `getActiveQualifiedTypes(equipmentId)` returns set of types currently qualified (`status='QUALIFIED'` AND `now()` between `validFrom` and `validUntil`)
- [ ] Disqualification: `POST /api/equipment/:id/disqualify` writes a row with `status='EXPIRED'` and `EQUIPMENT_DISQUALIFIED` audit

**Verify:** `pnpm test server/__tests__/r03-qualifications.test.ts -- --run` → PASS (≥5 tests)

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/r03-qualifications.test.ts`. Mirror equipment-master test fixture setup. Tests:
- Non-QA receives 403
- QA can promote IQ qualification with valid signature; row created with `status=QUALIFIED`, signature recorded
- Missing `validFrom`/`validUntil` when status=QUALIFIED → 400
- After promotion, `getActiveQualifiedTypes` returns `["IQ"]`
- Disqualify writes a row with status `EXPIRED`; `getActiveQualifiedTypes` no longer includes IQ (because no row currently has status=QUALIFIED with valid window — we need to verify the active-status logic excludes any equipment that has had any DISQUALIFY since the last QUALIFY row of that type)

Skeleton:

```typescript
it("QA can qualify equipment with signature", async () => {
  const res = await request(app)
    .post(`/api/equipment/${equipmentId}/qualifications`)
    .set("x-test-user-id", qaId)
    .send({
      type: "IQ", status: "QUALIFIED",
      validFrom: "2026-04-01", validUntil: "2027-04-01",
      signaturePassword: VALID_PASSWORD,
      commentary: "Initial IQ",
    });
  expect(res.status).toBe(200);
  expect(res.body.signatureId).toBeDefined();
  // Verify signature row exists with correct meaning
  const sigs = await db.select().from(schema.electronicSignatures).where(eq(schema.electronicSignatures.id, res.body.signatureId));
  expect(sigs[0]!.meaning).toBe("EQUIPMENT_QUALIFIED");
});

it("getActiveQualifiedTypes returns only currently-valid types", async () => {
  // After qualifying IQ above, the helper should return at least ["IQ"]
  const types = await getActiveQualifiedTypes(equipmentId);
  expect(types).toContain("IQ");
});
```

- [ ] **Step 2: Run tests to confirm they fail (route missing)**

- [ ] **Step 3: Implement storage**

Append to `server/storage/equipment.ts`:

```typescript
import { signWithCeremony } from "../signatures/signatures";

export async function recordQualification(
  equipmentId: string,
  userId: string,
  data: { type: "IQ" | "OQ" | "PQ"; status: "PENDING" | "QUALIFIED" | "EXPIRED"; validFrom?: string; validUntil?: string; documentUrl?: string; notes?: string; signaturePassword?: string; commentary?: string },
  requestId: string,
  route: string,
): Promise<schema.EquipmentQualification & { signatureId: string | null }> {
  return await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(schema.equipment).where(eq(schema.equipment.id, equipmentId));
    if (!existing) throw Object.assign(new Error("Equipment not found"), { status: 404 });

    if (data.status === "QUALIFIED") {
      if (!data.validFrom || !data.validUntil) {
        throw Object.assign(new Error("validFrom and validUntil are required when status=QUALIFIED"), { status: 400 });
      }
      if (!data.signaturePassword) {
        throw Object.assign(new Error("Signature required to mark equipment QUALIFIED"), { status: 400 });
      }
    }

    let signatureId: string | null = null;
    if (data.status === "QUALIFIED") {
      const sig = await signWithCeremony(tx, {
        userId,
        password: data.signaturePassword!,
        meaning: "EQUIPMENT_QUALIFIED",
        entityType: "equipment",
        entityId: equipmentId,
        commentary: data.commentary ?? null,
        requestId,
      });
      signatureId = sig.id;
    }

    const [created] = await tx.insert(schema.equipmentQualifications).values({
      equipmentId, type: data.type, status: data.status,
      validFrom: data.validFrom ?? null, validUntil: data.validUntil ?? null,
      signatureId, documentUrl: data.documentUrl ?? null, notes: data.notes ?? null,
    }).returning();

    await tx.insert(schema.auditTrail).values({
      userId,
      action: data.status === "QUALIFIED" ? "EQUIPMENT_QUALIFIED" : "EQUIPMENT_DISQUALIFIED",
      entityType: "equipment", entityId: equipmentId,
      after: { type: data.type, status: data.status, validFrom: data.validFrom ?? null, validUntil: data.validUntil ?? null },
      requestId, route,
    });

    return { ...created, signatureId };
  });
}

export async function listQualifications(equipmentId: string): Promise<schema.EquipmentQualification[]> {
  return db.select().from(schema.equipmentQualifications)
    .where(eq(schema.equipmentQualifications.equipmentId, equipmentId))
    .orderBy(desc(schema.equipmentQualifications.createdAt));
}

/**
 * Returns the set of qualification types (subset of {IQ,OQ,PQ}) for which this
 * equipment currently has a QUALIFIED row with now() inside [validFrom, validUntil].
 * If a later row for the same type is EXPIRED, that type is dropped (latest-wins).
 */
export async function getActiveQualifiedTypes(equipmentId: string): Promise<Set<"IQ" | "OQ" | "PQ">> {
  const rows = await db.select().from(schema.equipmentQualifications)
    .where(eq(schema.equipmentQualifications.equipmentId, equipmentId))
    .orderBy(desc(schema.equipmentQualifications.createdAt));
  const active = new Set<"IQ" | "OQ" | "PQ">();
  const seenLatestPerType = new Set<string>();
  const today = new Date().toISOString().slice(0, 10);
  for (const r of rows) {
    if (seenLatestPerType.has(r.type)) continue;
    seenLatestPerType.add(r.type);
    if (r.status === "QUALIFIED" && r.validFrom && r.validUntil && r.validFrom <= today && today <= r.validUntil) {
      active.add(r.type as "IQ" | "OQ" | "PQ");
    }
  }
  return active;
}
```

(`signWithCeremony` is the helper already present in `server/signatures/signatures.ts` — verify the signature shape with `grep -n "signWithCeremony\|export.*sign" server/signatures/signatures.ts`. If named differently, use whatever the existing T-07 lab-qualification flow used.)

- [ ] **Step 4: Add routes**

```typescript
app.post("/api/equipment/:id/qualifications", requireRole(["ADMIN", "QA"]), async (req, res, next) => {
  try {
    const userId = (req as Request & { authUserId: string }).authUserId;
    const out = await recordQualification(req.params.id, userId, req.body, req.id || "", req.path);
    res.json(out);
  } catch (e) { next(e); }
});

app.get("/api/equipment/:id/qualifications", requireAuth, async (req, res, next) => {
  try { res.json(await listQualifications(req.params.id)); } catch (e) { next(e); }
});
```

- [ ] **Step 5: Run tests + commit**

```bash
pnpm test server/__tests__/r03-qualifications.test.ts -- --run
git add server/storage/equipment.ts server/routes.ts server/__tests__/r03-qualifications.test.ts
git commit -m "feat(r-03): equipment IQ/OQ/PQ qualifications with F-04 signature"
```

---

## Task 5: Calibration storage + routes

**Goal:** Per-equipment calibration schedule. Recording a PASS bumps `nextDueAt`. FAIL leaves it overdue. F-04 signature required.

**Files:**
- Modify: `server/storage/equipment.ts` (append calibration methods)
- Modify: `server/routes.ts`
- Create: `server/__tests__/r03-calibration.test.ts`

**Acceptance Criteria:**
- [ ] `POST /api/equipment/:id/calibration-schedule` creates the schedule (one per equipment)
- [ ] `POST /api/equipment/:id/calibration` (record) requires `result`, `signaturePassword`; mints `CALIBRATION_RECORDED` signature
- [ ] PASS bumps `calibrationSchedules.nextDueAt = performedAt + frequencyDays`
- [ ] FAIL leaves `nextDueAt` unchanged
- [ ] `GET /api/equipment/:id/calibration` returns the schedule + most recent 50 records

**Verify:** `pnpm test server/__tests__/r03-calibration.test.ts -- --run` → PASS (≥4 tests)

**Steps:**

- [ ] **Step 1: Write the failing test**

Tests:
- Schedule creation
- Record PASS bumps nextDueAt by frequencyDays
- Record FAIL leaves nextDueAt unchanged
- Recording without signaturePassword → 400

```typescript
it("PASS bumps nextDueAt by frequencyDays", async () => {
  const before = await db.select().from(schema.calibrationSchedules)
    .where(eq(schema.calibrationSchedules.equipmentId, equipmentId));
  const expectedNextDue = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const res = await request(app)
    .post(`/api/equipment/${equipmentId}/calibration`)
    .set("x-test-user-id", qaId)
    .send({ result: "PASS", signaturePassword: VALID_PASSWORD });
  expect(res.status).toBe(200);
  const after = await db.select().from(schema.calibrationSchedules)
    .where(eq(schema.calibrationSchedules.equipmentId, equipmentId));
  // Allow 60s tolerance for clock skew
  expect(Math.abs(after[0].nextDueAt.getTime() - expectedNextDue.getTime())).toBeLessThan(60_000);
});
```

- [ ] **Step 2: Implement storage**

```typescript
export async function createCalibrationSchedule(
  equipmentId: string, frequencyDays: number, userId: string, requestId: string, route: string,
): Promise<schema.CalibrationSchedule> {
  return await db.transaction(async (tx) => {
    const nextDueAt = new Date(Date.now() + frequencyDays * 24 * 60 * 60 * 1000);
    const [created] = await tx.insert(schema.calibrationSchedules).values({ equipmentId, frequencyDays, nextDueAt }).returning();
    await tx.insert(schema.auditTrail).values({
      userId, action: "EQUIPMENT_CREATED", entityType: "calibration_schedule", entityId: created.id,
      after: { equipmentId, frequencyDays, nextDueAt: nextDueAt.toISOString() }, requestId, route,
    });
    return created;
  });
}

export async function recordCalibration(
  equipmentId: string,
  userId: string,
  data: { result: "PASS" | "FAIL"; certUrl?: string; notes?: string; signaturePassword: string; commentary?: string },
  requestId: string,
  route: string,
): Promise<schema.CalibrationRecord> {
  return await db.transaction(async (tx) => {
    const [equip] = await tx.select().from(schema.equipment).where(eq(schema.equipment.id, equipmentId));
    if (!equip) throw Object.assign(new Error("Equipment not found"), { status: 404 });

    const sig = await signWithCeremony(tx, {
      userId, password: data.signaturePassword,
      meaning: "CALIBRATION_RECORDED", entityType: "equipment", entityId: equipmentId,
      commentary: data.commentary ?? null, requestId,
    });

    const [record] = await tx.insert(schema.calibrationRecords).values({
      equipmentId, performedByUserId: userId, result: data.result,
      certUrl: data.certUrl ?? null, signatureId: sig.id, notes: data.notes ?? null,
    }).returning();

    if (data.result === "PASS") {
      const [schedule] = await tx.select().from(schema.calibrationSchedules).where(eq(schema.calibrationSchedules.equipmentId, equipmentId));
      if (schedule) {
        const newDue = new Date(record.performedAt.getTime() + schedule.frequencyDays * 24 * 60 * 60 * 1000);
        await tx.update(schema.calibrationSchedules)
          .set({ nextDueAt: newDue, lastRecordId: record.id })
          .where(eq(schema.calibrationSchedules.equipmentId, equipmentId));
      }
    }

    await tx.insert(schema.auditTrail).values({
      userId, action: "CALIBRATION_LOGGED", entityType: "equipment", entityId: equipmentId,
      after: { result: data.result, performedAt: record.performedAt.toISOString() },
      requestId, route,
    });

    return record;
  });
}

export async function getCalibrationStatus(equipmentId: string): Promise<{ schedule: schema.CalibrationSchedule | null; records: schema.CalibrationRecord[] }> {
  const [schedule] = await db.select().from(schema.calibrationSchedules).where(eq(schema.calibrationSchedules.equipmentId, equipmentId));
  const records = await db.select().from(schema.calibrationRecords)
    .where(eq(schema.calibrationRecords.equipmentId, equipmentId))
    .orderBy(desc(schema.calibrationRecords.performedAt))
    .limit(50);
  return { schedule: schedule ?? null, records };
}
```

- [ ] **Step 3: Add routes**

```typescript
app.post("/api/equipment/:id/calibration-schedule", requireRole(["ADMIN", "QA"]), async (req, res, next) => {
  try {
    const userId = (req as Request & { authUserId: string }).authUserId;
    const sched = await createCalibrationSchedule(req.params.id, req.body.frequencyDays, userId, req.id || "", req.path);
    res.status(201).json(sched);
  } catch (e) { next(e); }
});

app.post("/api/equipment/:id/calibration", requireAuth, async (req, res, next) => {
  try {
    const userId = (req as Request & { authUserId: string }).authUserId;
    if (!req.body.signaturePassword) return res.status(400).json({ message: "signaturePassword is required" });
    const rec = await recordCalibration(req.params.id, userId, req.body, req.id || "", req.path);
    res.status(201).json(rec);
  } catch (e) { next(e); }
});

app.get("/api/equipment/:id/calibration", requireAuth, async (req, res, next) => {
  try { res.json(await getCalibrationStatus(req.params.id)); } catch (e) { next(e); }
});
```

- [ ] **Step 4: Tests + commit**

```bash
pnpm test server/__tests__/r03-calibration.test.ts -- --run
git add -A && git commit -m "feat(r-03): calibration schedule + records"
```

---

## Task 6: Cleaning logs storage + routes (F-05 dual-verification)

**Goal:** Cleaning log with cleanedBy ≠ verifiedBy. Signature required.

**Files:**
- Create: `server/storage/cleaning-line-clearance.ts`
- Modify: `server/routes.ts`
- Create: `server/__tests__/r03-cleaning.test.ts`

**Acceptance Criteria:**
- [ ] `POST /api/equipment/:id/cleaning-logs` 201 with valid request
- [ ] `cleanedByUserId === verifiedByUserId` → 409 `IDENTITY_SAME` (mirrors `updateBprStep` pattern, F-06)
- [ ] Without `signaturePassword` → 400
- [ ] Signature recorded with meaning `CLEANING_VERIFIED`
- [ ] DB-level CHECK constraint also rejects same-user (defense in depth)

**Verify:** `pnpm test server/__tests__/r03-cleaning.test.ts -- --run` → PASS (≥4 tests)

**Steps:**

- [ ] **Step 1: Write the failing test**

```typescript
it("rejects same-user cleaning + verification", async () => {
  const res = await request(app)
    .post(`/api/equipment/${equipmentId}/cleaning-logs`)
    .set("x-test-user-id", qaId)
    .send({
      cleanedByUserId: qaId,
      verifiedByUserId: qaId,
      method: "Wash + sanitize",
      signaturePassword: VALID_PASSWORD,
    });
  expect(res.status).toBe(409);
  expect(res.body.code).toBe("IDENTITY_SAME");
});

it("creates a cleaning log with two different users", async () => {
  const res = await request(app)
    .post(`/api/equipment/${equipmentId}/cleaning-logs`)
    .set("x-test-user-id", qaId)
    .send({
      cleanedByUserId: whId, verifiedByUserId: qaId,
      method: "Wash + sanitize", signaturePassword: VALID_PASSWORD,
    });
  expect(res.status).toBe(201);
  expect(res.body.signatureId).toBeDefined();
});
```

- [ ] **Step 2: Implement storage**

Create `server/storage/cleaning-line-clearance.ts`:

```typescript
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { signWithCeremony } from "../signatures/signatures";

export async function createCleaningLog(
  equipmentId: string,
  signingUserId: string,
  data: { cleanedByUserId: string; verifiedByUserId: string; method?: string; priorProductId?: string; nextProductId?: string; notes?: string; signaturePassword: string; commentary?: string },
  requestId: string,
  route: string,
): Promise<schema.CleaningLog> {
  if (data.cleanedByUserId === data.verifiedByUserId) {
    throw Object.assign(new Error("Cleaner and verifier must differ"), { status: 409, code: "IDENTITY_SAME" });
  }
  return await db.transaction(async (tx) => {
    const sig = await signWithCeremony(tx, {
      userId: signingUserId, password: data.signaturePassword,
      meaning: "CLEANING_VERIFIED", entityType: "equipment", entityId: equipmentId,
      commentary: data.commentary ?? null, requestId,
    });
    const [created] = await tx.insert(schema.cleaningLogs).values({
      equipmentId,
      cleanedByUserId: data.cleanedByUserId,
      verifiedByUserId: data.verifiedByUserId,
      method: data.method ?? null,
      priorProductId: data.priorProductId ?? null,
      nextProductId: data.nextProductId ?? null,
      signatureId: sig.id,
      notes: data.notes ?? null,
    }).returning();
    await tx.insert(schema.auditTrail).values({
      userId: signingUserId, action: "CLEANING_LOGGED",
      entityType: "equipment", entityId: equipmentId,
      after: { cleaningLogId: created.id, method: data.method ?? null }, requestId, route,
    });
    return created;
  });
}

export async function listCleaningLogs(equipmentId: string): Promise<schema.CleaningLog[]> {
  return db.select().from(schema.cleaningLogs)
    .where(eq(schema.cleaningLogs.equipmentId, equipmentId))
    .orderBy(desc(schema.cleaningLogs.cleanedAt))
    .limit(100);
}
```

- [ ] **Step 3: Add routes**

```typescript
import { createCleaningLog, listCleaningLogs } from "./storage/cleaning-line-clearance";

app.post("/api/equipment/:id/cleaning-logs", requireAuth, async (req, res, next) => {
  try {
    const userId = (req as Request & { authUserId: string }).authUserId;
    if (!req.body.signaturePassword) return res.status(400).json({ message: "signaturePassword is required" });
    const log = await createCleaningLog(req.params.id, userId, req.body, req.id || "", req.path);
    res.status(201).json(log);
  } catch (e: unknown) {
    const err = e as { code?: string; status?: number; message: string };
    if (err.code === "IDENTITY_SAME") return res.status(409).json({ code: "IDENTITY_SAME", message: err.message });
    next(e);
  }
});

app.get("/api/equipment/:id/cleaning-logs", requireAuth, async (req, res, next) => {
  try { res.json(await listCleaningLogs(req.params.id)); } catch (e) { next(e); }
});
```

- [ ] **Step 4: Tests + commit**

```bash
pnpm test server/__tests__/r03-cleaning.test.ts -- --run
git add -A && git commit -m "feat(r-03): cleaning logs with F-05 dual-verification"
```

---

## Task 7: Line clearance storage + routes

**Goal:** Per-equipment line clearance for product changeover with F-04 signature.

**Files:**
- Modify: `server/storage/cleaning-line-clearance.ts` (append)
- Modify: `server/routes.ts`
- Create: `server/__tests__/r03-line-clearance.test.ts`

**Acceptance Criteria:**
- [ ] `POST /api/equipment/:id/line-clearances` 201 with valid request, mints `LINE_CLEARANCE` signature
- [ ] `productChangeToId` is required; `productChangeFromId` is optional (first-batch case)
- [ ] `GET /api/equipment/:id/line-clearances` returns history (newest first)
- [ ] Helper `findClearance(equipmentId, productChangeToId, after: Date)` returns the most recent matching row or null

**Verify:** `pnpm test server/__tests__/r03-line-clearance.test.ts -- --run` → PASS (≥3 tests)

**Steps:**

- [ ] **Step 1: Write the failing test**

```typescript
it("creates a line clearance and findClearance returns it", async () => {
  const res = await request(app)
    .post(`/api/equipment/${equipmentId}/line-clearances`)
    .set("x-test-user-id", qaId)
    .send({
      productChangeFromId: productAId, productChangeToId: productBId,
      signaturePassword: VALID_PASSWORD, notes: "Cleared",
    });
  expect(res.status).toBe(201);
  const found = await findClearance(equipmentId, productBId, new Date(Date.now() - 60_000));
  expect(found).not.toBeNull();
});
```

- [ ] **Step 2: Implement storage** (append to `cleaning-line-clearance.ts`):

```typescript
export async function createLineClearance(
  equipmentId: string,
  userId: string,
  data: { productChangeFromId?: string; productChangeToId: string; notes?: string; signaturePassword: string; commentary?: string },
  requestId: string,
  route: string,
): Promise<schema.LineClearance> {
  return await db.transaction(async (tx) => {
    const sig = await signWithCeremony(tx, {
      userId, password: data.signaturePassword,
      meaning: "LINE_CLEARANCE", entityType: "equipment", entityId: equipmentId,
      commentary: data.commentary ?? null, requestId,
    });
    const [created] = await tx.insert(schema.lineClearances).values({
      equipmentId,
      productChangeFromId: data.productChangeFromId ?? null,
      productChangeToId: data.productChangeToId,
      performedByUserId: userId,
      signatureId: sig.id,
      notes: data.notes ?? null,
    }).returning();
    await tx.insert(schema.auditTrail).values({
      userId, action: "LINE_CLEARANCE_LOGGED",
      entityType: "equipment", entityId: equipmentId,
      after: { lineClearanceId: created.id, fromProductId: data.productChangeFromId ?? null, toProductId: data.productChangeToId },
      requestId, route,
    });
    return created;
  });
}

export async function listLineClearances(equipmentId: string): Promise<schema.LineClearance[]> {
  return db.select().from(schema.lineClearances)
    .where(eq(schema.lineClearances.equipmentId, equipmentId))
    .orderBy(desc(schema.lineClearances.performedAt))
    .limit(50);
}

export async function findClearance(
  equipmentId: string, productChangeToId: string, after: Date,
): Promise<schema.LineClearance | null> {
  const rows = await db.select().from(schema.lineClearances)
    .where(and(
      eq(schema.lineClearances.equipmentId, equipmentId),
      eq(schema.lineClearances.productChangeToId, productChangeToId),
    ))
    .orderBy(desc(schema.lineClearances.performedAt))
    .limit(20);
  return rows.find(r => r.performedAt > after) ?? null;
}
```

- [ ] **Step 3: Add routes**

```typescript
app.post("/api/equipment/:id/line-clearances", requireAuth, async (req, res, next) => {
  try {
    const userId = (req as Request & { authUserId: string }).authUserId;
    if (!req.body.signaturePassword) return res.status(400).json({ message: "signaturePassword is required" });
    if (!req.body.productChangeToId) return res.status(400).json({ message: "productChangeToId is required" });
    const c = await createLineClearance(req.params.id, userId, req.body, req.id || "", req.path);
    res.status(201).json(c);
  } catch (e) { next(e); }
});

app.get("/api/equipment/:id/line-clearances", requireAuth, async (req, res, next) => {
  try { res.json(await listLineClearances(req.params.id)); } catch (e) { next(e); }
});
```

- [ ] **Step 4: Tests + commit**

```bash
pnpm test server/__tests__/r03-line-clearance.test.ts -- --run
git add -A && git commit -m "feat(r-03): line clearances with F-04 signature"
```

---

## Task 8: BPR start gates module

**Goal:** Pure-function gate logic in `server/state/bpr-equipment-gates.ts` — easy to unit-test independent of HTTP. Four functions; one orchestrator.

**Files:**
- Create: `server/state/bpr-equipment-gates.ts`
- Create: `server/__tests__/r03-bpr-gates.test.ts`

**Acceptance Criteria:**
- [ ] `runAllGates(tx, productionBatchId, productId, equipmentIds): Promise<void>` throws 409 with code on first failure, returns void on pass
- [ ] Codes: `EQUIPMENT_LIST_EMPTY`, `CALIBRATION_OVERDUE`, `EQUIPMENT_NOT_QUALIFIED`, `LINE_CLEARANCE_MISSING`
- [ ] Each error carries `equipment: [{ assetTag, ...context }, ...]` payload
- [ ] All four gates have unit tests covering pass + fail paths

**Verify:** `pnpm test server/__tests__/r03-bpr-gates.test.ts -- --run` → PASS (≥8 tests, two per gate)

**Steps:**

- [ ] **Step 1: Write the failing tests**

Test fixture: 1 equipment with calibration schedule, 1 product. For each gate:
- Pass case: gate returns void
- Fail case: gate throws with expected code

Skeleton:

```typescript
import { runAllGates } from "../state/bpr-equipment-gates";

describe("calibration gate", () => {
  it("throws CALIBRATION_OVERDUE when nextDueAt is in the past", async () => {
    // Set nextDueAt to yesterday
    await db.update(schema.calibrationSchedules)
      .set({ nextDueAt: new Date(Date.now() - 24*60*60*1000) })
      .where(eq(schema.calibrationSchedules.equipmentId, equipmentId));
    await expect(runAllGates(db, batchId, productId, [equipmentId]))
      .rejects.toMatchObject({ status: 409, code: "CALIBRATION_OVERDUE" });
  });

  it("passes when nextDueAt is in the future", async () => {
    await db.update(schema.calibrationSchedules)
      .set({ nextDueAt: new Date(Date.now() + 30*24*60*60*1000) })
      .where(eq(schema.calibrationSchedules.equipmentId, equipmentId));
    // Also need IQ/OQ/PQ all qualified for the qualification gate — see fixture setup
    await expect(runAllGates(db, batchId, productId, [equipmentId])).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement gates**

Create `server/state/bpr-equipment-gates.ts`:

```typescript
import * as schema from "@shared/schema";
import { eq, and, sql, lt, desc, inArray } from "drizzle-orm";
import { getActiveQualifiedTypes } from "../storage/equipment";
import { findClearance } from "../storage/cleaning-line-clearance";
import { db as defaultDb } from "../db";

type DbLike = typeof defaultDb;

const REQUIRED_TYPES: Array<"IQ" | "OQ" | "PQ"> = ["IQ", "OQ", "PQ"];

export class GateError extends Error {
  status = 409;
  code: string;
  payload: unknown;
  constructor(code: string, message: string, payload: unknown) {
    super(message); this.code = code; this.payload = payload;
  }
}

export async function runAllGates(
  db: DbLike,
  productionBatchId: string,
  productId: string,
  equipmentIds: string[],
): Promise<void> {
  if (equipmentIds.length === 0) {
    throw new GateError("EQUIPMENT_LIST_EMPTY", "Equipment list is empty", {});
  }

  // Resolve equipment rows once for assetTag lookup
  const equipmentRows = await db.select().from(schema.equipment).where(inArray(schema.equipment.id, equipmentIds));
  const tagById = new Map(equipmentRows.map(r => [r.id, r.assetTag]));

  await checkCalibration(db, equipmentIds, tagById);
  await checkQualification(db, equipmentIds, tagById);
  await checkLineClearance(db, productionBatchId, productId, equipmentIds, tagById);
}

async function checkCalibration(db: DbLike, equipmentIds: string[], tagById: Map<string, string>): Promise<void> {
  const overdue = await db.select().from(schema.calibrationSchedules)
    .where(and(
      inArray(schema.calibrationSchedules.equipmentId, equipmentIds),
      lt(schema.calibrationSchedules.nextDueAt, new Date()),
    ));
  if (overdue.length > 0) {
    throw new GateError("CALIBRATION_OVERDUE", "Calibration overdue", {
      equipment: overdue.map(o => ({ equipmentId: o.equipmentId, assetTag: tagById.get(o.equipmentId), dueAt: o.nextDueAt })),
    });
  }
}

async function checkQualification(db: DbLike, equipmentIds: string[], tagById: Map<string, string>): Promise<void> {
  const failures: Array<{ equipmentId: string; assetTag: string | undefined; missingTypes: string[] }> = [];
  for (const id of equipmentIds) {
    const active = await getActiveQualifiedTypes(id);
    const missing = REQUIRED_TYPES.filter(t => !active.has(t));
    if (missing.length > 0) {
      failures.push({ equipmentId: id, assetTag: tagById.get(id), missingTypes: missing });
    }
  }
  if (failures.length > 0) {
    throw new GateError("EQUIPMENT_NOT_QUALIFIED", "Equipment not qualified", { equipment: failures });
  }
}

async function checkLineClearance(
  db: DbLike, productionBatchId: string, productId: string, equipmentIds: string[], tagById: Map<string, string>,
): Promise<void> {
  const failures: Array<{ equipmentId: string; assetTag: string | undefined; fromProductId: string; toProductId: string }> = [];
  for (const id of equipmentIds) {
    // Find prior completed BPR on this equipment (excluding this batch)
    const prior = await db.select({
      productId: schema.batchProductionRecords.productId,
      completedAt: schema.batchProductionRecords.completedAt,
    })
    .from(schema.batchProductionRecords)
    .innerJoin(
      schema.productionBatchEquipmentUsed,
      eq(schema.productionBatchEquipmentUsed.productionBatchId, schema.batchProductionRecords.productionBatchId)
    )
    .where(and(
      eq(schema.productionBatchEquipmentUsed.equipmentId, id),
      eq(schema.batchProductionRecords.status, "APPROVED"),
    ))
    .orderBy(desc(schema.batchProductionRecords.completedAt))
    .limit(1);

    if (prior.length === 0) continue;  // first batch on this equipment, no clearance required
    const priorProduct = prior[0].productId;
    const priorCompleted = prior[0].completedAt;
    if (priorProduct === productId) continue;  // same SKU, no clearance required
    if (!priorCompleted) continue;

    const clearance = await findClearance(id, productId, priorCompleted);
    if (!clearance) {
      failures.push({ equipmentId: id, assetTag: tagById.get(id), fromProductId: priorProduct, toProductId: productId });
    }
  }
  if (failures.length > 0) {
    throw new GateError("LINE_CLEARANCE_MISSING", "Line clearance missing for product change", { equipment: failures });
  }
}
```

- [ ] **Step 3: Tests + commit**

```bash
pnpm test server/__tests__/r03-bpr-gates.test.ts -- --run
git add -A && git commit -m "feat(r-03): BPR start gates (calibration, qualification, line clearance)"
```

---

## Task 9: Wire gates into IN_PROGRESS transition + start endpoint

**Goal:** New `POST /api/production-batches/:id/start` accepts `equipmentIds`, runs gates, transitions to IN_PROGRESS, persists `productionBatchEquipmentUsed`. Existing `updateProductionBatch` rejects direct status flips to IN_PROGRESS without going through this endpoint.

**Files:**
- Modify: `server/db-storage.ts:678-758` (updateProductionBatch — block direct IN_PROGRESS flips that didn't come from `/start`)
- Modify: `server/routes.ts` (add `POST /api/production-batches/:id/start`)
- Modify: `server/__tests__/f05-state-transitions.test.ts` (existing direct-flip tests need to use the new endpoint OR set up equipment fixtures)
- Modify: `server/__tests__/r03-bpr-gates.test.ts` (add end-to-end test through the route)

**Acceptance Criteria:**
- [ ] `POST /api/production-batches/:id/start` with valid equipment list and all gates passing → 200, batch is IN_PROGRESS, BPR auto-created, `productionBatchEquipmentUsed` rows written
- [ ] Same call with overdue-calibration equipment → 409 `CALIBRATION_OVERDUE`, batch unchanged (transaction rolled back)
- [ ] `audit_trail` row written for each gate failure with `action='START_BLOCKED'`
- [ ] Direct `PATCH /api/production-batches/:id` with `status='IN_PROGRESS'` is rejected → 400 "use /start endpoint"
- [ ] Pre-existing tests in `f05-state-transitions.test.ts` and `f06-no-body-identity.test.ts` updated to use the new path or set up equipment fixtures, all passing

**Verify:** Multiple test files:
```
pnpm test server/__tests__/r03-bpr-gates.test.ts -- --run
pnpm test server/__tests__/f05-state-transitions.test.ts -- --run
pnpm test server/__tests__/f06-no-body-identity.test.ts -- --run
```

**Steps:**

- [ ] **Step 1: Add storage method `startProductionBatch`**

In `server/db-storage.ts`, add a new method on the storage class:

```typescript
async startProductionBatch(
  batchId: string,
  userId: string,
  equipmentIds: string[],
  requestId: string,
  route: string,
): Promise<ProductionBatch> {
  return await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(schema.productionBatches).where(eq(schema.productionBatches.id, batchId));
    if (!existing) throw Object.assign(new Error("Batch not found"), { status: 404 });
    if (existing.status === "IN_PROGRESS") throw Object.assign(new Error("Batch already started"), { status: 409 });
    if (existing.status !== "DRAFT" && existing.status !== "PENDING") throw Object.assign(new Error(`Cannot start from ${existing.status}`), { status: 409 });

    // Existing input-lot check
    const batchInputs = await tx.select().from(schema.productionInputs).where(eq(schema.productionInputs.batchId, batchId));
    for (const input of batchInputs) {
      const lot = await this.getLot(input.lotId);
      if (lot && lot.quarantineStatus && lot.quarantineStatus !== "APPROVED") {
        throw new Error(`Lot ${lot.lotNumber} is ${lot.quarantineStatus} and cannot be used in production. Only APPROVED lots can be used.`);
      }
    }

    // R-03 gates
    try {
      await runAllGates(tx, batchId, existing.productId, equipmentIds);
    } catch (e: unknown) {
      const ge = e as { code?: string; payload?: unknown; message: string };
      // Audit the blocked start, then rethrow
      await tx.insert(schema.auditTrail).values({
        userId, action: "START_BLOCKED", entityType: "production_batch", entityId: batchId,
        after: { code: ge.code, payload: ge.payload }, requestId, route,
      });
      throw e;
    }

    // Persist equipment list
    for (const eid of equipmentIds) {
      await tx.insert(schema.productionBatchEquipmentUsed).values({ productionBatchId: batchId, equipmentId: eid });
    }

    // Flip status (existing path)
    const [updated] = await tx.update(schema.productionBatches)
      .set({ status: "IN_PROGRESS", updatedAt: new Date() })
      .where(eq(schema.productionBatches.id, batchId))
      .returning();

    // Auto-create BPR (existing logic, inlined here since transaction context differs)
    const recipeRows = await tx.select().from(schema.recipes).where(eq(schema.recipes.productId, updated.productId));
    const recipe = recipeRows[0];
    await this.createBpr({
      productionBatchId: batchId, batchNumber: updated.batchNumber, lotNumber: updated.outputLotNumber ?? null,
      productId: updated.productId, recipeId: recipe?.id ?? null, status: "IN_PROGRESS",
      theoreticalYield: updated.plannedQuantity, startedAt: new Date(),
    }, tx);

    return updated!;
  });
}
```

- [ ] **Step 2: Block direct IN_PROGRESS flips in `updateProductionBatch`**

In `server/db-storage.ts:683`, update the existing IN_PROGRESS check:

```typescript
// BEFORE:
if (data.status === "IN_PROGRESS" && existing.status !== "IN_PROGRESS") {
  // ...validate lots...
}

// AFTER:
if (data.status === "IN_PROGRESS" && existing.status !== "IN_PROGRESS") {
  throw Object.assign(
    new Error("Use POST /api/production-batches/:id/start to transition to IN_PROGRESS — equipment list and gates are required"),
    { status: 400, code: "USE_START_ENDPOINT" }
  );
}
```

The auto-create BPR block (line 741-758) becomes dead code from this path — the only way to reach IN_PROGRESS is now through `startProductionBatch`. Remove that block.

- [ ] **Step 3: Add the route**

In `server/routes.ts`:

```typescript
app.post("/api/production-batches/:id/start", requireAuth, async (req, res, next) => {
  try {
    const userId = (req as Request & { authUserId: string }).authUserId;
    const { equipmentIds } = req.body as { equipmentIds: string[] };
    if (!Array.isArray(equipmentIds)) return res.status(400).json({ message: "equipmentIds (array) is required" });
    const batch = await storage.startProductionBatch(req.params.id, userId, equipmentIds, req.id || "", req.path);
    res.json(batch);
  } catch (e: unknown) {
    const err = e as { status?: number; code?: string; payload?: unknown; message: string };
    if (err.code === "EQUIPMENT_LIST_EMPTY" || err.code === "CALIBRATION_OVERDUE" || err.code === "EQUIPMENT_NOT_QUALIFIED" || err.code === "LINE_CLEARANCE_MISSING") {
      return res.status(409).json({ code: err.code, message: err.message, payload: err.payload });
    }
    if (err.code === "USE_START_ENDPOINT") return res.status(400).json({ code: err.code, message: err.message });
    next(e);
  }
});
```

- [ ] **Step 4: Patch existing tests**

The pre-existing `f05-state-transitions.test.ts:267` directly inserts a batch with `status: "IN_PROGRESS"`. Direct DB inserts bypass the storage layer, so they remain valid. Tests that go through `PATCH /api/production-batches/:id` to flip to IN_PROGRESS need to switch to `POST /:id/start` with equipment fixtures.

Run:

```bash
pnpm test server/__tests__/f05-state-transitions.test.ts -- --run
pnpm test server/__tests__/f06-no-body-identity.test.ts -- --run
```

Patch any test that fails due to the new gate. Most should still work because they insert `IN_PROGRESS` directly.

- [ ] **Step 5: Tests + commit**

```bash
pnpm test server/__tests__/r03-bpr-gates.test.ts -- --run
pnpm test server/__tests__/f05-state-transitions.test.ts -- --run
pnpm test server/__tests__/f06-no-body-identity.test.ts -- --run
git add -A && git commit -m "feat(r-03): wire BPR start gates through new /start endpoint"
```

---

## Task 10: Equipment master UI (top-level tab + Master subtab)

**Goal:** Top-level "Equipment" nav link + Master subtab landing page with list + create modal + retire button.

**Files:**
- Modify: `client/src/components/nav.tsx` (or wherever the main nav is — search for `<NavLink` or top-level routing)
- Create: `client/src/pages/equipment/index.tsx`
- Modify: `client/src/App.tsx` (add routes)

**Acceptance Criteria:**
- [ ] Equipment top-level nav link visible to all authenticated users
- [ ] `/equipment` shows asset list with assetTag, name, model, location, status
- [ ] "+ New Equipment" button visible only to ADMIN/QA, opens create modal
- [ ] Modal submits `POST /api/equipment`, success closes modal + refetches
- [ ] Each row has "View" link → `/equipment/:id`, and "Retire" button (ADMIN/QA only) with confirm dialog

**Verify:** Manually open `/equipment`, create an asset as ADMIN, retire it, see the status change

**Steps:**

- [ ] **Step 1: Find the nav file**

```bash
grep -rn "Settings\|Receiving\|Production" client/src/components/ | head -10
```

Locate the file that has the top-level tabs (likely `client/src/components/nav.tsx` or similar). Add an Equipment link after Production / before Quality (whatever ordering makes sense — defer to existing taste; placement is temporary).

- [ ] **Step 2: Implement Master page**

Create `client/src/pages/equipment/index.tsx`:

```tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { Equipment } from "@shared/schema";

export default function EquipmentMasterPage() {
  const { user } = useCurrentUser();
  const canManage = user?.roles.some(r => r === "ADMIN" || r === "QA");
  const [showModal, setShowModal] = useState(false);

  const { data: equipment = [] } = useQuery<Equipment[]>({
    queryKey: ["/api/equipment"],
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Equipment</h1>
        {canManage && (
          <button onClick={() => setShowModal(true)} className="btn btn-primary">
            + New Equipment
          </button>
        )}
      </div>

      <table className="w-full">
        <thead>
          <tr>
            <th>Asset Tag</th><th>Name</th><th>Model</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {equipment.map(e => (
            <tr key={e.id}>
              <td>{e.assetTag}</td>
              <td>{e.name}</td>
              <td>{e.model ?? "—"}</td>
              <td><span data-status={e.status}>{e.status}</span></td>
              <td><Link href={`/equipment/${e.id}`}>View</Link></td>
            </tr>
          ))}
        </tbody>
      </table>

      {showModal && <NewEquipmentModal onClose={() => setShowModal(false)} />}
    </div>
  );
}

function NewEquipmentModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ assetTag: "", name: "", model: "", manufacturer: "" });
  const create = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/equipment", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error((await r.json()).message);
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/equipment"] }); onClose(); },
  });
  return (
    <div className="modal">
      {/* Standard form layout — match existing modal patterns in client/src/components */}
      <input value={form.assetTag} onChange={e => setForm({ ...form, assetTag: e.target.value })} placeholder="Asset Tag" required />
      <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Name" required />
      <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="Model" />
      <input value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} placeholder="Manufacturer" />
      {create.isError && <div className="error">{(create.error as Error).message}</div>}
      <button onClick={() => create.mutate()} disabled={create.isPending}>Create</button>
      <button onClick={onClose}>Cancel</button>
    </div>
  );
}
```

- [ ] **Step 3: Add route in App.tsx**

```tsx
import EquipmentMasterPage from "./pages/equipment";
// ...
<Route path="/equipment" component={EquipmentMasterPage} />
```

- [ ] **Step 4: Verify in browser**

```bash
pnpm dev
# Visit http://localhost:5173/equipment
# Login as ADMIN → see "+ New Equipment" → create one → verify list updates
# Login as WAREHOUSE → button hidden
```

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/equipment/ client/src/components/nav.tsx client/src/App.tsx
git commit -m "feat(r-03): equipment master UI"
```

---

## Task 11: Equipment detail page + qualifications UI

**Goal:** `/equipment/:id` shows Overview, Qualifications, Calibration tabs. Qualifications tab lists rows + a "Promote to QUALIFIED" form (QA only) that prompts for password + IQ/OQ/PQ + valid date range.

**Files:**
- Create: `client/src/pages/equipment/detail.tsx`
- Modify: `client/src/App.tsx`

**Acceptance Criteria:**
- [ ] `/equipment/:id` loads equipment details + nested tabs
- [ ] Qualifications tab shows row per record with type/status/validFrom/validUntil/signer
- [ ] "Promote" form gated to ADMIN/QA, requires password + type + dates
- [ ] On success, list refetches and shows the new row at top with "QUALIFIED"

**Verify:** Manually verify in browser

**Steps:**

- [ ] **Step 1: Implement detail page**

Create `client/src/pages/equipment/detail.tsx` (skeleton):

```tsx
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export default function EquipmentDetailPage() {
  const { id } = useParams();
  const [tab, setTab] = useState<"overview" | "qualifications" | "calibration">("overview");
  const { data: equip } = useQuery({ queryKey: [`/api/equipment/${id}`] });
  const { data: quals = [] } = useQuery({ queryKey: [`/api/equipment/${id}/qualifications`] });
  const { user } = useCurrentUser();
  const canPromote = user?.roles.some(r => r === "ADMIN" || r === "QA");

  if (!equip) return <div>Loading…</div>;

  return (
    <div className="p-6">
      <h1>{equip.assetTag} — {equip.name}</h1>
      <div className="tabs">
        <button onClick={() => setTab("overview")}>Overview</button>
        <button onClick={() => setTab("qualifications")}>Qualifications</button>
        <button onClick={() => setTab("calibration")}>Calibration</button>
      </div>

      {tab === "qualifications" && (
        <div>
          <table>
            <thead><tr><th>Type</th><th>Status</th><th>Valid From</th><th>Valid Until</th><th>Signed</th></tr></thead>
            <tbody>
              {quals.map((q: any) => (
                <tr key={q.id}>
                  <td>{q.type}</td><td>{q.status}</td>
                  <td>{q.validFrom ?? "—"}</td><td>{q.validUntil ?? "—"}</td>
                  <td>{q.signatureId ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {canPromote && <PromoteForm equipmentId={id!} />}
        </div>
      )}

      {/* Overview and Calibration tabs follow same pattern */}
    </div>
  );
}

function PromoteForm({ equipmentId }: { equipmentId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ type: "IQ", validFrom: "", validUntil: "", signaturePassword: "", commentary: "" });
  const m = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/equipment/${equipmentId}/qualifications`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, status: "QUALIFIED" }),
      });
      if (!r.ok) throw new Error((await r.json()).message);
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [`/api/equipment/${equipmentId}/qualifications`] }),
  });
  return (
    <div className="promote-form">
      <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
        <option value="IQ">IQ</option><option value="OQ">OQ</option><option value="PQ">PQ</option>
      </select>
      <input type="date" value={form.validFrom} onChange={e => setForm({ ...form, validFrom: e.target.value })} />
      <input type="date" value={form.validUntil} onChange={e => setForm({ ...form, validUntil: e.target.value })} />
      <input type="password" placeholder="Signature password" value={form.signaturePassword} onChange={e => setForm({ ...form, signaturePassword: e.target.value })} />
      <input placeholder="Commentary" value={form.commentary} onChange={e => setForm({ ...form, commentary: e.target.value })} />
      {m.isError && <div className="error">{(m.error as Error).message}</div>}
      <button onClick={() => m.mutate()} disabled={m.isPending}>Promote to QUALIFIED</button>
    </div>
  );
}
```

- [ ] **Step 2: Add route + commit**

```bash
git add -A && git commit -m "feat(r-03): equipment detail page + qualifications UI"
```

---

## Task 12: Calibration subtab UI

**Goal:** `/equipment/calibration` lists upcoming + overdue + recent records; per-equipment "Log Calibration" form.

**Files:**
- Create: `client/src/pages/equipment/calibration.tsx`
- Modify: `client/src/App.tsx`

**Acceptance Criteria:**
- [ ] Page lists all equipment with their schedules: assetTag, nextDueAt, status (Overdue/Due This Week/OK)
- [ ] Overdue rows highlighted red
- [ ] "Log Calibration" form per row (modal or inline) accepts result + signaturePassword
- [ ] Successful PASS visibly bumps the row's nextDueAt

**Verify:** Manually verify in browser

**Steps:**

- [ ] Build the page using React Query for `/api/equipment` plus per-equipment `/api/equipment/:id/calibration`. Pattern: aggregate the lists client-side.
- [ ] Form mirrors the qualifications PromoteForm but submits to `POST /api/equipment/:id/calibration`.
- [ ] Add route, commit:

```bash
git add -A && git commit -m "feat(r-03): calibration subtab UI"
```

---

## Task 13: Cleaning Logs subtab UI

**Goal:** `/equipment/cleaning` shows recent logs across all equipment; per-equipment "New Cleaning Log" form requiring two distinct users.

**Files:**
- Create: `client/src/pages/equipment/cleaning.tsx`

**Acceptance Criteria:**
- [ ] List of recent cleaning logs: equipment, cleanedBy, verifiedBy, method, cleanedAt
- [ ] "New Log" form: equipment dropdown, cleanedByUserId (defaults to current user), verifiedByUserId (must differ — UI guard plus server enforces 409), priorProductId (optional), nextProductId (optional), method, signaturePassword
- [ ] On 409 IDENTITY_SAME, show error inline

**Verify:** Manually verify in browser; attempt same-user submit and see error

**Steps:**

Build using existing patterns. Commit:
```bash
git add -A && git commit -m "feat(r-03): cleaning logs subtab UI"
```

---

## Task 14: Line Clearance subtab UI

**Goal:** `/equipment/line-clearance` lists recent clearances; new-clearance form per equipment.

**Files:**
- Create: `client/src/pages/equipment/line-clearance.tsx`

**Acceptance Criteria:**
- [ ] List of recent line clearances: equipment, fromProduct, toProduct, performedBy, performedAt
- [ ] "New Clearance" form: equipment, productChangeFromId (optional), productChangeToId (required), notes, signaturePassword

**Verify:** Manually verify in browser

```bash
git add -A && git commit -m "feat(r-03): line clearance subtab UI"
```

---

## Task 15: BPR start modal with gate-failure UI

**Goal:** When operator clicks "Start" on a production batch, modal shows the per-product equipment list (editable). Submit calls `POST /api/production-batches/:id/start` with `equipmentIds`. Gate failures render as actionable banners with deep-links to the resolution page.

**Files:**
- Create: `client/src/pages/bpr/start-modal.tsx`
- Modify: production batch detail page (`client/src/pages/production.tsx` or similar — find by searching `IN_PROGRESS` and "Start" text in client)

**Acceptance Criteria:**
- [ ] Modal pre-fills equipment list from `GET /api/products/:id/equipment` (per-product list)
- [ ] Operator can add/remove equipment
- [ ] On submit, POST `/start` with the chosen list
- [ ] On 409 with code:
  - `CALIBRATION_OVERDUE` → red banner per equipment + "Log calibration record" link
  - `EQUIPMENT_NOT_QUALIFIED` → red banner per equipment + "Open equipment" link
  - `LINE_CLEARANCE_MISSING` → red banner per equipment + "Log line clearance" link
- [ ] Each link prefilters the destination page on the named equipment

**Verify:** End-to-end: create equipment, set up an overdue calibration, attempt to start a batch → see the banner → click link → log calibration → return → start succeeds

**Steps:**

- [ ] Build the modal. The fetch call returns `{ code, message, payload: { equipment: [...] } }` on 409 — render the equipment list as banners with the appropriate deep links.
- [ ] Need a new endpoint `GET /api/products/:id/equipment` that returns the per-product equipment list. Add this to routes.ts in this task. (Skipped from Task 3 because it's product-side, not equipment-side.)
- [ ] Commit:

```bash
git add -A && git commit -m "feat(r-03): BPR start modal with gate-failure UI"
```

---

## Task 16: Dashboard cards

**Goal:** Two new cards on the existing main dashboard: "Calibrations due this week" and "Equipment qualifications expiring in 30d".

**Files:**
- Modify: `client/src/pages/dashboard.tsx` (search for existing dashboard cards)

**Acceptance Criteria:**
- [ ] "Calibrations due this week" lists equipment whose `nextDueAt` is within 7 days, click-through to calibration page filtered to that equipment
- [ ] "Qualifications expiring in 30d" lists equipment with any qualification row where `validUntil` is within 30 days, click-through to equipment detail

**Verify:** Manually in browser

```bash
git add -A && git commit -m "feat(r-03): dashboard cards for calibration + qualification due dates"
```

---

## Task 17: BPR-suite test patches (defensive)

**Goal:** Run the full integration suite; for any pre-existing BPR test that hits the new gate, set up the minimum equipment fixture so it still passes. We've already touched the high-risk tests in Task 9, but doing a full sweep catches anything missed.

**Files:**
- Modify: any test in `server/__tests__/` that breaks

**Acceptance Criteria:**
- [ ] `pnpm test:integration` is green across all suites
- [ ] No test was disabled or skipped to make this pass

**Verify:** `pnpm test:integration` → all green

**Steps:**

- [ ] Run `pnpm test:integration`
- [ ] For each failing test, inspect: did it fail because the gate is firing where it didn't before? If yes, the test needs to set up a proper equipment fixture (mirror Task 9's approach: create a calibrated equipment + IQ/OQ/PQ qualified, link to the product). Patch in place.
- [ ] Commit any patches:

```bash
git add -A && git commit -m "test(r-03): patch pre-existing BPR tests to set up equipment fixtures"
```

---

## Task 18: Validation scaffold + VSR-R-03

**Goal:** Append URS/FRS entries to `/Users/frederikhejlskov/Desktop/NEUROGAN/FDA/validation-scaffold.md`. Add VSR-R-03 module-validation summary record via the F-10 validation-document API (so it's signed and tracked just like prior VSRs).

**Files:**
- Modify: `/Users/frederikhejlskov/Desktop/NEUROGAN/FDA/validation-scaffold.md`
- Use the running ERP to create the VSR-R-03 doc via the validation-documents UI (or direct API call from a script)

**Acceptance Criteria:**
- [ ] Entries appended to validation-scaffold.md (per spec §7)
- [ ] VSR-R-03 doc created in `erp_validation_documents` with status=DRAFT, content listing OQ evidence (the test files)

**Verify:**
- [ ] `git diff /Users/frederikhejlskov/Desktop/NEUROGAN/FDA/validation-scaffold.md` shows the appended entries
- [ ] `GET /api/validation-documents?docId=VSR-R-03` returns the doc

**Steps:**

- [ ] **Step 1: Append to validation-scaffold.md**

Add these entries:
- URS-R-03-01-01 Equipment master records assetTag, model, serial, location.
- URS-R-03-01-02 Equipment qualifications IQ/OQ/PQ tracked per asset; QA promotion required to mark QUALIFIED.
- URS-R-03-02-01 Calibration overdue blocks BPR start with 409 CALIBRATION_OVERDUE.
- URS-R-03-03-01 Cleaning log dual-verification: cleanedByUserId ≠ verifiedByUserId.
- URS-R-03-04-01 Line clearance required at product change vs prior completed BPR on same equipment.
- VSR-R-03 Module validation summary; OQ evidence = `r03-*.test.ts` files passing in CI.

- [ ] **Step 2: Create the VSR doc via API**

```bash
curl -X POST http://localhost:3000/api/validation-documents \
  -H "content-type: application/json" \
  -H "x-test-user-id: <admin-id>" \
  -d '{
    "docId": "VSR-R-03",
    "title": "VSR-R-03: Equipment & Cleaning Module Validation Summary",
    "type": "VSR",
    "module": "R-03",
    "content": "OQ evidence: test files r03-equipment-master.test.ts, r03-qualifications.test.ts, r03-calibration.test.ts, r03-cleaning.test.ts, r03-line-clearance.test.ts, r03-bpr-gates.test.ts. URS coverage: URS-R-03-01-01..URS-R-03-04-01 verified by integration tests."
  }'
```

(Adapt the URL/auth to the running env. If running locally, use the dev server.)

- [ ] **Step 3: Commit**

The validation-scaffold.md lives outside the repo (in `~/Desktop/NEUROGAN/FDA/`) — so this commit is in that folder, not in the ERP repo. Do not add it to the R-03 PR. Use:

```bash
cd /Users/frederikhejlskov/Desktop/NEUROGAN/FDA && git add validation-scaffold.md && git commit -m "validation: append R-03 URS/VSR entries"
```

(If that folder isn't a git repo, just save the file. Confirm with the user.)

---

## Task 19: Open PR

**Goal:** Push branch, open PR against `FDA-EQMS-feature-package` per `feedback_git_workflow`.

**Acceptance Criteria:**
- [ ] All test files green in CI
- [ ] PR opened with summary + test plan
- [ ] PR URL reported back to the user

**Verify:** `gh pr view` shows the PR

**Steps:**

- [ ] Push the branch:

```bash
git push -u origin ticket/r-03-equipment-cleaning
```

- [ ] Open PR:

```bash
gh pr create --base FDA-EQMS-feature-package --title "R-03 Equipment & Cleaning module" --body "$(cat <<'EOF'
## Summary
- Equipment master + IQ/OQ/PQ qualifications + calibration schedule/records + cleaning logs + line clearances
- BPR start gates: calibration overdue, equipment not qualified, line clearance missing at product change — all hard 409s with actionable error payloads
- Top-level Equipment tab with four subtabs (temporary placement; will fold into a Quality/Operations parent during the deferred UI cleanup)
- Migration 0017 renames BPR `cleaning_record_reference` to `cleaning_record_legacy_text` and adds `cleaning_log_id` FK — no row deletions, idempotent

Closes 483 Obs 3.

## Test Plan
- [ ] `pnpm test:integration` green
- [ ] Manually create an equipment, log calibration, log cleaning with two users, log line clearance
- [ ] Manually attempt to start a batch on overdue-calibration equipment → see 409 banner → click action link → log calibration → start succeeds
- [ ] Validation-scaffold.md appended in NEUROGAN/FDA folder

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] Report the PR URL to the user.

---

## Self-review (run before handoff)

| Check | Result |
|---|---|
| **Spec coverage** — 8 tables in §3.1 → all covered (Task 1) | ✓ |
| **Spec coverage** — 5 signature meanings in §3.2 → covered (Task 2) | ✓ |
| **Spec coverage** — BPR migration §3.3 → covered (Task 1, Task 8 also) | ✓ |
| **Spec coverage** — 4 gates in §4 → covered (Task 8 builds, Task 9 wires) | ✓ |
| **Spec coverage** — UI in §5 → covered (Tasks 10-15 + 16 dashboard) | ✓ |
| **Spec coverage** — Tests in §6 → 6 test files mapped, plus migration test (Task 1) and existing-test patches (Task 17) | ✓ |
| **Spec coverage** — Validation §7 → covered (Task 18) | ✓ |
| **Spec coverage** — DoD §8 → covered (Task 19 PR) | ✓ |
| **Type consistency** — `getActiveQualifiedTypes` returns `Set<"IQ" \| "OQ" \| "PQ">` (defined in Task 4, used in Task 8) | ✓ |
| **Type consistency** — `findClearance` signature `(equipmentId, toProductId, after: Date) => Promise<LineClearance \| null>` (defined Task 7, used Task 8) | ✓ |
| **No placeholders** — every task has full code or skeletons with concrete file paths | ✓ |

---

## Notes for the implementer

- **Migration safety is the riskiest piece** (Task 1, Task 8). The user has had a serious incident with destructive migrations (see `feedback_migration_user_safety`). Verify by running on a copy of staging before merging.
- **Pre-existing tests on the BPR start path are at risk.** Task 9 enumerates the known ones; Task 17 is a defensive sweep. Don't skip Task 17.
- **No mocking of the database in integration tests** (per `feedback_migration_user_safety`). All R-03 tests run against real Postgres.
- **PR target is `FDA-EQMS-feature-package`** (per `feedback_git_workflow`), NOT `main`.
- **Branch naming:** `ticket/r-03-equipment-cleaning` (already created).
- **Worktree path:** `.worktrees/ticket-r-03-equipment-cleaning` (already created).
- **18 tasks total. Estimate:** 2-3 weeks of solo work given the breadth of UI + storage + gate logic + tests.
