# T-03: Identity Test Enforcement in Gate 3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block lot approval whenever the QC workflow requires identity testing (`FULL_LAB_TEST` or `IDENTITY_CHECK`) but no COA on the lot has `identityConfirmed = "true"`. 21 CFR 111.75(a)(1)(ii) requires identity verification for every lot of dietary ingredient.

**Architecture:** Pure gate logic change in `qcReviewReceivingRecord` in `server/db-storage.ts`. No schema changes — `coaDocuments.identityConfirmed` (text "true"/"false") already exists. The gate runs after the existing COA-presence and lab-status checks (both added by T-02). Tests are added to `server/__tests__/`.

**Tech Stack:** Drizzle ORM + PostgreSQL, TypeScript, Vitest.

---

### Task 0: Gate logic in qcReviewReceivingRecord

**Goal:** After Gate 3's lab-status check, add a Gate 3b that requires identity confirmation for identity-mandatory workflows.

**Files:**
- Modify: `server/db-storage.ts`

**Acceptance Criteria:**
- [ ] Workflows `FULL_LAB_TEST` and `IDENTITY_CHECK` are blocked at APPROVED if no COA on the lot has `identityConfirmed = "true"`
- [ ] Workflows `COA_REVIEW`, `EXEMPT`, and `null` are NOT blocked by this gate
- [ ] Error message is user-facing and actionable
- [ ] Gate runs inside the transaction (uses `tx`, not `db`)
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → 0 errors

**Steps:**

- [ ] **Step 1: Add the gate to qcReviewReceivingRecord**

After the existing COA + lab-status loop (Gate 3), add the following block. Insert it just before the `// F-06: fetch full identity snapshot` comment:

```ts
// Gate 3b: identity workflows require identity confirmation on at least one COA
const IDENTITY_REQUIRED_WORKFLOWS: Array<string | null> = ["FULL_LAB_TEST", "IDENTITY_CHECK"];
if (newStatus === "APPROVED" && IDENTITY_REQUIRED_WORKFLOWS.includes(existing.qcWorkflowType ?? null)) {
  const identityConfirmed = coas.some((c) => c.identityConfirmed === "true");
  if (!identityConfirmed) {
    throw Object.assign(
      new Error(
        "Cannot approve: this workflow requires identity testing but no COA on this lot has identity confirmed. " +
        "Update the COA to mark identity as confirmed before approving.",
      ),
      { status: 422 },
    );
  }
}
```

Note: `coas` is already fetched in the Gate 3 block above (T-02 work). You need to also select `identityConfirmed` from `coaDocuments` in that earlier query. Update the Gate 3 select to include it:

```ts
const coas = await tx
  .select({
    id: schema.coaDocuments.id,
    labId: schema.coaDocuments.labId,
    identityConfirmed: schema.coaDocuments.identityConfirmed,
  })
  .from(schema.coaDocuments)
  .where(eq(schema.coaDocuments.lotId, existing.lotId));
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add server/db-storage.ts
git commit -m "feat(t-03): block APPROVED if identity not confirmed for FULL_LAB_TEST/IDENTITY_CHECK workflows"
```

---

### Task 1: Tests

**Goal:** Verify the new gate with automated tests.

**Files:**
- Create: `server/__tests__/t03-identity-gate.test.ts`

**Acceptance Criteria:**
- [ ] FULL_LAB_TEST without identity confirmed → 422
- [ ] FULL_LAB_TEST with identity confirmed → APPROVED
- [ ] IDENTITY_CHECK without identity confirmed → 422
- [ ] IDENTITY_CHECK with identity confirmed → APPROVED
- [ ] COA_REVIEW without identity confirmed → APPROVED (gate not applied)
- [ ] EXEMPT without identity confirmed → APPROVED (gate not applied)
- [ ] `pnpm test` passes

**Verify:** `pnpm test` → all tests pass

**Steps:**

- [ ] **Step 1: Write the test file**

Create `server/__tests__/t03-identity-gate.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import * as schema from "../../shared/schema";
import { storage } from "../db-storage";
import { hashPassword } from "../auth/password";
import { eq, inArray } from "drizzle-orm";

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

let adminId: string;
const seededLotIds: string[] = [];
const seededRecordIds: string[] = [];
const seededCoaIds: string[] = [];
const seededUserIds: string[] = [];

beforeAll(async () => {
  const [admin] = await db.insert(schema.users).values({
    email: `t03-admin-${Date.now()}@test.com`,
    fullName: "T03 Admin",
    passwordHash: await hashPassword("Neurogan1!Secure"),
    createdByUserId: null as unknown as string,
  }).returning();
  adminId = admin!.id;
  seededUserIds.push(adminId);
  await db.insert(schema.userRoles).values({ userId: adminId, role: "ADMIN", grantedByUserId: adminId });
});

afterAll(async () => {
  if (seededCoaIds.length) await db.delete(schema.coaDocuments).where(inArray(schema.coaDocuments.id, seededCoaIds));
  if (seededRecordIds.length) await db.delete(schema.receivingRecords).where(inArray(schema.receivingRecords.id, seededRecordIds));
  if (seededLotIds.length) await db.delete(schema.lots).where(inArray(schema.lots.id, seededLotIds));
  if (seededUserIds.length) {
    await db.delete(schema.userRoles).where(inArray(schema.userRoles.userId, seededUserIds));
    await db.delete(schema.users).where(inArray(schema.users.id, seededUserIds));
  }
});

async function seedForWorkflow(
  workflowType: "FULL_LAB_TEST" | "IDENTITY_CHECK" | "COA_REVIEW" | "EXEMPT",
  identityConfirmed: "true" | "false" | null,
) {
  const [product] = await db.select().from(schema.products).limit(1);
  if (!product) throw new Error("No product seeded — run seed:test first");
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [lot] = await db.insert(schema.lots).values({
    productId: product.id,
    lotNumber: `T03-LOT-${suffix}`,
    supplierName: "Test Supplier",
    quarantineStatus: "PENDING_QC",
  }).returning();
  seededLotIds.push(lot!.id);

  const [record] = await db.insert(schema.receivingRecords).values({
    lotId: lot!.id,
    uniqueIdentifier: `T03-RCV-${suffix}`,
    status: "PENDING_QC",
    qcWorkflowType: workflowType,
    requiresQualification: false,
    dateReceived: "2026-04-24",
    quantityReceived: "10",
    uom: "kg",
  }).returning();
  seededRecordIds.push(record!.id);

  const [coa] = await db.insert(schema.coaDocuments).values({
    lotId: lot!.id,
    receivingRecordId: record!.id,
    sourceType: "SUPPLIER",
    overallResult: "PASS",
    identityConfirmed: identityConfirmed ?? undefined,
  }).returning();
  seededCoaIds.push(coa!.id);

  return { lot: lot!, record: record!, coa: coa! };
}

describeIfDb("T03 — identity test gate on qcReviewReceivingRecord", () => {
  it("FULL_LAB_TEST without identity confirmed → 422", async () => {
    const { record } = await seedForWorkflow("FULL_LAB_TEST", "false");
    await expect(
      storage.qcReviewReceivingRecord(record.id, "APPROVED", adminId),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("FULL_LAB_TEST with identity confirmed → APPROVED", async () => {
    const { record } = await seedForWorkflow("FULL_LAB_TEST", "true");
    const result = await storage.qcReviewReceivingRecord(record.id, "APPROVED", adminId);
    expect(result?.status).toBe("APPROVED");
  });

  it("IDENTITY_CHECK without identity confirmed → 422", async () => {
    const { record } = await seedForWorkflow("IDENTITY_CHECK", "false");
    await expect(
      storage.qcReviewReceivingRecord(record.id, "APPROVED", adminId),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("IDENTITY_CHECK with identity confirmed → APPROVED", async () => {
    const { record } = await seedForWorkflow("IDENTITY_CHECK", "true");
    const result = await storage.qcReviewReceivingRecord(record.id, "APPROVED", adminId);
    expect(result?.status).toBe("APPROVED");
  });

  it("COA_REVIEW without identity confirmed → APPROVED (gate not applied)", async () => {
    const { record } = await seedForWorkflow("COA_REVIEW", "false");
    const result = await storage.qcReviewReceivingRecord(record.id, "APPROVED", adminId);
    expect(result?.status).toBe("APPROVED");
  });

  it("EXEMPT without identity confirmed → APPROVED (gate not applied)", async () => {
    const { record } = await seedForWorkflow("EXEMPT", "false");
    const result = await storage.qcReviewReceivingRecord(record.id, "APPROVED", adminId);
    expect(result?.status).toBe("APPROVED");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/t03-identity-gate.test.ts
git commit -m "test(t-03): identity test gate for FULL_LAB_TEST and IDENTITY_CHECK workflows"
```

```json:metadata
{"files": ["server/db-storage.ts", "server/__tests__/t03-identity-gate.test.ts"], "verifyCommand": "pnpm typecheck && pnpm test", "acceptanceCriteria": ["FULL_LAB_TEST and IDENTITY_CHECK blocked at APPROVED if no COA has identityConfirmed=true", "COA_REVIEW and EXEMPT not affected", "pnpm typecheck passes", "pnpm test passes"]}
```
