# T-06: LAB_TECH Role + Lot Routing Fix + Structured Lab Results

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add LAB_TECH role, fix FULL_LAB_TEST task routing from QA → LAB_TECH, add lot-number existence check to receiving workflow routing, and build a structured per-analyte lab result model linked to COA documents.

**Architecture:** Three concerns in one ticket because they share the same data layer. (1) Schema: add LAB_TECH to role enum, add `erp_lab_test_results` table. (2) Routing fix: `createReceivingRecord` checks for an existing lot with the same lot number before applying category+supplier logic. (3) Task widget: FULL_LAB_TEST tasks now surface to LAB_TECH role users, not QA.

**Tech Stack:** Drizzle ORM, PostgreSQL, Express, Zod, Vitest integration tests

**483 coverage:** Obs 4 — §111.70(e), §111.75 — structured lab result capture; identity test requirement per material

---

### Task 1: LAB_TECH role + seed Artem

**Goal:** Add LAB_TECH to the role enum, seed Artem as the first lab tech user, ensure LAB_TECH can access receiving and lab result endpoints.

**Files:**
- Modify: `shared/schema.ts`
- Create: `migrations/0011_t06_lab_tech_role.sql`
- Modify: `server/seed/ids.ts`
- Modify: `server/seed/test/fixtures/users.ts`
- Modify: `server/state/transitions.ts`
- Modify: `server/routes.ts` (add LAB_TECH to receiving read endpoints)

**Acceptance Criteria:**
- [ ] `userRoleEnum` includes `"LAB_TECH"`
- [ ] Migration adds no new columns — role is a text field, enum is Zod only; migration just documents the change intent as a no-op SQL comment
- [ ] `seedIds.users.artem` exists with a stable UUID
- [ ] Artem seeded as `email: "artem@neurogan.com"`, role LAB_TECH, title "Lab Technician"
- [ ] LAB_TECH role can read receiving records and lots (GET endpoints)
- [ ] LAB_TECH cannot perform QC disposition (APPROVED/REJECTED) — that stays QA-only

**Verify:** `pnpm typecheck` passes; `pnpm lint` clean

**Steps:**

- [ ] **Step 1: Add LAB_TECH to schema**

In `shared/schema.ts`, find `userRoleEnum` and add `"LAB_TECH"`:

```typescript
export const userRoleEnum = z.enum(["ADMIN", "QA", "PRODUCTION", "WAREHOUSE", "LAB_TECH", "VIEWER"]);
export type UserRole = z.infer<typeof userRoleEnum>;
```

- [ ] **Step 2: Write migration**

`migrations/0011_t06_lab_tech_role.sql`:
```sql
-- T-06: LAB_TECH is a new application-level role.
-- erp_user_roles.role is text with no DB-level enum constraint,
-- so no column change is needed. This migration is intentionally
-- a no-op SQL comment to preserve the migration chain record.
-- §111.12(c): separation of duties — lab tech performs testing,
-- QA performs disposition. These are distinct roles.
SELECT 1; -- sentinel
```

Register in `migrations/meta/_journal.json` with idx 11.

- [ ] **Step 3: Add Artem to seed IDs**

In `server/seed/ids.ts`, add to the `users` object:
```typescript
artem: "00000000-0000-0001-0000-00000000000a",
```

- [ ] **Step 4: Seed Artem**

In `server/seed/test/fixtures/users.ts`, add to `rows`:
```typescript
{ id: seedIds.users.artem, email: "artem@neurogan.com", fullName: "Artem", title: "Lab Technician", passwordHash: artemHash, status: "ACTIVE" as const },
```

Add hash at top: `const artemHash = await hashPassword("Change_Me_Now!9");`

Add role row: `{ userId: seedIds.users.artem, role: "LAB_TECH", grantedByUserId: seedIds.users.admin }`

- [ ] **Step 5: Allow LAB_TECH to read receiving/lots in routes**

In `server/routes.ts`, find all `requireRole(["WAREHOUSE", ...])` guards on GET endpoints for receiving records and lots. Add `"LAB_TECH"` to those arrays so Artem can see what needs testing.

Do NOT add LAB_TECH to the QC disposition endpoint (`POST /api/receiving/:id/qc-review`).

- [ ] **Step 6: Commit**

```bash
git add shared/schema.ts migrations/0011_t06_lab_tech_role.sql server/seed/ids.ts server/seed/test/fixtures/users.ts server/routes.ts
git commit -m "feat(t06): add LAB_TECH role, seed Artem, grant read access to receiving"
```

---

### Task 2: Fix lot-existence routing + fix FULL_LAB_TEST → LAB_TECH task routing

**Goal:** `createReceivingRecord` checks for an existing lot with the same lot number before applying category+supplier logic. FULL_LAB_TEST tasks surface to LAB_TECH role in `GET /api/tasks`, not QA.

**Files:**
- Modify: `server/db-storage.ts`
- Create: `server/__tests__/t06-routing.test.ts`

**Acceptance Criteria:**
- [ ] Second receipt of same lot number (APPROVED lot) → workflow set to `EXEMPT`, no lab task created
- [ ] Second receipt of same lot number (lot in-progress: QUARANTINED/SAMPLING/PENDING_QC) → attaches to existing lot, no new QC task
- [ ] Second receipt of same lot number (REJECTED lot) → 422 with message "Cannot receive additional quantity for a rejected lot without QA override"
- [ ] New lot number → existing category+supplier matrix applies unchanged
- [ ] `GET /api/tasks` with LAB_TECH session → returns FULL_LAB_TEST lots (not QA session)
- [ ] `GET /api/tasks` with QA session → no longer includes FULL_LAB_TEST lots (those are LAB_TECH's)

**Verify:** `DATABASE_URL=<url> pnpm test:integration -- -t "T06"` → all tests pass

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/t06-routing.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { inArray } from "drizzle-orm";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

// seed helpers omitted for brevity — follow pattern from t02/t03 tests

describeIfDb("T06 — lot-existence routing", () => {
  it("second receipt of APPROVED lot → EXEMPT workflow", async () => {
    // seed lot + first receiving record, approve it, create second receiving record
    // expect second record's qcWorkflowType to be "EXEMPT"
  });

  it("second receipt of in-progress lot → attaches, no new task", async () => {
    // seed lot + first receiving record in PENDING_QC state
    // create second receiving record with same lot number
    // expect lotId to match first lot, qcWorkflowType to be "EXEMPT"
  });

  it("second receipt of REJECTED lot → 422", async () => {
    // seed lot + first receiving record, reject it
    // attempt to create second receiving record with same lot number
    // expect 422
  });

  it("new lot number → standard routing applies", async () => {
    // create receiving record with brand new lot number from unapproved supplier
    // expect FULL_LAB_TEST
  });
});

describeIfDb("T06 — task routing to LAB_TECH", () => {
  it("FULL_LAB_TEST lot appears in LAB_TECH task list", async () => {
    // call storage.getTasksForUser(labTechUserId)
    // expect task with FULL_LAB_TEST lot
  });

  it("FULL_LAB_TEST lot does NOT appear in QA task list", async () => {
    // call storage.getTasksForUser(qaUserId)
    // expect no FULL_LAB_TEST tasks
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
DATABASE_URL=<url> pnpm test:integration -- -t "T06"
```

- [ ] **Step 3: Add lot-existence check in createReceivingRecord**

In `server/db-storage.ts`, inside `createReceivingRecord`, before the workflow determination block, add:

```typescript
// §111.75: a lot is the unit of testing. Multiple deliveries of the same
// lot number do not trigger new testing — the lot was already tested.
if (data.lotNumber) {
  const existingLot = await db
    .select({ id: schema.lots.id, quarantineStatus: schema.lots.quarantineStatus })
    .from(schema.lots)
    .where(and(
      eq(schema.lots.lotNumber, data.lotNumber),
      eq(schema.lots.productId, data.productId),
    ))
    .limit(1)
    .then(r => r[0]);

  if (existingLot) {
    if (existingLot.quarantineStatus === "REJECTED") {
      throw Object.assign(
        new Error("Cannot receive additional quantity for a rejected lot without QA override."),
        { status: 422 }
      );
    }
    // Lot in-progress or approved — attach to existing lot, no new QC work needed
    return db.insert(schema.receivingRecords).values({
      ...recordValues,
      lotId: existingLot.id,
      qcWorkflowType: "EXEMPT",
      requiresQualification: false,
    }).returning().then(r => r[0]!);
  }
}
// No existing lot — continue with standard routing
```

- [ ] **Step 4: Fix FULL_LAB_TEST task routing**

In `db-storage.ts`, find `getTasksForUser` (or the tasks query). Change the block that routes FULL_LAB_TEST lots to QA:

```typescript
// Before (wrong):
// QA role tasks include FULL_LAB_TEST

// After (correct):
// LAB_TECH role tasks:
if (roles.includes("LAB_TECH")) {
  // Lots requiring physical sampling — §111.75(a)(1)
  const labTasks = await db.select(...)
    .from(schema.lots)
    .innerJoin(schema.receivingRecords, ...)
    .where(and(
      eq(schema.receivingRecords.qcWorkflowType, "FULL_LAB_TEST"),
      inArray(schema.lots.quarantineStatus, ["QUARANTINED", "SAMPLING"]),
    ));
  tasks.push(...labTasks.map(l => ({ type: "FULL_LAB_TEST", ...l })));
}

// QA role tasks (remove FULL_LAB_TEST from here):
if (roles.includes("QA")) {
  // PENDING_QC disposition, COA review, qualification required
  // NOT FULL_LAB_TEST — that is LAB_TECH's domain
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
DATABASE_URL=<url> pnpm test:integration -- -t "T06"
```

- [ ] **Step 6: Commit**

```bash
git add server/db-storage.ts server/__tests__/t06-routing.test.ts
git commit -m "feat(t06): lot-existence routing + route FULL_LAB_TEST tasks to LAB_TECH"
```

---

### Task 3: Per-analyte lab result model

**Goal:** Add `erp_lab_test_results` table so lab results are structured data (analyte, value, units, pass/fail) linked to a COA document, rather than PDF-only records.

**Files:**
- Modify: `shared/schema.ts`
- Create: `migrations/0012_t06_lab_test_results.sql`
- Modify: `server/db-storage.ts`
- Modify: `server/routes.ts`
- Create: `server/__tests__/t06-lab-results.test.ts`

**Acceptance Criteria:**
- [ ] `erp_lab_test_results` table exists with: id, coa_document_id (FK), analyte_name, result_value, result_units, spec_min, spec_max, pass (boolean), tested_by_user_id (FK), tested_at, notes
- [ ] `POST /api/coa/:id/results` — LAB_TECH or QA can add a result row
- [ ] `GET /api/coa/:id/results` — authenticated users can read results
- [ ] Overall `pass` on a COA document is automatically set to false if any result row has `pass = false`
- [ ] Audit trail row written on every result insert
- [ ] Integration tests: happy path (LAB_TECH adds passing result), 401, 403 (WAREHOUSE cannot add results), failing result sets COA overall to FAIL

**Verify:** `DATABASE_URL=<url> pnpm test:integration -- -t "T06 — lab results"` → all pass

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/t06-lab-results.test.ts` with the 4 cases above.

- [ ] **Step 2: Add schema**

In `shared/schema.ts`, add after `coaDocuments`:

```typescript
export const labTestResults = pgTable("erp_lab_test_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  coaDocumentId: uuid("coa_document_id").notNull().references(() => coaDocuments.id),
  analyteName: text("analyte_name").notNull(),
  resultValue: text("result_value").notNull(),
  resultUnits: text("result_units"),
  specMin: text("spec_min"),
  specMax: text("spec_max"),
  pass: boolean("pass").notNull(),
  testedByUserId: uuid("tested_by_user_id").notNull().references(() => users.id),
  testedAt: timestamp("tested_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLabTestResultSchema = createInsertSchema(labTestResults).omit({
  id: true, createdAt: true, testedAt: true, testedByUserId: true,
});
```

- [ ] **Step 3: Write migration**

`migrations/0012_t06_lab_test_results.sql`:
```sql
CREATE TABLE "erp_lab_test_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "coa_document_id" uuid NOT NULL REFERENCES "erp_coa_documents"("id"),
  "analyte_name" text NOT NULL,
  "result_value" text NOT NULL,
  "result_units" text,
  "spec_min" text,
  "spec_max" text,
  "pass" boolean NOT NULL,
  "tested_by_user_id" uuid NOT NULL REFERENCES "erp_users"("id"),
  "tested_at" timestamp with time zone NOT NULL DEFAULT now(),
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
-- §111.75: test results must be traceable to the component lot and the
-- person who performed the test. This table provides that traceability.
```

Register in `migrations/meta/_journal.json` with idx 12.

- [ ] **Step 4: Add storage methods**

In `server/db-storage.ts`, add:

```typescript
async addLabTestResult(coaId: string, data: InsertLabTestResult, userId: string) {
  const [result] = await db.insert(schema.labTestResults).values({
    ...data,
    coaDocumentId: coaId,
    testedByUserId: userId,
  }).returning();

  // If any result fails, mark the COA overall as FAIL
  if (!data.pass) {
    await db.update(schema.coaDocuments)
      .set({ overallResult: "FAIL" })
      .where(eq(schema.coaDocuments.id, coaId));
  }

  await writeAuditRow({ userId, action: "LAB_RESULT_ADDED", targetId: result!.id, ... });
  return result!;
}

async getLabTestResults(coaId: string) {
  return db.select().from(schema.labTestResults)
    .where(eq(schema.labTestResults.coaDocumentId, coaId))
    .orderBy(schema.labTestResults.testedAt);
}
```

- [ ] **Step 5: Add routes**

In `server/routes.ts`:
```typescript
// §111.75: lab result entry — LAB_TECH performs, QA can also enter
app.post("/api/coa/:id/results",
  requireAuth, requireRole(["LAB_TECH", "QA", "ADMIN"]),
  asyncHandler(async (req, res) => {
    const data = insertLabTestResultSchema.parse(req.body);
    const result = await storage.addLabTestResult(req.params.id, data, req.user!.id);
    res.status(201).json(result);
  })
);

app.get("/api/coa/:id/results",
  requireAuth,
  asyncHandler(async (req, res) => {
    const results = await storage.getLabTestResults(req.params.id);
    res.json(results);
  })
);
```

- [ ] **Step 6: Run tests**

```bash
DATABASE_URL=<url> pnpm test:integration -- -t "T06 — lab results"
```

- [ ] **Step 7: Commit**

```bash
git add shared/schema.ts migrations/0012_t06_lab_test_results.sql server/db-storage.ts server/routes.ts server/__tests__/t06-lab-results.test.ts
git commit -m "feat(t06): per-analyte lab result model linked to COA documents"
```
