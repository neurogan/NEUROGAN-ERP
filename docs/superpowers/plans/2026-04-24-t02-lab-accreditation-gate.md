# T-02: Lab Accreditation Hard Gate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `isActive: boolean` field on `erp_labs` with a proper `status` enum (`ACTIVE | INACTIVE | DISQUALIFIED`), and add hard gates that block COA acceptance and lot approval whenever the linked lab is not `ACTIVE`.

**Architecture:** One migration adds the `status` column and drops `is_active`. `qcReviewReceivingRecord` and `qcReviewCoa` in `server/db-storage.ts` get new guard clauses. The `LabsSettings` UI is updated to send/display `status` instead of `isActive`. No new tables required.

**Tech Stack:** Drizzle ORM + PostgreSQL, TypeScript, Vitest, React 18 + TanStack Query.

---

### Task 0: Migration + schema.ts

**Goal:** Swap `is_active` for `status` in the DB and TypeScript schema.

**Files:**
- Create: `migrations/0009_t02_lab_status.sql`
- Modify: `shared/schema.ts`

**Acceptance Criteria:**
- [ ] Migration adds `status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','DISQUALIFIED'))` to `erp_labs`
- [ ] Migration back-fills existing rows (`is_active=true` → `ACTIVE`, `is_active=false` → `INACTIVE`)
- [ ] Migration drops the `is_active` column
- [ ] `shared/schema.ts` has `labStatusEnum = z.enum(["ACTIVE","INACTIVE","DISQUALIFIED"])` and `labs.status` field; `labs.isActive` removed
- [ ] `pnpm typecheck` passes with 0 errors

**Verify:** `pnpm typecheck` → 0 errors

**Steps:**

- [ ] **Step 1: Write the migration**

Create `migrations/0009_t02_lab_status.sql`:

```sql
-- T-02: Replace is_active boolean with status enum on erp_labs
ALTER TABLE erp_labs
  ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'DISQUALIFIED'));

UPDATE erp_labs SET status = 'ACTIVE'   WHERE is_active = true;
UPDATE erp_labs SET status = 'INACTIVE' WHERE is_active = false;

ALTER TABLE erp_labs DROP COLUMN is_active;
```

- [ ] **Step 2: Register migration in `migrations/meta/_journal.json`**

Add after the existing `idx: 8` entry:

```json
{
  "idx": 9,
  "version": "7",
  "when": 1745500100000,
  "tag": "0009_t02_lab_status",
  "breakpoints": true
}
```

- [ ] **Step 3: Update shared/schema.ts**

Add the status enum and replace the `isActive` field:

```ts
export const labStatusEnum = z.enum(["ACTIVE", "INACTIVE", "DISQUALIFIED"]);
export type LabStatus = z.infer<typeof labStatusEnum>;
```

In the `labs` pgTable definition, replace:
```ts
  isActive: boolean("is_active").notNull().default(true),
```
with:
```ts
  status: text("status").notNull().$type<LabStatus>().default("ACTIVE"),
```

Update `insertLabSchema` to include status validation:
```ts
export const insertLabSchema = createInsertSchema(labs, {
  type: labTypeEnum,
  status: labStatusEnum.default("ACTIVE"),
}).omit({ id: true, createdAt: true });
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add migrations/0009_t02_lab_status.sql migrations/meta/_journal.json shared/schema.ts
git commit -m "feat(t-02): replace labs.isActive with status enum (ACTIVE/INACTIVE/DISQUALIFIED)"
```

---

### Task 1: Hard gates in db-storage.ts

**Goal:** Block `qcReviewReceivingRecord` APPROVED disposition and `qcReviewCoa` acceptance if the linked lab is not ACTIVE.

**Files:**
- Modify: `server/db-storage.ts`

**Acceptance Criteria:**
- [ ] `qcReviewReceivingRecord` throws 422 with clear message if any COA on the lot has a `labId` pointing to a non-ACTIVE lab when approving
- [ ] `qcReviewCoa` throws 422 with clear message if the COA's `labId` points to a non-ACTIVE lab when accepting
- [ ] Both gates are inside the transaction so the status check is consistent
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → 0 errors

**Steps:**

- [ ] **Step 1: Add gate to qcReviewReceivingRecord**

In `qcReviewReceivingRecord` (around line 1594), after the existing Gate 3 COA-existence check, add a lab-status check. Replace the existing Gate 3 block:

```ts
// Gate 3: require at least one COA before APPROVED
if (newStatus === "APPROVED") {
  const [coa] = await tx
    .select({ id: schema.coaDocuments.id })
    .from(schema.coaDocuments)
    .where(eq(schema.coaDocuments.lotId, existing.lotId))
    .limit(1);
  if (!coa) {
    throw Object.assign(
      new Error("Cannot approve: no COA document is linked to this lot. Attach a COA before approving."),
      { status: 422 },
    );
  }
}
```

with:

```ts
// Gate 3: require at least one COA before APPROVED; that COA's lab must be ACTIVE
if (newStatus === "APPROVED") {
  const [coa] = await tx
    .select({ id: schema.coaDocuments.id, labId: schema.coaDocuments.labId })
    .from(schema.coaDocuments)
    .where(eq(schema.coaDocuments.lotId, existing.lotId))
    .limit(1);
  if (!coa) {
    throw Object.assign(
      new Error("Cannot approve: no COA document is linked to this lot. Attach a COA before approving."),
      { status: 422 },
    );
  }
  if (coa.labId) {
    const [lab] = await tx
      .select({ status: schema.labs.status })
      .from(schema.labs)
      .where(eq(schema.labs.id, coa.labId));
    if (lab && lab.status !== "ACTIVE") {
      throw Object.assign(
        new Error(`Cannot approve: the COA is linked to a lab with status "${lab.status}". Only ACTIVE labs are accepted.`),
        { status: 422 },
      );
    }
  }
}
```

- [ ] **Step 2: Add gate to qcReviewCoa**

In `qcReviewCoa` (around line 1717), before the update, add:

```ts
// Gate: lab must be ACTIVE to accept a COA
if (accepted && existing.labId) {
  const [lab] = await tx
    .select({ status: schema.labs.status })
    .from(schema.labs)
    .where(eq(schema.labs.id, existing.labId));
  if (lab && lab.status !== "ACTIVE") {
    throw Object.assign(
      new Error(`Cannot accept COA: the linked lab has status "${lab.status}". Only ACTIVE labs are accepted.`),
      { status: 422 },
    );
  }
}
```

Add this block after fetching `existing` (line 1720) and before the `tx.update(...)` call.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add server/db-storage.ts
git commit -m "feat(t-02): block COA acceptance and lot approval for non-ACTIVE labs"
```

---

### Task 2: Tests

**Goal:** Verify both gates with automated tests.

**Files:**
- Create: `server/__tests__/t02-lab-gate.test.ts`

**Acceptance Criteria:**
- [ ] Test: qcReviewCoa with INACTIVE lab → 422
- [ ] Test: qcReviewCoa with DISQUALIFIED lab → 422
- [ ] Test: qcReviewCoa with ACTIVE lab → succeeds
- [ ] Test: qcReviewReceivingRecord APPROVED with COA from INACTIVE lab → 422
- [ ] `pnpm test` passes

**Verify:** `pnpm test` → all tests pass

**Steps:**

- [ ] **Step 1: Write the test file**

Create `server/__tests__/t02-lab-gate.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import * as schema from "../../shared/schema";
import { storage } from "../db-storage";
import { hashPassword } from "../auth/password";
import { eq } from "drizzle-orm";

let adminId: string;
let labActive: string;
let labInactive: string;
let labDisqualified: string;

beforeAll(async () => {
  const [admin] = await db.insert(schema.users).values({
    email: `t02-admin-${Date.now()}@test.com`,
    fullName: "T02 Admin",
    passwordHash: await hashPassword("Neurogan1!Secure"),
    createdByUserId: null as unknown as string,
  }).returning();
  adminId = admin!.id;
  await db.insert(schema.userRoles).values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });

  const [la] = await db.insert(schema.labs).values({ name: `ActiveLab-${Date.now()}`, type: "THIRD_PARTY", status: "ACTIVE" }).returning();
  labActive = la!.id;
  const [li] = await db.insert(schema.labs).values({ name: `InactiveLab-${Date.now()}`, type: "THIRD_PARTY", status: "INACTIVE" }).returning();
  labInactive = li!.id;
  const [ld] = await db.insert(schema.labs).values({ name: `DisqualLab-${Date.now()}`, type: "THIRD_PARTY", status: "DISQUALIFIED" }).returning();
  labDisqualified = ld!.id;
});

afterAll(async () => {
  await db.delete(schema.labs).where(eq(schema.labs.id, labActive));
  await db.delete(schema.labs).where(eq(schema.labs.id, labInactive));
  await db.delete(schema.labs).where(eq(schema.labs.id, labDisqualified));
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, adminId));
  await db.delete(schema.users).where(eq(schema.users.id, adminId));
});

async function seedLotAndCoa(labId: string) {
  const [product] = await db.select().from(schema.products).limit(1);
  if (!product) throw new Error("No product seeded");
  const [lot] = await db.insert(schema.lots).values({
    productId: product.id,
    lotNumber: `T02-LOT-${Date.now()}`,
    supplierName: "Test Supplier",
    quarantineStatus: "PENDING_QC",
  }).returning();
  const [supplier] = await db.select().from(schema.suppliers).limit(1);
  const [record] = await db.insert(schema.receivingRecords).values({
    lotId: lot!.id,
    supplierId: supplier?.id ?? null,
    uniqueIdentifier: `T02-RCV-${Date.now()}`,
    status: "PENDING_QC",
    qcWorkflowType: "FULL_LAB_TEST",
    requiresQualification: false,
    dateReceived: "2026-04-24",
    quantityReceived: "10",
    uom: "kg",
  }).returning();
  const [coa] = await db.insert(schema.coaDocuments).values({
    lotId: lot!.id,
    receivingRecordId: record!.id,
    sourceType: "THIRD_PARTY_LAB",
    labId: labId,
    overallResult: "PASS",
  }).returning();
  return { lot: lot!, record: record!, coa: coa! };
}

describe("T02 — lab accreditation gate on qcReviewCoa", () => {
  it("accepts COA when lab is ACTIVE", async () => {
    const { coa } = await seedLotAndCoa(labActive);
    const result = await storage.qcReviewCoa(coa.id, true, adminId);
    expect(result?.qcAccepted).toBe("true");
  });

  it("rejects COA when lab is INACTIVE (422)", async () => {
    const { coa } = await seedLotAndCoa(labInactive);
    await expect(storage.qcReviewCoa(coa.id, true, adminId)).rejects.toMatchObject({ status: 422 });
  });

  it("rejects COA when lab is DISQUALIFIED (422)", async () => {
    const { coa } = await seedLotAndCoa(labDisqualified);
    await expect(storage.qcReviewCoa(coa.id, true, adminId)).rejects.toMatchObject({ status: 422 });
  });
});

describe("T02 — lab accreditation gate on qcReviewReceivingRecord", () => {
  it("rejects APPROVED disposition when COA lab is INACTIVE (422)", async () => {
    const { record } = await seedLotAndCoa(labInactive);
    await expect(
      storage.qcReviewReceivingRecord(record.id, "APPROVED", adminId),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("approves when COA lab is ACTIVE", async () => {
    const { record } = await seedLotAndCoa(labActive);
    const result = await storage.qcReviewReceivingRecord(record.id, "APPROVED", adminId);
    expect(result?.status).toBe("APPROVED");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm test
```

Expected: all tests pass (new tests + existing 55).

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/t02-lab-gate.test.ts
git commit -m "test(t-02): lab accreditation gate on qcReviewCoa and qcReviewReceivingRecord"
```

---

### Task 3: UI — LabsSettings status control

**Goal:** Replace the activate/deactivate toggle with a 3-state status selector that can set ACTIVE, INACTIVE, or DISQUALIFIED.

**Files:**
- Modify: `client/src/pages/settings/LabsSettings.tsx`

**Acceptance Criteria:**
- [ ] `Lab` interface uses `status: "ACTIVE" | "INACTIVE" | "DISQUALIFIED"` (no `isActive`)
- [ ] Lab row shows a coloured status badge: ACTIVE = green, INACTIVE = muted, DISQUALIFIED = red/destructive
- [ ] A dropdown (Select) replaces the toggle button, with options: Active, Inactive, Disqualified
- [ ] Selecting a new status calls `PATCH /api/labs/:id` with `{ status: newValue }`
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → 0 errors

**Steps:**

- [ ] **Step 1: Update Lab interface and badge rendering**

Replace the interface and row rendering in `LabsSettings.tsx`:

```tsx
interface Lab {
  id: string;
  name: string;
  address: string | null;
  type: "IN_HOUSE" | "THIRD_PARTY";
  status: "ACTIVE" | "INACTIVE" | "DISQUALIFIED";
  createdAt: string;
}
```

Status badge:
```tsx
const statusBadge = (status: Lab["status"]) => {
  if (status === "ACTIVE") return <Badge className="text-[10px] bg-green-100 text-green-800 border-green-200">Active</Badge>;
  if (status === "DISQUALIFIED") return <Badge variant="destructive" className="text-[10px]">Disqualified</Badge>;
  return <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>;
};
```

- [ ] **Step 2: Replace toggle button with status Select**

Replace the `<Button>` toggle with:

```tsx
<Select
  value={lab.status}
  onValueChange={(val) =>
    patchMutation.mutate({ id: lab.id, data: { status: val as Lab["status"] } })
  }
  disabled={patchingId === lab.id}
>
  <SelectTrigger className="h-7 w-32 text-xs">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="ACTIVE">Active</SelectItem>
    <SelectItem value="INACTIVE">Inactive</SelectItem>
    <SelectItem value="DISQUALIFIED">Disqualified</SelectItem>
  </SelectContent>
</Select>
```

And add the status badge next to the lab name (in place of the old `{!lab.isActive && <Badge ...>Inactive</Badge>}`):

```tsx
{statusBadge(lab.status)}
```

- [ ] **Step 3: Update patchMutation type**

Update the mutation type signature so it no longer references `isActive`:

```tsx
const patchMutation = useMutation({
  mutationFn: ({ id, data }: { id: string; data: { status?: Lab["status"]; name?: string; address?: string | null; type?: Lab["type"] } }) => {
    setPatchingId(id);
    return apiRequest("PATCH", `/api/labs/${id}`, data);
  },
  ...
});
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/settings/LabsSettings.tsx
git commit -m "feat(t-02): replace isActive toggle with 3-state status selector in labs UI"
```

```json:metadata
{"files": ["migrations/0009_t02_lab_status.sql", "migrations/meta/_journal.json", "shared/schema.ts", "server/db-storage.ts", "server/__tests__/t02-lab-gate.test.ts", "client/src/pages/settings/LabsSettings.tsx"], "verifyCommand": "pnpm typecheck && pnpm test", "acceptanceCriteria": ["labs.status enum (ACTIVE/INACTIVE/DISQUALIFIED) replaces isActive boolean", "qcReviewCoa throws 422 for non-ACTIVE lab", "qcReviewReceivingRecord APPROVED throws 422 for non-ACTIVE lab", "pnpm typecheck passes", "pnpm test passes"]}
```
