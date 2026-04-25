# T-07 Lab Qualification Lifecycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce formal qualification of third-party testing labs before their COAs can be accepted in Gate 3c, with full audit trail and electronic signature per 21 CFR §111.75(h)(2) and Part 11.

**Architecture:** A new `erp_lab_qualifications` event-log table records each qualify/disqualify event. Two new `performSignature`-backed routes drive the workflow. Gate 3c in `qcReviewCoa()` is extended to reject COAs from unqualified or overdue third-party labs. `LabsSettings.tsx` is extended with qualification controls — no new page.

**Tech Stack:** PostgreSQL + Drizzle ORM, Express/TypeScript, `performSignature` + `withAudit` patterns, React 18 + shadcn/ui + React Query.

---

## File Map

| File | Change |
|---|---|
| `shared/schema.ts` | Add `labQualifications` table + types; extend `auditActionEnum` + `signatureMeaningEnum` |
| `migrations/0015_t07_lab_qualifications.sql` | Create `erp_lab_qualifications` table |
| `migrations/meta/_journal.json` | Append idx 15 entry |
| `server/storage.ts` | Add 3 new method signatures to `IStorage` + import `LabQualificationWithDetails` |
| `server/db-storage.ts` | Add `recordLabQualification`, `recordLabDisqualification`, `getLabQualificationHistory`; extend `qcReviewCoa` Gate 3c |
| `server/routes.ts` | Add `POST /api/labs/:id/qualify`, `POST /api/labs/:id/disqualify`, `GET /api/labs/:id/qualifications` |
| `server/__tests__/t07-lab-qualification.test.ts` | Integration test suite (10 tests) |
| `client/src/pages/settings/LabsSettings.tsx` | Qualification badge, Qualify/Disqualify modals, history panel |

---

### Task 1: Schema + Migration

**Goal:** Add the `erp_lab_qualifications` table to the schema and create migration 0015.

**Files:**
- Modify: `shared/schema.ts`
- Create: `migrations/0015_t07_lab_qualifications.sql`
- Modify: `migrations/meta/_journal.json`

**Acceptance Criteria:**
- [ ] `labQualifications` table defined in schema with all columns and FK refs
- [ ] `LabQualification`, `InsertLabQualification`, `LabQualificationWithDetails` types exported
- [ ] `auditActionEnum` includes `"LAB_QUALIFIED"` and `"LAB_DISQUALIFIED"`
- [ ] `signatureMeaningEnum` includes `"LAB_DISQUALIFICATION"`
- [ ] Migration SQL creates the table with correct constraints
- [ ] `_journal.json` has idx 15 entry

**Verify:** `npx tsx -e "import * as s from './shared/schema'; console.log(s.labQualifications)" 2>&1 | grep -c labQualifications` → `1`

**Steps:**

- [ ] **Step 1: Add table, types, and enum values to shared/schema.ts**

Find the closing of the `labs` type exports (around line 159) and insert after them:

```typescript
// Lab Qualifications (T-07) ─────────────────────────────────────────────────
export const labQualifications = pgTable("erp_lab_qualifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  labId: uuid("lab_id").notNull().references(() => labs.id),
  eventType: text("event_type").notNull().$type<"QUALIFIED" | "DISQUALIFIED">(),
  performedByUserId: uuid("performed_by_user_id").notNull().references(() => users.id),
  performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
  qualificationMethod: text("qualification_method"),
  requalificationFrequencyMonths: integer("requalification_frequency_months"),
  nextRequalificationDue: text("next_requalification_due"), // ISO date string "YYYY-MM-DD"
  notes: text("notes"),
});

export const insertLabQualificationSchema = createInsertSchema(labQualifications).omit({
  id: true,
  performedAt: true,
});
export type LabQualification = typeof labQualifications.$inferSelect;
export type InsertLabQualification = z.infer<typeof insertLabQualificationSchema>;
export type LabQualificationWithDetails = LabQualification & { performedByName: string };
```

- [ ] **Step 2: Extend auditActionEnum**

Find `auditActionEnum` (currently ends with `"LAB_RESULT_ADDED"`):

```typescript
export const auditActionEnum = z.enum([
  "CREATE",
  "UPDATE",
  "DELETE_BLOCKED",
  "TRANSITION",
  "SIGN",
  "LOGIN",
  "LOGIN_FAILED",
  "LOGOUT",
  "ROLE_GRANT",
  "ROLE_REVOKE",
  "PASSWORD_ROTATE",
  "LAB_RESULT_ADDED",
  "LAB_QUALIFIED",
  "LAB_DISQUALIFIED",
]);
```

- [ ] **Step 3: Extend signatureMeaningEnum**

Find `signatureMeaningEnum` (currently ends with `"LAB_APPROVAL"`):

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
]);
```

- [ ] **Step 4: Create migrations/0015_t07_lab_qualifications.sql**

```sql
-- 0015: T-07 lab qualification lifecycle.
-- Records each qualify/disqualify event for third-party labs per 21 CFR §111.75(h)(2).

CREATE TABLE "erp_lab_qualifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "lab_id" uuid NOT NULL REFERENCES "erp_labs"("id"),
  "event_type" text NOT NULL,
  "performed_by_user_id" uuid NOT NULL REFERENCES "erp_users"("id"),
  "performed_at" timestamptz NOT NULL DEFAULT now(),
  "qualification_method" text,
  "requalification_frequency_months" integer,
  "next_requalification_due" text,
  "notes" text
);
```

- [ ] **Step 5: Append idx 15 to migrations/meta/_journal.json**

Find the last entry (currently idx 14) and add after it:

```json
    {
      "idx": 15,
      "version": "7",
      "when": 1745500700000,
      "tag": "0015_t07_lab_qualifications",
      "breakpoints": true
    }
```

- [ ] **Step 6: Commit**

```bash
git add shared/schema.ts migrations/0015_t07_lab_qualifications.sql migrations/meta/_journal.json
git commit -m "feat(t07): add erp_lab_qualifications schema + migration 0015"
```

---

### Task 2: Storage layer — new methods + Gate 3c extension

**Goal:** Add `recordLabQualification`, `recordLabDisqualification`, `getLabQualificationHistory` to the storage layer and extend `qcReviewCoa` Gate 3c to enforce qualification status for third-party labs.

**Files:**
- Modify: `server/storage.ts` (lines 36, 374–376)
- Modify: `server/db-storage.ts` (imports, `qcReviewCoa`, new methods near `listLabs`)

**Acceptance Criteria:**
- [ ] `IStorage` interface declares all 3 new methods
- [ ] `recordLabQualification` inserts qualification record, sets lab status ACTIVE, emits `LAB_QUALIFIED` audit row
- [ ] `recordLabDisqualification` inserts disqualification record, sets lab status DISQUALIFIED, emits `LAB_DISQUALIFIED` audit row
- [ ] `getLabQualificationHistory` returns events newest-first, enriched with performer name
- [ ] `qcReviewCoa` Gate 3c blocks COAs from unqualified THIRD_PARTY labs with 422
- [ ] `qcReviewCoa` Gate 3c blocks COAs from overdue THIRD_PARTY labs with 422
- [ ] IN_HOUSE labs bypass qualification checks

**Verify:** (Tests run in Task 3) `npx vitest run server/__tests__/t07-lab-qualification.test.ts 2>&1 | tail -5`

**Steps:**

- [ ] **Step 1: Add LabQualificationWithDetails import to server/storage.ts**

Find the imports block (line 28 area), after `type SupplierQualificationWithDetails`:

```typescript
  type SupplierQualification, type InsertSupplierQualification, type SupplierQualificationWithDetails,
  // add after:
  type LabQualification, type InsertLabQualification, type LabQualificationWithDetails,
```

- [ ] **Step 2: Add 3 method signatures to IStorage in server/storage.ts**

Find the `// ─── Labs registry (R-01)` section (lines 373–376) and extend it:

```typescript
  // ─── Labs registry (R-01) ──────────────────────────────
  listLabs(): Promise<Lab[]>;
  createLab(data: InsertLab): Promise<Lab>;
  updateLab(id: string, data: Partial<InsertLab>): Promise<Lab | undefined>;

  // ─── Lab qualification lifecycle (T-07) ────────────────
  recordLabQualification(labId: string, userId: string, method: string, frequencyMonths: number, notes: string | undefined, requestId: string, route: string, tx: Tx): Promise<Lab>;
  recordLabDisqualification(labId: string, userId: string, notes: string | undefined, requestId: string, route: string, tx: Tx): Promise<Lab>;
  getLabQualificationHistory(labId: string): Promise<LabQualificationWithDetails[]>;
```

- [ ] **Step 3: Add LabQualification types to db-storage.ts imports**

Find the import from `@shared/schema` at the top of `server/db-storage.ts` (line 31 area), after `type Lab, type InsertLab`:

```typescript
  type Lab, type InsertLab,
  // add after:
  type LabQualification, type LabQualificationWithDetails,
```

- [ ] **Step 4: Extend qcReviewCoa Gate 3c in server/db-storage.ts**

The current Gate 3c (lines 1843–1854) checks `lab.status !== "ACTIVE"`. Extend it to also check qualification for THIRD_PARTY labs. Replace the entire gate block:

```typescript
      if (accepted && existing.labId) {
        const [lab] = await tx
          .select({ status: schema.labs.status, type: schema.labs.type, name: schema.labs.name })
          .from(schema.labs)
          .where(eq(schema.labs.id, existing.labId));
        if (lab && lab.status !== "ACTIVE") {
          throw Object.assign(
            new Error(`Cannot accept COA: the linked lab has status "${lab.status}". Only ACTIVE labs are accepted.`),
            { status: 422 },
          );
        }
        // T-07: Third-party labs must have a current qualification record.
        if (lab && lab.type === "THIRD_PARTY") {
          const [latestQual] = await tx
            .select({
              eventType: schema.labQualifications.eventType,
              nextRequalificationDue: schema.labQualifications.nextRequalificationDue,
            })
            .from(schema.labQualifications)
            .where(
              and(
                eq(schema.labQualifications.labId, existing.labId),
                eq(schema.labQualifications.eventType, "QUALIFIED"),
              ),
            )
            .orderBy(desc(schema.labQualifications.performedAt))
            .limit(1);

          if (!latestQual) {
            throw Object.assign(
              new Error(
                `Cannot accept COA: lab "${lab.name}" has not been qualified. Qualify the lab before accepting COAs.`,
              ),
              { status: 422 },
            );
          }
          const today = new Date().toISOString().slice(0, 10);
          if (latestQual.nextRequalificationDue && latestQual.nextRequalificationDue < today) {
            throw Object.assign(
              new Error(
                `Cannot accept COA: lab "${lab.name}" requalification was due ${latestQual.nextRequalificationDue}. Requalify the lab before accepting COAs.`,
              ),
              { status: 422 },
            );
          }
        }
      }
```

- [ ] **Step 5: Add recordLabQualification to DatabaseStorage in server/db-storage.ts**

Add after the `updateLab` method (around line 2423):

```typescript
  async recordLabQualification(
    labId: string,
    userId: string,
    method: string,
    frequencyMonths: number,
    notes: string | undefined,
    requestId: string,
    route: string,
    tx: Tx,
  ): Promise<schema.Lab> {
    const [lab] = await tx.select().from(schema.labs).where(eq(schema.labs.id, labId));
    if (!lab) throw Object.assign(new Error("Lab not found"), { status: 404 });
    if (lab.type !== "THIRD_PARTY") {
      throw Object.assign(new Error("Only THIRD_PARTY labs require formal qualification."), { status: 400 });
    }

    const today = new Date();
    const dueDate = new Date(today);
    dueDate.setMonth(dueDate.getMonth() + frequencyMonths);
    const nextRequalificationDue = dueDate.toISOString().slice(0, 10);

    await tx.insert(schema.labQualifications).values({
      labId,
      eventType: "QUALIFIED",
      performedByUserId: userId,
      qualificationMethod: method,
      requalificationFrequencyMonths: frequencyMonths,
      nextRequalificationDue,
      notes: notes ?? null,
    });

    const [updated] = await tx
      .update(schema.labs)
      .set({ status: "ACTIVE" })
      .where(eq(schema.labs.id, labId))
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId,
      action: "LAB_QUALIFIED",
      entityType: "lab",
      entityId: labId,
      after: { labName: lab.name, qualificationMethod: method, nextRequalificationDue, requalificationFrequencyMonths: frequencyMonths },
      requestId,
      route,
    });

    return updated!;
  }
```

- [ ] **Step 6: Add recordLabDisqualification to DatabaseStorage in server/db-storage.ts**

Add after `recordLabQualification`:

```typescript
  async recordLabDisqualification(
    labId: string,
    userId: string,
    notes: string | undefined,
    requestId: string,
    route: string,
    tx: Tx,
  ): Promise<schema.Lab> {
    const [lab] = await tx.select().from(schema.labs).where(eq(schema.labs.id, labId));
    if (!lab) throw Object.assign(new Error("Lab not found"), { status: 404 });
    if (lab.type !== "THIRD_PARTY") {
      throw Object.assign(new Error("Only THIRD_PARTY labs can be disqualified via this workflow."), { status: 400 });
    }

    await tx.insert(schema.labQualifications).values({
      labId,
      eventType: "DISQUALIFIED",
      performedByUserId: userId,
      notes: notes ?? null,
    });

    const [updated] = await tx
      .update(schema.labs)
      .set({ status: "DISQUALIFIED" })
      .where(eq(schema.labs.id, labId))
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId,
      action: "LAB_DISQUALIFIED",
      entityType: "lab",
      entityId: labId,
      after: { labName: lab.name, notes: notes ?? null },
      requestId,
      route,
    });

    return updated!;
  }
```

- [ ] **Step 7: Add getLabQualificationHistory to DatabaseStorage in server/db-storage.ts**

Add after `recordLabDisqualification`:

```typescript
  async getLabQualificationHistory(labId: string): Promise<schema.LabQualificationWithDetails[]> {
    const rows = await db
      .select({
        id: schema.labQualifications.id,
        labId: schema.labQualifications.labId,
        eventType: schema.labQualifications.eventType,
        performedByUserId: schema.labQualifications.performedByUserId,
        performedAt: schema.labQualifications.performedAt,
        qualificationMethod: schema.labQualifications.qualificationMethod,
        requalificationFrequencyMonths: schema.labQualifications.requalificationFrequencyMonths,
        nextRequalificationDue: schema.labQualifications.nextRequalificationDue,
        notes: schema.labQualifications.notes,
        performedByName: schema.users.fullName,
      })
      .from(schema.labQualifications)
      .innerJoin(schema.users, eq(schema.labQualifications.performedByUserId, schema.users.id))
      .where(eq(schema.labQualifications.labId, labId))
      .orderBy(desc(schema.labQualifications.performedAt));
    return rows;
  }
```

- [ ] **Step 8: Commit**

```bash
git add server/storage.ts server/db-storage.ts
git commit -m "feat(t07): storage — recordLabQualification/Disqualification, history, Gate 3c"
```

---

### Task 3: API routes + integration tests

**Goal:** Add 3 lab qualification API routes and a complete integration test suite that covers all 10 spec cases.

**Files:**
- Modify: `server/routes.ts`
- Create: `server/__tests__/t07-lab-qualification.test.ts`

**Acceptance Criteria:**
- [ ] `POST /api/labs/:id/qualify` returns 200 + updated lab; 400 for IN_HOUSE; 401 for bad password
- [ ] `POST /api/labs/:id/disqualify` returns 200 + updated lab with status DISQUALIFIED
- [ ] `GET /api/labs/:id/qualifications` returns history array newest-first with `performedByName`
- [ ] Gate 3c: unqualified THIRD_PARTY lab → 422 "not been qualified"
- [ ] Gate 3c: overdue THIRD_PARTY lab → 422 "overdue"
- [ ] Gate 3c: qualified current THIRD_PARTY lab → 200
- [ ] Gate 3c: IN_HOUSE lab (no qualification record) → 200
- [ ] All 10 tests pass: `npx vitest run server/__tests__/t07-lab-qualification.test.ts`

**Verify:** `npx vitest run server/__tests__/t07-lab-qualification.test.ts 2>&1 | grep -E "passed|failed"` → `10 passed`

**Steps:**

- [ ] **Step 1: Write the test file (failing — routes don't exist yet)**

Create `server/__tests__/t07-lab-qualification.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";
import { eq, and, desc } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const VALID_PASSWORD = "Neurogan1!Secure";

let app: Express;
let qaUserId: string;
let labId: string;
let inHouseLabId: string;
let coaId: string;
let lotId: string;

beforeAll(async () => {
  if (!dbUrl) return;
  app = await buildTestApp();
  const suffix = Date.now();

  const [qaUser] = await db.insert(schema.users).values({
    email: `t07-qa-${suffix}@test.com`,
    fullName: "T07 QA User",
    passwordHash: await hashPassword(VALID_PASSWORD),
    createdByUserId: null as unknown as string,
  }).returning();
  qaUserId = qaUser!.id;
  await db.insert(schema.userRoles).values({ userId: qaUserId, role: "QA", grantedByUserId: qaUserId });

  const [lab] = await db.insert(schema.labs).values({
    name: `T07-ThirdParty-${suffix}`,
    type: "THIRD_PARTY",
    status: "ACTIVE",
  }).returning();
  labId = lab!.id;

  const [ihLab] = await db.insert(schema.labs).values({
    name: `T07-InHouse-${suffix}`,
    type: "IN_HOUSE",
    status: "ACTIVE",
  }).returning();
  inHouseLabId = ihLab!.id;

  const [product] = await db.insert(schema.products).values({
    name: `T07-Product-${suffix}`,
    sku: `T07-SKU-${suffix}`,
    category: "ACTIVE_INGREDIENT",
    defaultUom: "g",
    status: "ACTIVE",
  }).returning();
  const [supplier] = await db.insert(schema.suppliers).values({ name: `T07-Supplier-${suffix}` }).returning();
  const [lot] = await db.insert(schema.lots).values({
    productId: product!.id,
    lotNumber: `T07-LOT-${suffix}`,
    supplierName: supplier!.name,
    quarantineStatus: "PENDING_QC",
  }).returning();
  lotId = lot!.id;

  const [coa] = await db.insert(schema.coaDocuments).values({
    lotId: lot!.id,
    labId: labId,
    sourceType: "THIRD_PARTY_LAB",
    overallResult: "PASS",
  }).returning();
  coaId = coa!.id;
});

afterAll(async () => {
  if (!dbUrl) return;
  await db.delete(schema.labQualifications).where(eq(schema.labQualifications.labId, labId)).catch(() => {});
  await db.delete(schema.coaDocuments).where(eq(schema.coaDocuments.id, coaId)).catch(() => {});
  await db.delete(schema.lots).where(eq(schema.lots.id, lotId)).catch(() => {});
  await db.delete(schema.labs).where(eq(schema.labs.id, labId)).catch(() => {});
  await db.delete(schema.labs).where(eq(schema.labs.id, inHouseLabId)).catch(() => {});
  await db.delete(schema.auditTrail).where(eq(schema.auditTrail.entityId, labId)).catch(() => {});
  await db.delete(schema.electronicSignatures).where(eq(schema.electronicSignatures.entityId, labId)).catch(() => {});
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, qaUserId));
  await db.delete(schema.users).where(eq(schema.users.id, qaUserId));
});

describeIfDb("T07 — lab qualification lifecycle", () => {
  it("POST /api/labs/:id/qualify — 400 for IN_HOUSE lab", async () => {
    const res = await request(app)
      .post(`/api/labs/${inHouseLabId}/qualify`)
      .set("x-test-user-id", qaUserId)
      .send({ qualificationMethod: "ACCREDITATION_REVIEW", requalificationFrequencyMonths: 24, signaturePassword: VALID_PASSWORD });
    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(/THIRD_PARTY/i);
  });

  it("POST /api/labs/:id/qualify — 401 for wrong password", async () => {
    const res = await request(app)
      .post(`/api/labs/${labId}/qualify`)
      .set("x-test-user-id", qaUserId)
      .send({ qualificationMethod: "ACCREDITATION_REVIEW", requalificationFrequencyMonths: 24, signaturePassword: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("POST /api/labs/:id/qualify — 200: creates record, sets status ACTIVE, emits LAB_QUALIFIED audit row", async () => {
    const res = await request(app)
      .post(`/api/labs/${labId}/qualify`)
      .set("x-test-user-id", qaUserId)
      .send({
        qualificationMethod: "ACCREDITATION_REVIEW",
        requalificationFrequencyMonths: 24,
        notes: "ISO 17025 verified",
        signaturePassword: VALID_PASSWORD,
      });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("ACTIVE");

    const [qual] = await db
      .select()
      .from(schema.labQualifications)
      .where(and(eq(schema.labQualifications.labId, labId), eq(schema.labQualifications.eventType, "QUALIFIED")))
      .orderBy(desc(schema.labQualifications.performedAt))
      .limit(1);
    expect(qual?.qualificationMethod).toBe("ACCREDITATION_REVIEW");
    expect(qual?.requalificationFrequencyMonths).toBe(24);
    expect(qual?.nextRequalificationDue).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const [auditRow] = await db
      .select({ action: schema.auditTrail.action })
      .from(schema.auditTrail)
      .where(and(eq(schema.auditTrail.entityId, labId), eq(schema.auditTrail.action, "LAB_QUALIFIED")))
      .limit(1);
    expect(auditRow?.action).toBe("LAB_QUALIFIED");
  });

  it("GET /api/labs/:id/qualifications — returns history array newest-first with performedByName", async () => {
    const res = await request(app)
      .get(`/api/labs/${labId}/qualifications`)
      .set("x-test-user-id", qaUserId);
    expect(res.status).toBe(200);
    const body = res.body as Array<{ eventType: string; performedByName: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]!.eventType).toBe("QUALIFIED");
    expect(body[0]!.performedByName).toBeTruthy();
  });

  it("Gate 3c: qualified, current THIRD_PARTY lab → COA QC review 200", async () => {
    const res = await request(app)
      .post(`/api/coa/${coaId}/qc-review`)
      .set("x-test-user-id", qaUserId)
      .send({ accepted: true, notes: "all good", password: VALID_PASSWORD });
    expect(res.status).toBe(200);
  });

  it("Gate 3c: unqualified THIRD_PARTY lab → 422 'not been qualified'", async () => {
    const suffix2 = Date.now();
    const [unqualLab] = await db.insert(schema.labs).values({
      name: `T07-UnqualLab-${suffix2}`,
      type: "THIRD_PARTY",
      status: "ACTIVE",
    }).returning();
    const [unqualCoa] = await db.insert(schema.coaDocuments).values({
      lotId,
      labId: unqualLab!.id,
      sourceType: "THIRD_PARTY_LAB",
      overallResult: "PASS",
    }).returning();

    const res = await request(app)
      .post(`/api/coa/${unqualCoa!.id}/qc-review`)
      .set("x-test-user-id", qaUserId)
      .send({ accepted: true, password: VALID_PASSWORD });
    expect(res.status).toBe(422);
    expect((res.body as { message: string }).message).toMatch(/not been qualified/i);

    await db.delete(schema.coaDocuments).where(eq(schema.coaDocuments.id, unqualCoa!.id));
    await db.delete(schema.labs).where(eq(schema.labs.id, unqualLab!.id));
  });

  it("Gate 3c: overdue THIRD_PARTY lab → 422 'overdue'", async () => {
    const suffix3 = Date.now();
    const [overdueLab] = await db.insert(schema.labs).values({
      name: `T07-OverdueLab-${suffix3}`,
      type: "THIRD_PARTY",
      status: "ACTIVE",
    }).returning();
    await db.insert(schema.labQualifications).values({
      labId: overdueLab!.id,
      eventType: "QUALIFIED",
      performedByUserId: qaUserId,
      qualificationMethod: "ACCREDITATION_REVIEW",
      requalificationFrequencyMonths: 24,
      nextRequalificationDue: "2020-01-01",
    });
    const [overdueCoa] = await db.insert(schema.coaDocuments).values({
      lotId,
      labId: overdueLab!.id,
      sourceType: "THIRD_PARTY_LAB",
      overallResult: "PASS",
    }).returning();

    const res = await request(app)
      .post(`/api/coa/${overdueCoa!.id}/qc-review`)
      .set("x-test-user-id", qaUserId)
      .send({ accepted: true, password: VALID_PASSWORD });
    expect(res.status).toBe(422);
    expect((res.body as { message: string }).message).toMatch(/overdue/i);

    await db.delete(schema.coaDocuments).where(eq(schema.coaDocuments.id, overdueCoa!.id));
    await db.delete(schema.labQualifications).where(eq(schema.labQualifications.labId, overdueLab!.id));
    await db.delete(schema.labs).where(eq(schema.labs.id, overdueLab!.id));
  });

  it("Gate 3c: IN_HOUSE lab with no qualification record → 200 (exempt)", async () => {
    const [ihCoa] = await db.insert(schema.coaDocuments).values({
      lotId,
      labId: inHouseLabId,
      sourceType: "INTERNAL_LAB",
      overallResult: "PASS",
    }).returning();

    const res = await request(app)
      .post(`/api/coa/${ihCoa!.id}/qc-review`)
      .set("x-test-user-id", qaUserId)
      .send({ accepted: true, password: VALID_PASSWORD });
    expect(res.status).toBe(200);

    await db.delete(schema.coaDocuments).where(eq(schema.coaDocuments.id, ihCoa!.id));
  });

  it("POST /api/labs/:id/disqualify — 200: record DISQUALIFIED, status DISQUALIFIED, audit LAB_DISQUALIFIED", async () => {
    const res = await request(app)
      .post(`/api/labs/${labId}/disqualify`)
      .set("x-test-user-id", qaUserId)
      .send({ notes: "Failed proficiency test", signaturePassword: VALID_PASSWORD });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("DISQUALIFIED");

    const [qual] = await db
      .select()
      .from(schema.labQualifications)
      .where(and(eq(schema.labQualifications.labId, labId), eq(schema.labQualifications.eventType, "DISQUALIFIED")))
      .limit(1);
    expect(qual?.eventType).toBe("DISQUALIFIED");

    const [auditRow] = await db
      .select({ action: schema.auditTrail.action })
      .from(schema.auditTrail)
      .where(and(eq(schema.auditTrail.entityId, labId), eq(schema.auditTrail.action, "LAB_DISQUALIFIED")))
      .limit(1);
    expect(auditRow?.action).toBe("LAB_DISQUALIFIED");
  });

  it("POST /api/labs/:id/qualify — requalify a disqualified lab → status ACTIVE", async () => {
    const res = await request(app)
      .post(`/api/labs/${labId}/qualify`)
      .set("x-test-user-id", qaUserId)
      .send({
        qualificationMethod: "ON_SITE_AUDIT",
        requalificationFrequencyMonths: 12,
        signaturePassword: VALID_PASSWORD,
      });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("ACTIVE");
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail with 404 (routes not yet added)**

```bash
npx vitest run server/__tests__/t07-lab-qualification.test.ts 2>&1 | grep -E "FAIL|404|passed|failed"
```

Expected: tests fail with 404 (routes missing).

- [ ] **Step 3: Add the 3 routes to server/routes.ts**

Find the existing lab routes (around line 1441, after `PATCH /api/labs/:id`) and add immediately after:

```typescript
  app.post<{ id: string }>(
    "/api/labs/:id/qualify",
    requireAuth, requireRole("QA", "ADMIN"),
    async (req, res, next) => {
      try {
        const { qualificationMethod, requalificationFrequencyMonths, notes, signaturePassword } = req.body as {
          qualificationMethod?: string;
          requalificationFrequencyMonths?: number;
          notes?: string;
          signaturePassword?: string;
        };
        if (!qualificationMethod) return res.status(400).json({ message: "qualificationMethod required" });
        if (!requalificationFrequencyMonths) return res.status(400).json({ message: "requalificationFrequencyMonths required" });
        if (!signaturePassword) return res.status(400).json({ message: "signaturePassword required for electronic signature" });

        const lab = await performSignature(
          {
            userId: req.user!.id,
            password: signaturePassword,
            meaning: "LAB_APPROVAL",
            entityType: "lab",
            entityId: req.params.id,
            commentary: notes ?? null,
            recordSnapshot: { qualificationMethod, requalificationFrequencyMonths },
            route: `${req.method} ${req.path}`,
            requestId: req.requestId,
          },
          (tx) =>
            storage.recordLabQualification(
              req.params.id,
              req.user!.id,
              qualificationMethod,
              Number(requalificationFrequencyMonths),
              notes,
              req.requestId,
              `${req.method} ${req.path}`,
              tx,
            ),
        );
        if (!lab) return res.status(404).json({ message: "Lab not found" });
        res.json(lab);
      } catch (err) {
        next(err);
      }
    },
  );

  app.post<{ id: string }>(
    "/api/labs/:id/disqualify",
    requireAuth, requireRole("QA", "ADMIN"),
    async (req, res, next) => {
      try {
        const { notes, signaturePassword } = req.body as { notes?: string; signaturePassword?: string };
        if (!signaturePassword) return res.status(400).json({ message: "signaturePassword required for electronic signature" });

        const lab = await performSignature(
          {
            userId: req.user!.id,
            password: signaturePassword,
            meaning: "LAB_DISQUALIFICATION",
            entityType: "lab",
            entityId: req.params.id,
            commentary: notes ?? null,
            recordSnapshot: { notes: notes ?? null },
            route: `${req.method} ${req.path}`,
            requestId: req.requestId,
          },
          (tx) =>
            storage.recordLabDisqualification(
              req.params.id,
              req.user!.id,
              notes,
              req.requestId,
              `${req.method} ${req.path}`,
              tx,
            ),
        );
        if (!lab) return res.status(404).json({ message: "Lab not found" });
        res.json(lab);
      } catch (err) {
        next(err);
      }
    },
  );

  app.get<{ id: string }>(
    "/api/labs/:id/qualifications",
    requireAuth,
    async (req, res, next) => {
      try {
        const history = await storage.getLabQualificationHistory(req.params.id);
        res.json(history);
      } catch (err) {
        next(err);
      }
    },
  );
```

- [ ] **Step 4: Run tests — all 10 must pass**

```bash
npx vitest run server/__tests__/t07-lab-qualification.test.ts 2>&1 | tail -10
```

Expected: `10 passed`.

- [ ] **Step 5: Commit**

```bash
git add server/routes.ts server/__tests__/t07-lab-qualification.test.ts
git commit -m "feat(t07): API routes qualify/disqualify/history + 10-case integration test suite"
```

---

### Task 4: UI — LabsSettings qualification controls

**Goal:** Extend `LabsSettings.tsx` so third-party labs show a qualification status badge, a Qualify button and Disqualify button with modal+signature, and a collapsible event history panel. IN_HOUSE labs are unchanged.

**Files:**
- Modify: `client/src/pages/settings/LabsSettings.tsx`

**Acceptance Criteria:**
- [ ] Each THIRD_PARTY lab row shows a qualification status badge: `Qualified · due YYYY-MM` (green) | `Not Qualified` (yellow) | `Overdue · since YYYY-MM` (red)
- [ ] Qualify button opens modal with method dropdown, frequency input, optional notes, password field
- [ ] Submit calls `POST /api/labs/:id/qualify` and invalidates lab list + qualification query
- [ ] Disqualify button (visible when lab is ACTIVE/qualified) opens modal with optional notes + password
- [ ] Submit calls `POST /api/labs/:id/disqualify`
- [ ] Clicking chevron on a THIRD_PARTY lab row reveals history fetched from `GET /api/labs/:id/qualifications`
- [ ] IN_HOUSE lab rows are unchanged

**Verify:** Start dev server and navigate to Settings → Labs. A THIRD_PARTY lab shows "Not Qualified" badge. Click Qualify, fill in method + frequency + password → badge updates to "Qualified · due MM/YYYY". Open history → qualification event appears.

**Steps:**

- [ ] **Step 1: Add imports to LabsSettings.tsx**

Add to the existing import list:

```typescript
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { ChevronDown, ChevronRight, ShieldCheck, ShieldOff, ShieldAlert } from "lucide-react";
```

- [ ] **Step 2: Add types**

After the existing `Lab` interface, add:

```typescript
interface QualificationEvent {
  id: string;
  labId: string;
  eventType: "QUALIFIED" | "DISQUALIFIED";
  performedByUserId: string;
  performedAt: string;
  qualificationMethod: string | null;
  requalificationFrequencyMonths: number | null;
  nextRequalificationDue: string | null; // "YYYY-MM-DD"
  notes: string | null;
  performedByName: string;
}

type QualStatus = "NOT_QUALIFIED" | "QUALIFIED" | "OVERDUE";

function getQualStatus(latest: QualificationEvent | undefined): QualStatus {
  if (!latest || latest.eventType !== "QUALIFIED") return "NOT_QUALIFIED";
  if (!latest.nextRequalificationDue) return "QUALIFIED";
  const today = new Date().toISOString().slice(0, 10);
  return latest.nextRequalificationDue < today ? "OVERDUE" : "QUALIFIED";
}

function QualBadge({ status, nextDue }: { status: QualStatus; nextDue?: string | null }) {
  if (status === "QUALIFIED") {
    const due = nextDue ? nextDue.slice(0, 7) : null; // "YYYY-MM"
    return (
      <Badge className="text-[10px] bg-green-100 text-green-800 border-green-200">
        <ShieldCheck className="h-2.5 w-2.5 mr-1" />
        {due ? `Qualified · due ${due}` : "Qualified"}
      </Badge>
    );
  }
  if (status === "OVERDUE") {
    return (
      <Badge variant="destructive" className="text-[10px]">
        <ShieldAlert className="h-2.5 w-2.5 mr-1" />
        Overdue
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] text-yellow-700 border-yellow-300 bg-yellow-50">
      <ShieldOff className="h-2.5 w-2.5 mr-1" />
      Not Qualified
    </Badge>
  );
}
```

- [ ] **Step 3: Replace the LabsSettings component body**

Replace the full `export function LabsSettings()` component with the following — this preserves all existing create/patch functionality and adds the qualification UI for THIRD_PARTY labs:

```typescript
export function LabsSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: labs = [], isLoading, isError } = useQuery<Lab[]>({ queryKey: ["/api/labs"] });

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [type, setType] = useState<"IN_HOUSE" | "THIRD_PARTY">("THIRD_PARTY");
  const [patchingId, setPatchingId] = useState<string | null>(null);

  // Qualify modal state
  const [qualifyLabId, setQualifyLabId] = useState<string | null>(null);
  const [qualMethod, setQualMethod] = useState("ACCREDITATION_REVIEW");
  const [qualFrequency, setQualFrequency] = useState("24");
  const [qualNotes, setQualNotes] = useState("");
  const [qualPassword, setQualPassword] = useState("");

  // Disqualify modal state
  const [disqualifyLabId, setDisqualifyLabId] = useState<string | null>(null);
  const [disqualNotes, setDisqualNotes] = useState("");
  const [disqualPassword, setDisqualPassword] = useState("");

  // History expansion
  const [expandedLabId, setExpandedLabId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: { name: string; address: string | null; type: string }) =>
      apiRequest("POST", "/api/labs", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/labs"] });
      setName(""); setAddress(""); setType("THIRD_PARTY");
      toast({ title: "Lab added" });
    },
    onError: (err: Error) => toast({ title: "Failed to add lab", description: err.message, variant: "destructive" }),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Lab> }) =>
      apiRequest("PATCH", `/api/labs/${id}`, data),
    onMutate: ({ id }) => { setPatchingId(id); },
    onSettled: () => setPatchingId(null),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/labs"] }); toast({ title: "Lab updated" }); },
    onError: (err: Error) => toast({ title: "Failed to update lab", description: err.message, variant: "destructive" }),
  });

  const qualifyMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      apiRequest("POST", `/api/labs/${id}/qualify`, body).then((r) => r.json()),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["/api/labs"] });
      qc.invalidateQueries({ queryKey: [`/api/labs/${id}/qualifications`] });
      setQualifyLabId(null);
      setQualPassword(""); setQualNotes("");
      toast({ title: "Lab qualified" });
    },
    onError: (err: Error) => toast({ title: "Qualification failed", description: err.message, variant: "destructive" }),
  });

  const disqualifyMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      apiRequest("POST", `/api/labs/${id}/disqualify`, body).then((r) => r.json()),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["/api/labs"] });
      qc.invalidateQueries({ queryKey: [`/api/labs/${id}/qualifications`] });
      setDisqualifyLabId(null);
      setDisqualPassword(""); setDisqualNotes("");
      toast({ title: "Lab disqualified" });
    },
    onError: (err: Error) => toast({ title: "Disqualification failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (isError) return <div className="p-6 text-sm text-destructive">Could not load labs. Refresh to try again.</div>;

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1">Testing Labs</h2>
        <p className="text-sm text-muted-foreground">
          Approved labs for COA testing. Third-party labs must be qualified before their COAs can be accepted (21 CFR §111.75(h)(2)).
        </p>
      </div>

      <div className="border rounded-lg overflow-hidden">
        {labs.map((lab) => (
          <LabRow
            key={lab.id}
            lab={lab}
            patchingId={patchingId}
            expandedLabId={expandedLabId}
            onToggleExpand={() => setExpandedLabId(expandedLabId === lab.id ? null : lab.id)}
            onPatch={(data) => patchMutation.mutate({ id: lab.id, data })}
            onQualify={() => setQualifyLabId(lab.id)}
            onDisqualify={() => setDisqualifyLabId(lab.id)}
          />
        ))}
        {labs.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground text-center">No labs configured.</div>
        )}
      </div>

      {/* Qualify modal */}
      <Dialog open={qualifyLabId !== null} onOpenChange={(o) => { if (!o) { setQualifyLabId(null); setQualPassword(""); setQualNotes(""); } }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Qualify lab</DialogTitle>
            <DialogDescription className="text-xs">
              Records a formal qualification event per 21 CFR §111.75(h)(2). Your password is required as an electronic signature.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Qualification method</Label>
              <Select value={qualMethod} onValueChange={setQualMethod}>
                <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACCREDITATION_REVIEW">Accreditation review</SelectItem>
                  <SelectItem value="SPLIT_SAMPLE_COMPARISON">Split-sample comparison</SelectItem>
                  <SelectItem value="ON_SITE_AUDIT">On-site audit</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Requalification frequency (months)</Label>
              <Input
                type="number"
                min={1}
                value={qualFrequency}
                onChange={(e) => setQualFrequency(e.target.value)}
                className="mt-1 h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Input value={qualNotes} onChange={(e) => setQualNotes(e.target.value)} className="mt-1 h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Your password (e-signature)</Label>
              <Input
                type="password"
                value={qualPassword}
                onChange={(e) => setQualPassword(e.target.value)}
                className="mt-1 h-8 text-sm"
                autoComplete="current-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQualifyLabId(null)} disabled={qualifyMutation.isPending}>Cancel</Button>
            <Button
              onClick={() => qualifyLabId && qualifyMutation.mutate({
                id: qualifyLabId,
                body: {
                  qualificationMethod: qualMethod,
                  requalificationFrequencyMonths: Number(qualFrequency),
                  notes: qualNotes || undefined,
                  signaturePassword: qualPassword,
                },
              })}
              disabled={!qualPassword || !qualFrequency || qualifyMutation.isPending}
            >
              {qualifyMutation.isPending ? "Qualifying…" : "Qualify lab"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disqualify modal */}
      <Dialog open={disqualifyLabId !== null} onOpenChange={(o) => { if (!o) { setDisqualifyLabId(null); setDisqualPassword(""); setDisqualNotes(""); } }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Disqualify lab</DialogTitle>
            <DialogDescription className="text-xs">
              The lab will be marked DISQUALIFIED. Future COAs from this lab will be blocked at Gate 3c until the lab is requalified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Reason / notes (optional)</Label>
              <Input value={disqualNotes} onChange={(e) => setDisqualNotes(e.target.value)} className="mt-1 h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Your password (e-signature)</Label>
              <Input
                type="password"
                value={disqualPassword}
                onChange={(e) => setDisqualPassword(e.target.value)}
                className="mt-1 h-8 text-sm"
                autoComplete="current-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisqualifyLabId(null)} disabled={disqualifyMutation.isPending}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => disqualifyLabId && disqualifyMutation.mutate({
                id: disqualifyLabId,
                body: { notes: disqualNotes || undefined, signaturePassword: disqualPassword },
              })}
              disabled={!disqualPassword || disqualifyMutation.isPending}
            >
              {disqualifyMutation.isPending ? "Disqualifying…" : "Disqualify lab"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add lab form */}
      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium">Add lab</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label htmlFor="lab-name" className="text-xs">Name</Label>
            <Input id="lab-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lab name" className="mt-1 h-8 text-sm" />
          </div>
          <div className="col-span-2">
            <Label htmlFor="lab-address" className="text-xs">Address</Label>
            <Input id="lab-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" className="mt-1 h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as "IN_HOUSE" | "THIRD_PARTY")}>
              <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="IN_HOUSE">In-House</SelectItem>
                <SelectItem value="THIRD_PARTY">Third Party</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => createMutation.mutate({ name: name.trim(), address: address.trim() || null, type })}
          disabled={!name.trim() || createMutation.isPending}
        >
          Add lab
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the LabRow sub-component after the LabsSettings function**

```typescript
function LabRow({
  lab,
  patchingId,
  expandedLabId,
  onToggleExpand,
  onPatch,
  onQualify,
  onDisqualify,
}: {
  lab: Lab;
  patchingId: string | null;
  expandedLabId: string | null;
  onToggleExpand: () => void;
  onPatch: (data: Partial<Lab>) => void;
  onQualify: () => void;
  onDisqualify: () => void;
}) {
  const isExpanded = expandedLabId === lab.id;
  const isThirdParty = lab.type === "THIRD_PARTY";

  const { data: quals } = useQuery<QualificationEvent[]>({
    queryKey: [`/api/labs/${lab.id}/qualifications`],
    enabled: isThirdParty,
    queryFn: () => apiRequest("GET", `/api/labs/${lab.id}/qualifications`).then((r) => r.json()),
  });

  const latestQual = quals?.[0];
  const qualStatus = isThirdParty ? getQualStatus(latestQual) : null;

  const statusBadge = (status: Lab["status"]) => {
    if (status === "ACTIVE") return <Badge className="text-[10px] bg-green-100 text-green-800 border-green-200">Active</Badge>;
    if (status === "DISQUALIFIED") return <Badge variant="destructive" className="text-[10px]">Disqualified</Badge>;
    return <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>;
  };

  return (
    <div className="border-b last:border-b-0">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
            {lab.name}
            <Badge variant={lab.type === "IN_HOUSE" ? "default" : "secondary"} className="text-[10px]">
              {lab.type === "IN_HOUSE" ? "In-House" : "Third Party"}
            </Badge>
            {statusBadge(lab.status)}
            {isThirdParty && qualStatus && (
              <QualBadge status={qualStatus} nextDue={latestQual?.nextRequalificationDue} />
            )}
          </div>
          {lab.address && <div className="text-xs text-muted-foreground mt-0.5">{lab.address}</div>}
        </div>

        <div className="flex items-center gap-2 ml-4 shrink-0">
          {isThirdParty && (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onQualify}>
                Qualify
              </Button>
              {lab.status === "ACTIVE" && (
                <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" onClick={onDisqualify}>
                  Disqualify
                </Button>
              )}
            </>
          )}
          {!isThirdParty && (
            <Select
              value={lab.status}
              onValueChange={(val) => onPatch({ status: val as Lab["status"] })}
              disabled={patchingId === lab.id}
            >
              <SelectTrigger className="h-7 w-32 text-xs">{statusBadge(lab.status)}</SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
                <SelectItem value="DISQUALIFIED">Disqualified</SelectItem>
              </SelectContent>
            </Select>
          )}
          {isThirdParty && (
            <button
              onClick={onToggleExpand}
              className="p-1 text-muted-foreground hover:text-foreground"
              aria-label="Toggle qualification history"
            >
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {isExpanded && isThirdParty && (
        <div className="px-4 pb-3 bg-muted/30 border-t">
          <p className="text-xs font-medium text-muted-foreground mt-2 mb-1">Qualification history</p>
          {!quals || quals.length === 0 ? (
            <p className="text-xs text-muted-foreground">No qualification events recorded.</p>
          ) : (
            <div className="space-y-1">
              {quals.map((ev) => (
                <div key={ev.id} className="flex items-start gap-3 text-xs py-1 border-b last:border-0">
                  <Badge
                    variant={ev.eventType === "QUALIFIED" ? "default" : "destructive"}
                    className="text-[10px] mt-0.5 shrink-0"
                  >
                    {ev.eventType === "QUALIFIED" ? "Qualified" : "Disqualified"}
                  </Badge>
                  <div>
                    <span className="font-medium">{ev.performedByName}</span>
                    {" · "}
                    {new Date(ev.performedAt).toLocaleDateString()}
                    {ev.qualificationMethod && (
                      <span className="text-muted-foreground"> · {ev.qualificationMethod.replace(/_/g, " ").toLowerCase()}</span>
                    )}
                    {ev.nextRequalificationDue && (
                      <span className="text-muted-foreground"> · next due {ev.nextRequalificationDue.slice(0, 7)}</span>
                    )}
                    {ev.notes && <div className="text-muted-foreground mt-0.5">{ev.notes}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/settings/LabsSettings.tsx
git commit -m "feat(t07): LabsSettings — qualification badge, qualify/disqualify modals, history panel"
```

---

## Self-Review Notes

- **Spec coverage:** All 10 spec test cases are implemented. Gate 3c covers unqualified, overdue, qualified, and IN_HOUSE. Signature meanings `LAB_APPROVAL` / `LAB_DISQUALIFICATION` both wired. Audit actions `LAB_QUALIFIED` / `LAB_DISQUALIFIED` both emitted.
- **Type consistency:** `LabQualificationWithDetails` defined in schema, imported in storage.ts, returned by `getLabQualificationHistory`, typed in UI as `QualificationEvent`. `QualificationEvent` interface in UI matches the API response shape.
- **No placeholders:** All code steps show complete implementations.
- **Migration number:** 0015 follows correctly from the merged 0014.
