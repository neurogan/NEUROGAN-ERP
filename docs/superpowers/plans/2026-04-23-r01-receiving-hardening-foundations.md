# R-01 Receiving Hardening — Phase 1 Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add labs registry, approved materials registry, automatic QC workflow routing, state machine gates, F-06 identity snapshots, and a role-specific dashboard tasks widget to the Neurogan ERP receiving module.

**Architecture:** Two new Postgres tables (`erp_labs`, `erp_approved_materials`) store registries. Receiving records get three new fields (`requires_qualification`, `qc_workflow_type`, and jsonb identity snapshots on `visual_exam_by`/`qc_reviewed_by`). All business logic lives in `db-storage.ts`; routes stay thin. The dashboard tasks widget is a derived view computed from receiving record state — no separate tasks table.

**Tech Stack:** Node.js/Express, Drizzle ORM + PostgreSQL, React + TanStack Query, Tailwind CSS, Vitest for tests, Zod for validation.

---

### Task 0: DB migration + schema.ts — foundation for all other tasks

**Goal:** Create the two new tables, add columns to existing tables, and update `shared/schema.ts` to match.

**Files:**
- Create: `migrations/0007_r01_receiving_hardening.sql`
- Modify: `shared/schema.ts`

**Acceptance Criteria:**
- [ ] `erp_labs` table exists with seed data (Neurogan Labs + Nutri Analytical)
- [ ] `erp_approved_materials` table exists with UNIQUE(product_id, supplier_id)
- [ ] `erp_receiving_records` has `requires_qualification` boolean, `qc_workflow_type` text, and `visual_exam_by`/`qc_reviewed_by` as jsonb
- [ ] `erp_coa_documents` has nullable `lab_id` FK column
- [ ] `erp_lots.quarantine_status` default is `QUARANTINED` (was `APPROVED`)
- [ ] `pnpm typecheck` passes with no errors

**Verify:** `pnpm migrate:up && pnpm typecheck` → 0 errors

**Steps:**

- [ ] **Step 1: Write the migration SQL**

Create `migrations/0007_r01_receiving_hardening.sql`:

```sql
-- R-01: Receiving Hardening — Phase 1 Foundations
-- Labs registry, approved materials, workflow type, identity snapshot, lot quarantine fix.

-- ── 1. Labs registry ─────────────────────────────────────────────────────────
CREATE TABLE erp_labs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL UNIQUE,
  address    TEXT,
  type       TEXT        NOT NULL CHECK (type IN ('IN_HOUSE', 'THIRD_PARTY')),
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO erp_labs (name, address, type) VALUES
  ('Neurogan Labs', '', 'IN_HOUSE'),
  ('Nutri Analytical Testing Laboratories', '', 'THIRD_PARTY')
ON CONFLICT (name) DO NOTHING;

-- ── 2. Approved materials registry ───────────────────────────────────────────
CREATE TABLE erp_approved_materials (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            VARCHAR     NOT NULL REFERENCES erp_products(id),
  supplier_id           VARCHAR     NOT NULL REFERENCES erp_suppliers(id),
  approved_by_user_id   UUID        NOT NULL REFERENCES erp_users(id),
  approved_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes                 TEXT,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, supplier_id)
);

-- ── 3. erp_receiving_records additions ───────────────────────────────────────
ALTER TABLE erp_receiving_records
  ADD COLUMN requires_qualification BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN qc_workflow_type       TEXT;

-- Migrate visual_exam_by: text → jsonb identity snapshot
ALTER TABLE erp_receiving_records
  ALTER COLUMN visual_exam_by TYPE jsonb USING
    CASE
      WHEN visual_exam_by IS NULL THEN NULL
      ELSE jsonb_build_object('userId', null, 'fullName', visual_exam_by, 'title', null)
    END;

-- Migrate qc_reviewed_by: text → jsonb identity snapshot
ALTER TABLE erp_receiving_records
  ALTER COLUMN qc_reviewed_by TYPE jsonb USING
    CASE
      WHEN qc_reviewed_by IS NULL THEN NULL
      ELSE jsonb_build_object('userId', null, 'fullName', qc_reviewed_by, 'title', null)
    END;

-- ── 4. erp_coa_documents: add lab FK ─────────────────────────────────────────
ALTER TABLE erp_coa_documents
  ADD COLUMN lab_id UUID REFERENCES erp_labs(id);

-- ── 5. Fix erp_lots quarantine_status default (was APPROVED — bug) ────────────
ALTER TABLE erp_lots
  ALTER COLUMN quarantine_status SET DEFAULT 'QUARANTINED';
```

- [ ] **Step 2: Run the migration**

```bash
pnpm migrate:up
```

Expected: migration applied with no errors.

- [ ] **Step 3: Update shared/schema.ts imports**

Add `boolean` and `unique` to the drizzle-orm/pg-core import at the top of `shared/schema.ts`:

```typescript
import {
  pgTable,
  text,
  varchar,
  decimal,
  timestamp,
  pgEnum,
  uuid,
  integer,
  primaryKey,
  jsonb,
  boolean,
  unique,
} from "drizzle-orm/pg-core";
```

- [ ] **Step 4: Add labs table definition to schema.ts**

Add after the `suppliers` table definition (after line ~125):

```typescript
export const labs = pgTable("erp_labs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  address: text("address"),
  type: text("type").notNull().$type<"IN_HOUSE" | "THIRD_PARTY">(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLabSchema = createInsertSchema(labs).omit({ id: true, createdAt: true });
export type Lab = typeof labs.$inferSelect;
export type InsertLab = z.infer<typeof insertLabSchema>;
```

- [ ] **Step 5: Add approvedMaterials table definition to schema.ts**

Add after the `labs` table definition:

```typescript
export const approvedMaterials = pgTable(
  "erp_approved_materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: varchar("product_id").notNull().references(() => products.id),
    supplierId: varchar("supplier_id").notNull().references(() => suppliers.id),
    approvedByUserId: uuid("approved_by_user_id").notNull().references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique().on(t.productId, t.supplierId),
  }),
);

export type ApprovedMaterial = typeof approvedMaterials.$inferSelect;
```

- [ ] **Step 6: Update receivingRecords table definition in schema.ts**

Find `visualExamBy: text("visual_exam_by"),` and `qcReviewedBy: text("qc_reviewed_by"),` in the `receivingRecords` table and replace them. Also add the two new columns. The identity snapshot type:

```typescript
// In the receivingRecords pgTable definition, replace:
//   visualExamBy: text("visual_exam_by"),
//   qcReviewedBy: text("qc_reviewed_by"),
// with:
  visualExamBy: jsonb("visual_exam_by").$type<{ userId: string | null; fullName: string; title: string | null } | null>(),
  qcReviewedBy: jsonb("qc_reviewed_by").$type<{ userId: string | null; fullName: string; title: string | null } | null>(),
// And add these two new columns at the end of the table (before createdAt):
  requiresQualification: boolean("requires_qualification").notNull().default(false),
  qcWorkflowType: text("qc_workflow_type").$type<"FULL_LAB_TEST" | "IDENTITY_CHECK" | "COA_REVIEW" | "EXEMPT" | null>(),
```

Also update `insertReceivingRecordSchema` to omit the auto-computed fields:

```typescript
export const insertReceivingRecordSchema = createInsertSchema(receivingRecords).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  requiresQualification: true,
  qcWorkflowType: true,
  visualExamBy: true,  // server-set from session user (F-06)
});
```

- [ ] **Step 7: Update lots table definition in schema.ts**

Find `quarantineStatus: text("quarantine_status").default("APPROVED"),` and change the default:

```typescript
quarantineStatus: text("quarantine_status").default("QUARANTINED"),
```

- [ ] **Step 8: Add labId FK to coaDocuments in schema.ts**

In the `coaDocuments` table definition, add before `createdAt`:

```typescript
labId: uuid("lab_id").references(() => labs.id),
```

- [ ] **Step 9: Add IdentitySnapshot type export**

Add near the top of the type exports section:

```typescript
export interface IdentitySnapshot {
  userId: string | null;
  fullName: string;
  title: string | null;
}
```

- [ ] **Step 10: Verify typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors. If there are errors about `jsonb` type mismatches on `visualExamBy` or `qcReviewedBy`, they'll be addressed in Tasks 3 and 4 as those methods are updated.

- [ ] **Step 11: Commit**

```bash
git add migrations/0007_r01_receiving_hardening.sql shared/schema.ts
git commit -m "feat(r01): add labs, approved_materials tables; receiving identity snapshot schema"
```

---

### Task 1: Labs registry backend — CRUD, routes, tests

**Goal:** Full CRUD API for the labs registry (`/api/labs`), with integration tests.

**Files:**
- Modify: `server/storage.ts` (add lab methods to IStorage interface)
- Modify: `server/db-storage.ts` (implement lab methods)
- Modify: `server/routes.ts` (add /api/labs routes)
- Create: `server/__tests__/r01-labs.test.ts`

**Acceptance Criteria:**
- [ ] `GET /api/labs` returns all labs (ADMIN + QA only)
- [ ] `POST /api/labs` creates a lab and returns 201 (ADMIN + QA only)
- [ ] `PATCH /api/labs/:id` updates name/address/isActive (ADMIN + QA only)
- [ ] Non-QA/ADMIN users get 403

**Verify:** `DATABASE_URL=<url> pnpm test:integration -- --reporter=verbose -t "r01-labs"` → all pass

**Steps:**

- [ ] **Step 1: Write the failing integration test**

Create `server/__tests__/r01-labs.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { db } from "../db";
import * as schema from "@shared/schema";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const VALID_PASSWORD = "Neurogan1!Secure";

async function seedAdmin(email: string) {
  const hash = await hashPassword(VALID_PASSWORD);
  return storage.createUser({
    email,
    fullName: "Test Admin",
    title: "Administrator",
    passwordHash: hash,
    roles: ["ADMIN"],
    createdByUserId: null,
    grantedByUserId: null,
  });
}

async function seedViewer(email: string, adminId: string) {
  const hash = await hashPassword(VALID_PASSWORD);
  return storage.createUser({
    email,
    fullName: "Test Viewer",
    title: null,
    passwordHash: hash,
    roles: ["VIEWER"],
    createdByUserId: adminId,
    grantedByUserId: adminId,
  });
}

async function cleanDb() {
  await db.update(schema.validationDocuments).set({ signatureId: null });
  await db.delete(schema.electronicSignatures);
  await db.delete(schema.auditTrail);
  await db.delete(schema.passwordHistory);
  await db.delete(schema.userRoles);
  await db.delete(schema.users);
  await db.delete(schema.labs);
}

describeIfDb("R-01 — labs registry", () => {
  let app: Express;
  let adminId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await cleanDb();
    const admin = await seedAdmin("admin@labs.test");
    adminId = admin.id;
  });

  afterAll(async () => {
    await cleanDb();
  });

  it("GET /api/labs returns seeded labs for ADMIN", async () => {
    const res = await request(app)
      .get("/api/labs")
      .set("x-test-user-id", adminId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /api/labs creates a lab", async () => {
    const res = await request(app)
      .post("/api/labs")
      .set("x-test-user-id", adminId)
      .send({ name: "Test Lab", address: "123 Main St", type: "THIRD_PARTY" });
    expect(res.status).toBe(201);
    expect((res.body as { name: string }).name).toBe("Test Lab");
  });

  it("PATCH /api/labs/:id deactivates a lab", async () => {
    const created = await request(app)
      .post("/api/labs")
      .set("x-test-user-id", adminId)
      .send({ name: "Lab To Deactivate", address: "", type: "THIRD_PARTY" });
    const labId = (created.body as { id: string }).id;

    const res = await request(app)
      .patch(`/api/labs/${labId}`)
      .set("x-test-user-id", adminId)
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect((res.body as { isActive: boolean }).isActive).toBe(false);
  });

  it("GET /api/labs returns 403 for VIEWER", async () => {
    const viewer = await seedViewer("viewer@labs.test", adminId);
    const res = await request(app)
      .get("/api/labs")
      .set("x-test-user-id", viewer.id);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
DATABASE_URL=$DATABASE_URL pnpm test:integration -- --reporter=verbose -t "R-01 — labs registry"
```

Expected: FAIL — routes and storage methods not yet implemented.

- [ ] **Step 3: Add lab methods to storage interface**

In `server/storage.ts`, add to the `IStorage` interface:

```typescript
// Labs
listLabs(): Promise<Lab[]>;
createLab(data: InsertLab): Promise<Lab>;
updateLab(id: string, data: Partial<InsertLab>): Promise<Lab | undefined>;
```

Also add the import at the top:

```typescript
import type { Lab, InsertLab } from "@shared/schema";
```

(Add to the existing schema import if one exists, or add a new import.)

- [ ] **Step 4: Implement lab methods in db-storage.ts**

Add to the `DbStorage` class in `server/db-storage.ts`:

```typescript
async listLabs(): Promise<Lab[]> {
  return db.select().from(schema.labs).orderBy(schema.labs.name);
}

async createLab(data: InsertLab): Promise<Lab> {
  const [lab] = await db.insert(schema.labs).values(data).returning();
  return lab!;
}

async updateLab(id: string, data: Partial<InsertLab>): Promise<Lab | undefined> {
  const [lab] = await db
    .update(schema.labs)
    .set(data)
    .where(eq(schema.labs.id, id))
    .returning();
  return lab;
}
```

- [ ] **Step 5: Add /api/labs routes to routes.ts**

Add these three route handlers to `server/routes.ts` (near other registry/settings routes, before the `app.get("/api/receiving"...` section works fine):

```typescript
// ── Labs registry ──────────────────────────────────────────────────────────

app.get("/api/labs", requireAuth, requireRole("QA", "ADMIN"), async (_req, res, next) => {
  try {
    const labs = await storage.listLabs();
    res.json(labs);
  } catch (err) {
    next(err);
  }
});

app.post("/api/labs", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
  try {
    const data = schema.insertLabSchema.parse(req.body);
    const lab = await storage.createLab(data);
    res.status(201).json(lab);
  } catch (err) {
    next(err);
  }
});

app.patch<{ id: string }>("/api/labs/:id", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
  try {
    const data = schema.insertLabSchema.partial().parse(req.body);
    const lab = await storage.updateLab(req.params.id, data);
    if (!lab) return res.status(404).json({ message: "Lab not found" });
    res.json(lab);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 6: Run tests again to verify they pass**

```bash
DATABASE_URL=$DATABASE_URL pnpm test:integration -- --reporter=verbose -t "R-01 — labs registry"
```

Expected: all 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add server/storage.ts server/db-storage.ts server/routes.ts server/__tests__/r01-labs.test.ts
git commit -m "feat(r01): add labs registry CRUD + routes"
```

---

### Task 2: Approved materials backend — CRUD, routes, tests

**Goal:** API for listing and revoking approved material+supplier combos (`/api/approved-materials`), with integration tests. Creation happens automatically in Task 4 (QC approval side-effect) — this task only handles read and revoke.

**Files:**
- Modify: `server/storage.ts`
- Modify: `server/db-storage.ts`
- Modify: `server/routes.ts`
- Create: `server/__tests__/r01-approved-materials.test.ts`

**Acceptance Criteria:**
- [ ] `GET /api/approved-materials` returns all active entries with product name, supplier name, approver name (ADMIN + QA)
- [ ] `DELETE /api/approved-materials/:id` sets `isActive = false` (QA only)
- [ ] Non-QA/ADMIN gets 403

**Verify:** `DATABASE_URL=<url> pnpm test:integration -- -t "R-01 — approved materials"` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/r01-approved-materials.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const VALID_PASSWORD = "Neurogan1!Secure";

async function seedAdmin(email: string) {
  const hash = await hashPassword(VALID_PASSWORD);
  return storage.createUser({ email, fullName: "Admin", title: null, passwordHash: hash, roles: ["ADMIN"], createdByUserId: null, grantedByUserId: null });
}

async function cleanDb() {
  await db.update(schema.validationDocuments).set({ signatureId: null });
  await db.delete(schema.electronicSignatures);
  await db.delete(schema.approvedMaterials);
  await db.delete(schema.auditTrail);
  await db.delete(schema.passwordHistory);
  await db.delete(schema.userRoles);
  await db.delete(schema.users);
}

async function seedApprovedMaterial(productId: string, supplierId: string, adminId: string) {
  const [row] = await db.insert(schema.approvedMaterials).values({
    productId,
    supplierId,
    approvedByUserId: adminId,
  }).returning();
  return row!;
}

describeIfDb("R-01 — approved materials", () => {
  let app: Express;
  let adminId: string;

  beforeAll(async () => { app = await buildTestApp(); });
  beforeEach(async () => {
    await cleanDb();
    const admin = await seedAdmin("admin@approved.test");
    adminId = admin.id;
  });
  afterAll(async () => { await cleanDb(); });

  it("GET /api/approved-materials returns list for ADMIN", async () => {
    const res = await request(app)
      .get("/api/approved-materials")
      .set("x-test-user-id", adminId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/approved-materials returns 403 for non-ADMIN/QA", async () => {
    const viewer = await storage.createUser({ email: "viewer@approved.test", fullName: "Viewer", title: null, passwordHash: await hashPassword(VALID_PASSWORD), roles: ["VIEWER"], createdByUserId: adminId, grantedByUserId: adminId });
    const res = await request(app).get("/api/approved-materials").set("x-test-user-id", viewer.id);
    expect(res.status).toBe(403);
  });

  it("DELETE /api/approved-materials/:id sets isActive=false", async () => {
    // Need real product+supplier from DB for FK constraint
    const products = await db.select().from(schema.products).limit(1);
    const suppliers = await db.select().from(schema.suppliers).limit(1);
    if (!products[0] || !suppliers[0]) return; // skip if no seed data

    const entry = await seedApprovedMaterial(products[0].id, suppliers[0].id, adminId);
    const res = await request(app)
      .delete(`/api/approved-materials/${entry.id}`)
      .set("x-test-user-id", adminId);
    expect(res.status).toBe(200);

    const [updated] = await db.select().from(schema.approvedMaterials).where(eq(schema.approvedMaterials.id, entry.id));
    expect(updated?.isActive).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
DATABASE_URL=$DATABASE_URL pnpm test:integration -- -t "R-01 — approved materials"
```

Expected: FAIL — routes not implemented.

- [ ] **Step 3: Add interface methods to storage.ts**

```typescript
// Approved materials
listApprovedMaterials(): Promise<ApprovedMaterialWithDetails[]>;
revokeApprovedMaterial(id: string): Promise<void>;
isApprovedMaterial(productId: string, supplierId: string): Promise<boolean>;
createApprovedMaterial(productId: string, supplierId: string, approvedByUserId: string, notes?: string, tx?: Tx): Promise<ApprovedMaterial>;
```

Add to the imports:

```typescript
import type { ApprovedMaterial } from "@shared/schema";

export interface ApprovedMaterialWithDetails {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  supplierId: string;
  supplierName: string;
  approvedByUserId: string;
  approvedByName: string;
  approvedAt: Date;
  notes: string | null;
  isActive: boolean;
}
```

- [ ] **Step 4: Implement in db-storage.ts**

```typescript
async listApprovedMaterials(): Promise<ApprovedMaterialWithDetails[]> {
  const rows = await db
    .select({
      id: schema.approvedMaterials.id,
      productId: schema.approvedMaterials.productId,
      productName: schema.products.name,
      productSku: schema.products.sku,
      supplierId: schema.approvedMaterials.supplierId,
      supplierName: schema.suppliers.name,
      approvedByUserId: schema.approvedMaterials.approvedByUserId,
      approvedByName: schema.users.fullName,
      approvedAt: schema.approvedMaterials.approvedAt,
      notes: schema.approvedMaterials.notes,
      isActive: schema.approvedMaterials.isActive,
    })
    .from(schema.approvedMaterials)
    .leftJoin(schema.products, eq(schema.approvedMaterials.productId, schema.products.id))
    .leftJoin(schema.suppliers, eq(schema.approvedMaterials.supplierId, schema.suppliers.id))
    .leftJoin(schema.users, eq(schema.approvedMaterials.approvedByUserId, schema.users.id))
    .where(eq(schema.approvedMaterials.isActive, true))
    .orderBy(schema.products.name);
  return rows as ApprovedMaterialWithDetails[];
}

async revokeApprovedMaterial(id: string): Promise<void> {
  await db
    .update(schema.approvedMaterials)
    .set({ isActive: false })
    .where(eq(schema.approvedMaterials.id, id));
}

async isApprovedMaterial(productId: string, supplierId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.approvedMaterials.id })
    .from(schema.approvedMaterials)
    .where(
      and(
        eq(schema.approvedMaterials.productId, productId),
        eq(schema.approvedMaterials.supplierId, supplierId),
        eq(schema.approvedMaterials.isActive, true),
      ),
    )
    .limit(1);
  return !!row;
}

async createApprovedMaterial(
  productId: string,
  supplierId: string,
  approvedByUserId: string,
  notes?: string,
  tx?: Tx,
): Promise<ApprovedMaterial> {
  const [row] = await (tx ?? db)
    .insert(schema.approvedMaterials)
    .values({ productId, supplierId, approvedByUserId, notes: notes ?? null })
    .onConflictDoUpdate({
      target: [schema.approvedMaterials.productId, schema.approvedMaterials.supplierId],
      set: { isActive: true, approvedByUserId, approvedAt: new Date(), notes: notes ?? null },
    })
    .returning();
  return row!;
}
```

Also add `and` to the drizzle-orm import if not already present:

```typescript
import { eq, and, ... } from "drizzle-orm";
```

- [ ] **Step 5: Add routes to routes.ts**

```typescript
// ── Approved materials ──────────────────────────────────────────────────────

app.get("/api/approved-materials", requireAuth, requireRole("QA", "ADMIN"), async (_req, res, next) => {
  try {
    const items = await storage.listApprovedMaterials();
    res.json(items);
  } catch (err) {
    next(err);
  }
});

app.delete<{ id: string }>("/api/approved-materials/:id", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
  try {
    await storage.revokeApprovedMaterial(req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 6: Run tests to verify pass**

```bash
DATABASE_URL=$DATABASE_URL pnpm test:integration -- -t "R-01 — approved materials"
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add server/storage.ts server/db-storage.ts server/routes.ts server/__tests__/r01-approved-materials.test.ts
git commit -m "feat(r01): add approved materials registry backend"
```

---

### Task 3: Workflow type determination at receiving creation

**Goal:** `createReceivingRecord` automatically sets `qc_workflow_type` and `requires_qualification` based on the product's category and whether the product+supplier combo is in `erp_approved_materials`.

**Files:**
- Modify: `server/db-storage.ts` (createReceivingRecord)
- Create: `server/__tests__/r01-workflow-type.test.ts`

**Acceptance Criteria:**
- [ ] ACTIVE_INGREDIENT + unknown supplier → `FULL_LAB_TEST`, `requires_qualification = true`
- [ ] ACTIVE_INGREDIENT + known supplier → `IDENTITY_CHECK`, `requires_qualification = false`
- [ ] SUPPORTING_INGREDIENT + unknown supplier → `FULL_LAB_TEST`, `requires_qualification = true`
- [ ] PRIMARY_PACKAGING (any supplier) → `COA_REVIEW`, `requires_qualification = false`
- [ ] SECONDARY_PACKAGING → `EXEMPT`, `requires_qualification = false`
- [ ] FINISHED_GOOD → `COA_REVIEW`, `requires_qualification = false`

**Verify:** `DATABASE_URL=<url> pnpm test:integration -- -t "R-01 — workflow type"` → 6 tests pass

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/r01-workflow-type.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

async function seedUser(email: string, roles: string[], createdById: string | null) {
  const hash = await hashPassword("Neurogan1!Secure");
  return storage.createUser({ email, fullName: "Test", title: null, passwordHash: hash, roles: roles as any, createdByUserId: createdById, grantedByUserId: createdById });
}

async function cleanDb() {
  await db.update(schema.validationDocuments).set({ signatureId: null });
  await db.delete(schema.electronicSignatures);
  await db.delete(schema.receivingRecords);
  await db.delete(schema.approvedMaterials);
  await db.delete(schema.auditTrail);
  await db.delete(schema.passwordHistory);
  await db.delete(schema.userRoles);
  await db.delete(schema.users);
}

async function seedProductAndSupplierAndLot(category: string) {
  const [product] = await db.insert(schema.products).values({
    name: `Test Product ${category}`,
    sku: `TEST-${category}-${Date.now()}`,
    category,
    defaultUom: "g",
    status: "ACTIVE",
  }).returning();

  const [supplier] = await db.insert(schema.suppliers).values({
    name: `Test Supplier ${Date.now()}`,
  }).returning();

  const [lot] = await db.insert(schema.lots).values({
    productId: product!.id,
    lotNumber: `LOT-${Date.now()}`,
    supplierName: supplier!.name,
  }).returning();

  return { product: product!, supplier: supplier!, lot: lot! };
}

describeIfDb("R-01 — workflow type determination", () => {
  let app: Express;
  let adminId: string;
  let receivingUserId: string;

  beforeAll(async () => { app = await buildTestApp(); });

  beforeEach(async () => {
    await cleanDb();
    const admin = await seedUser("admin@workflow.test", ["ADMIN"], null);
    adminId = admin.id;
    const recv = await seedUser("recv@workflow.test", ["RECEIVING"], adminId);
    receivingUserId = recv.id;
  });

  afterAll(async () => { await cleanDb(); });

  it("ACTIVE_INGREDIENT + unknown supplier → FULL_LAB_TEST + requires_qualification", async () => {
    const { product, supplier, lot } = await seedProductAndSupplierAndLot("ACTIVE_INGREDIENT");
    const res = await request(app)
      .post("/api/receiving")
      .set("x-test-user-id", receivingUserId)
      .send({ lotId: lot.id, supplierId: supplier.id, productId: product.id, uniqueIdentifier: `RCV-TEST-001`, quantityReceived: "10", uom: "kg", dateReceived: "2026-04-23" });
    expect(res.status).toBe(201);
    expect((res.body as any).qcWorkflowType).toBe("FULL_LAB_TEST");
    expect((res.body as any).requiresQualification).toBe(true);
  });

  it("ACTIVE_INGREDIENT + approved supplier → IDENTITY_CHECK + no qualification", async () => {
    const { product, supplier, lot } = await seedProductAndSupplierAndLot("ACTIVE_INGREDIENT");
    await db.insert(schema.approvedMaterials).values({ productId: product.id, supplierId: supplier.id, approvedByUserId: adminId });

    const res = await request(app)
      .post("/api/receiving")
      .set("x-test-user-id", receivingUserId)
      .send({ lotId: lot.id, supplierId: supplier.id, productId: product.id, uniqueIdentifier: `RCV-TEST-002`, quantityReceived: "10", uom: "kg", dateReceived: "2026-04-23" });
    expect(res.status).toBe(201);
    expect((res.body as any).qcWorkflowType).toBe("IDENTITY_CHECK");
    expect((res.body as any).requiresQualification).toBe(false);
  });

  it("PRIMARY_PACKAGING → COA_REVIEW regardless of supplier", async () => {
    const { supplier, lot } = await seedProductAndSupplierAndLot("PRIMARY_PACKAGING");
    const res = await request(app)
      .post("/api/receiving")
      .set("x-test-user-id", receivingUserId)
      .send({ lotId: lot.id, supplierId: supplier.id, uniqueIdentifier: `RCV-TEST-003`, quantityReceived: "100", uom: "pcs", dateReceived: "2026-04-23" });
    expect(res.status).toBe(201);
    expect((res.body as any).qcWorkflowType).toBe("COA_REVIEW");
    expect((res.body as any).requiresQualification).toBe(false);
  });

  it("SECONDARY_PACKAGING → EXEMPT", async () => {
    const { supplier, lot } = await seedProductAndSupplierAndLot("SECONDARY_PACKAGING");
    const res = await request(app)
      .post("/api/receiving")
      .set("x-test-user-id", receivingUserId)
      .send({ lotId: lot.id, supplierId: supplier.id, uniqueIdentifier: `RCV-TEST-004`, quantityReceived: "50", uom: "pcs", dateReceived: "2026-04-23" });
    expect(res.status).toBe(201);
    expect((res.body as any).qcWorkflowType).toBe("EXEMPT");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
DATABASE_URL=$DATABASE_URL pnpm test:integration -- -t "R-01 — workflow type determination"
```

Expected: FAIL — createReceivingRecord doesn't set these fields yet.

- [ ] **Step 3: Add a helper function for workflow type determination**

Add this pure function near the top of `server/db-storage.ts` (outside the class, before `class DbStorage`):

```typescript
type QcWorkflowType = "FULL_LAB_TEST" | "IDENTITY_CHECK" | "COA_REVIEW" | "EXEMPT";

async function deriveWorkflowType(
  productId: string | null | undefined,
  supplierId: string | null | undefined,
  tx: Tx,
): Promise<{ qcWorkflowType: QcWorkflowType; requiresQualification: boolean }> {
  if (!productId) return { qcWorkflowType: "COA_REVIEW", requiresQualification: false };

  // Look up product category
  const [product] = await tx
    .select({ category: schema.products.category })
    .from(schema.products)
    .where(eq(schema.products.id, productId));

  const category = product?.category ?? "ACTIVE_INGREDIENT";

  if (category === "SECONDARY_PACKAGING") {
    return { qcWorkflowType: "EXEMPT", requiresQualification: false };
  }

  if (category === "PRIMARY_PACKAGING" || category === "FINISHED_GOOD") {
    return { qcWorkflowType: "COA_REVIEW", requiresQualification: false };
  }

  // ACTIVE_INGREDIENT or SUPPORTING_INGREDIENT — check approved_materials
  if (!supplierId) {
    return { qcWorkflowType: "FULL_LAB_TEST", requiresQualification: true };
  }

  const [approved] = await tx
    .select({ id: schema.approvedMaterials.id })
    .from(schema.approvedMaterials)
    .where(
      and(
        eq(schema.approvedMaterials.productId, productId),
        eq(schema.approvedMaterials.supplierId, supplierId),
        eq(schema.approvedMaterials.isActive, true),
      ),
    )
    .limit(1);

  if (approved) {
    return { qcWorkflowType: "IDENTITY_CHECK", requiresQualification: false };
  }

  return { qcWorkflowType: "FULL_LAB_TEST", requiresQualification: true };
}
```

- [ ] **Step 4: Update createReceivingRecord in db-storage.ts**

The existing implementation (around line 1395) updates the lot's `quarantineStatus` to match the record's initial status. Extend it to also compute and set the workflow type:

```typescript
async createReceivingRecord(data: InsertReceivingRecord, outerTx?: Tx): Promise<ReceivingRecord> {
  const run = async (tx: Tx) => {
    const { qcWorkflowType, requiresQualification } = await deriveWorkflowType(
      (data as any).productId ?? null,
      data.supplierId ?? null,
      tx,
    );

    const [record] = await tx
      .insert(schema.receivingRecords)
      .values({ ...data, qcWorkflowType, requiresQualification })
      .returning();

    if (data.status) {
      await tx.update(schema.lots).set({ quarantineStatus: data.status }).where(eq(schema.lots.id, data.lotId));
    }

    return record!;
  };
  return outerTx ? run(outerTx) : db.transaction(run);
}
```

Note: `data` does not include `productId` from `InsertReceivingRecord` (it's not in that schema). We need it to derive the workflow type. The route needs to read `productId` from the request body and look it up separately. See Step 5.

- [ ] **Step 5: Pass productId through the creation flow**

The `insertReceivingRecordSchema` doesn't include `productId` (it's on the lot). We need to look it up from the lot. Update `createReceivingRecord` to fetch the lot's `productId`:

```typescript
async createReceivingRecord(data: InsertReceivingRecord, outerTx?: Tx): Promise<ReceivingRecord> {
  const run = async (tx: Tx) => {
    // Fetch the lot to get productId for workflow determination
    const [lot] = await tx
      .select({ productId: schema.lots.productId })
      .from(schema.lots)
      .where(eq(schema.lots.id, data.lotId));

    const { qcWorkflowType, requiresQualification } = await deriveWorkflowType(
      lot?.productId ?? null,
      data.supplierId ?? null,
      tx,
    );

    const [record] = await tx
      .insert(schema.receivingRecords)
      .values({ ...data, qcWorkflowType, requiresQualification })
      .returning();

    await tx
      .update(schema.lots)
      .set({ quarantineStatus: data.status ?? "QUARANTINED" })
      .where(eq(schema.lots.id, data.lotId));

    return record!;
  };
  return outerTx ? run(outerTx) : db.transaction(run);
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
DATABASE_URL=$DATABASE_URL pnpm test:integration -- -t "R-01 — workflow type determination"
```

Expected: all 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add server/db-storage.ts server/__tests__/r01-workflow-type.test.ts
git commit -m "feat(r01): auto-derive qc_workflow_type at receiving creation"
```

---

### Task 4: State machine gates + F-06 identity snapshot + auto-qualification

**Goal:** Enforce three validation gates (visual inspection completeness, Neurogan COA required, auto-create approved_materials on first approval) and store immutable identity snapshots on review actions.

**Files:**
- Modify: `server/db-storage.ts` (updateReceivingRecord, qcReviewReceivingRecord)
- Create: `server/__tests__/r01-gates.test.ts`

**Acceptance Criteria:**
- [ ] QUARANTINED → SAMPLING rejected with 422 if any visual inspection field is missing (FULL_LAB_TEST workflow)
- [ ] QUARANTINED → PENDING_QC rejected with 422 if any visual inspection field is missing (IDENTITY_CHECK / COA_REVIEW)
- [ ] PENDING_QC → APPROVED rejected with 422 if no COA document linked to the lot
- [ ] On APPROVED disposition of a `requires_qualification = true` lot, an `erp_approved_materials` entry is created
- [ ] `qcReviewedBy` on the record is a jsonb object `{ userId, fullName, title }` not a plain name string

**Verify:** `DATABASE_URL=<url> pnpm test:integration -- -t "R-01 — state gates"` → all pass

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/r01-gates.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

async function seedQaUser(email: string, createdById: string) {
  return storage.createUser({ email, fullName: "QA User", title: "QC Manager", passwordHash: await hashPassword("Neurogan1!Secure"), roles: ["QA"], createdByUserId: createdById, grantedByUserId: createdById });
}

async function cleanDb() {
  await db.update(schema.validationDocuments).set({ signatureId: null });
  await db.delete(schema.electronicSignatures);
  await db.delete(schema.receivingRecords);
  await db.delete(schema.approvedMaterials);
  await db.delete(schema.coaDocuments);
  await db.delete(schema.auditTrail);
  await db.delete(schema.passwordHistory);
  await db.delete(schema.userRoles);
  await db.delete(schema.users);
}

async function seedReceivingRecord(adminId: string, status = "QUARANTINED") {
  const [product] = await db.insert(schema.products).values({ name: "Gate Test Product", sku: `GATE-${Date.now()}`, category: "ACTIVE_INGREDIENT", defaultUom: "g", status: "ACTIVE" }).returning();
  const [supplier] = await db.insert(schema.suppliers).values({ name: "Gate Test Supplier" }).returning();
  const [lot] = await db.insert(schema.lots).values({ productId: product!.id, lotNumber: `GATE-LOT-${Date.now()}`, supplierName: supplier!.name, quarantineStatus: status }).returning();
  const [record] = await db.insert(schema.receivingRecords).values({ lotId: lot!.id, supplierId: supplier!.id, uniqueIdentifier: `RCV-GATE-${Date.now()}`, status, qcWorkflowType: "FULL_LAB_TEST", requiresQualification: true, dateReceived: "2026-04-23", quantityReceived: "10", uom: "kg" }).returning();
  return { product: product!, supplier: supplier!, lot: lot!, record: record! };
}

describeIfDb("R-01 — state machine gates", () => {
  let app: Express;
  let adminId: string;
  let qaId: string;

  beforeAll(async () => { app = await buildTestApp(); });

  beforeEach(async () => {
    await cleanDb();
    const admin = await storage.createUser({ email: "admin@gates.test", fullName: "Admin", title: null, passwordHash: await hashPassword("Neurogan1!Secure"), roles: ["ADMIN"], createdByUserId: null, grantedByUserId: null });
    adminId = admin.id;
    const qa = await seedQaUser("qa@gates.test", adminId);
    qaId = qa.id;
  });

  afterAll(async () => { await cleanDb(); });

  it("Gate 1: QUARANTINED→SAMPLING rejected (422) if visual inspection incomplete", async () => {
    const { record } = await seedReceivingRecord(adminId);
    // No visual inspection fields set — attempt transition
    const res = await request(app)
      .put(`/api/receiving/${record.id}`)
      .set("x-test-user-id", adminId)
      .send({ status: "SAMPLING" });
    expect(res.status).toBe(422);
    expect((res.body as any).message).toMatch(/visual inspection/i);
  });

  it("Gate 1: QUARANTINED→SAMPLING allowed when visual inspection complete", async () => {
    const { record } = await seedReceivingRecord(adminId);
    const res = await request(app)
      .put(`/api/receiving/${record.id}`)
      .set("x-test-user-id", adminId)
      .send({
        status: "SAMPLING",
        containerConditionOk: "true",
        sealsIntact: "true",
        labelsMatch: "true",
        invoiceMatchesPo: "true",
        visualExamAt: new Date().toISOString(),
      });
    expect(res.status).toBe(200);
    // visualExamBy should be set as a snapshot, not a string
    const body = res.body as any;
    expect(typeof body.visualExamBy).toBe("object");
    expect(body.visualExamBy.userId).toBe(adminId);
  });

  it("Gate 3: PENDING_QC→APPROVED rejected (422) when no COA linked", async () => {
    const { record, lot } = await seedReceivingRecord(adminId, "PENDING_QC");
    await db.update(schema.lots).set({ quarantineStatus: "PENDING_QC" }).where(eq(schema.lots.id, lot.id));

    const res = await request(app)
      .post(`/api/receiving/${record.id}/qc-review`)
      .set("x-test-user-id", qaId)
      .send({ disposition: "APPROVED", notes: "Looks good", password: "Neurogan1!Secure" });
    expect(res.status).toBe(422);
    expect((res.body as any).message).toMatch(/COA/i);
  });

  it("Gate 3 side-effect: approval of requires_qualification lot creates approved_materials entry", async () => {
    const { record, lot, product, supplier } = await seedReceivingRecord(adminId, "PENDING_QC");
    await db.update(schema.lots).set({ quarantineStatus: "PENDING_QC" }).where(eq(schema.lots.id, lot.id));

    // Attach a COA to satisfy gate 3
    await db.insert(schema.coaDocuments).values({ lotId: lot.id, sourceType: "INTERNAL_LAB", overallResult: "PASS" });

    const res = await request(app)
      .post(`/api/receiving/${record.id}/qc-review`)
      .set("x-test-user-id", qaId)
      .send({ disposition: "APPROVED", notes: "First receipt approved", password: "Neurogan1!Secure" });
    expect(res.status).toBe(200);

    const [entry] = await db
      .select()
      .from(schema.approvedMaterials)
      .where(and(eq(schema.approvedMaterials.productId, product.id), eq(schema.approvedMaterials.supplierId, supplier.id)));
    expect(entry).toBeTruthy();
    expect(entry!.approvedByUserId).toBe(qaId);
  });

  it("F-06: qcReviewedBy is stored as identity snapshot, not plain string", async () => {
    const { record, lot } = await seedReceivingRecord(adminId, "PENDING_QC");
    await db.update(schema.lots).set({ quarantineStatus: "PENDING_QC" }).where(eq(schema.lots.id, lot.id));
    await db.insert(schema.coaDocuments).values({ lotId: lot.id, sourceType: "INTERNAL_LAB", overallResult: "PASS" });

    await request(app)
      .post(`/api/receiving/${record.id}/qc-review`)
      .set("x-test-user-id", qaId)
      .send({ disposition: "APPROVED", notes: "", password: "Neurogan1!Secure" });

    const [updated] = await db.select().from(schema.receivingRecords).where(eq(schema.receivingRecords.id, record.id));
    expect(typeof updated!.qcReviewedBy).toBe("object");
    expect((updated!.qcReviewedBy as any).userId).toBe(qaId);
    expect((updated!.qcReviewedBy as any).fullName).toBe("QA User");
    expect((updated!.qcReviewedBy as any).title).toBe("QC Manager");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
DATABASE_URL=$DATABASE_URL pnpm test:integration -- -t "R-01 — state machine gates"
```

Expected: FAIL.

- [ ] **Step 3: Add visual inspection completeness check helper**

Add in `server/db-storage.ts` (near `deriveWorkflowType`):

```typescript
function assertVisualInspectionComplete(record: { containerConditionOk: string | null; sealsIntact: string | null; labelsMatch: string | null; invoiceMatchesPo: string | null }): void {
  const missing: string[] = [];
  if (!record.containerConditionOk) missing.push("containerConditionOk");
  if (!record.sealsIntact) missing.push("sealsIntact");
  if (!record.labelsMatch) missing.push("labelsMatch");
  if (!record.invoiceMatchesPo) missing.push("invoiceMatchesPo");
  if (missing.length > 0) {
    const err = new Error(`Visual inspection incomplete: ${missing.join(", ")} required before advancing.`);
    (err as any).status = 422;
    throw err;
  }
}
```

- [ ] **Step 4: Update updateReceivingRecord with gates 1 and 2**

Replace the existing `updateReceivingRecord` method:

```typescript
async updateReceivingRecord(
  id: string,
  data: Partial<InsertReceivingRecord> & { visualExamAt?: Date },
  actorUserId: string,
  outerTx?: Tx,
): Promise<ReceivingRecord | undefined> {
  const run = async (tx: Tx) => {
    const [existing] = await tx
      .select()
      .from(schema.receivingRecords)
      .where(eq(schema.receivingRecords.id, id));
    if (!existing) return undefined;

    const merged = { ...existing, ...data };

    // Gate 1: QUARANTINED → SAMPLING requires complete visual inspection (FULL_LAB_TEST only)
    if (
      data.status === "SAMPLING" &&
      existing.status === "QUARANTINED" &&
      existing.qcWorkflowType === "FULL_LAB_TEST"
    ) {
      assertVisualInspectionComplete(merged as any);
    }

    // Gate 2: QUARANTINED → PENDING_QC requires complete visual inspection (IDENTITY_CHECK / COA_REVIEW)
    if (
      data.status === "PENDING_QC" &&
      existing.status === "QUARANTINED" &&
      (existing.qcWorkflowType === "IDENTITY_CHECK" || existing.qcWorkflowType === "COA_REVIEW")
    ) {
      assertVisualInspectionComplete(merged as any);
    }

    // F-06: Auto-set visualExamBy snapshot when visual inspection fields are being submitted
    let visualExamBySnapshot: { userId: string | null; fullName: string; title: string | null } | undefined;
    const isSubmittingInspection = data.containerConditionOk || data.sealsIntact || data.labelsMatch || data.invoiceMatchesPo || data.visualExamAt;
    if (isSubmittingInspection && !existing.visualExamBy && actorUserId) {
      const [actor] = await tx
        .select({ fullName: schema.users.fullName, title: schema.users.title })
        .from(schema.users)
        .where(eq(schema.users.id, actorUserId));
      if (actor) {
        visualExamBySnapshot = { userId: actorUserId, fullName: actor.fullName, title: actor.title ?? null };
      }
    }

    const [updated] = await tx
      .update(schema.receivingRecords)
      .set({
        ...data,
        ...(visualExamBySnapshot ? { visualExamBy: visualExamBySnapshot } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.receivingRecords.id, id))
      .returning();

    if (data.status) {
      await tx.update(schema.lots).set({ quarantineStatus: data.status }).where(eq(schema.lots.id, existing.lotId));
    }

    return updated;
  };
  return outerTx ? run(outerTx) : db.transaction(run);
}
```

Note: the method signature now requires `actorUserId`. Update the storage interface and the route handler accordingly:

In `server/storage.ts`, update the interface:
```typescript
updateReceivingRecord(id: string, data: Partial<InsertReceivingRecord>, actorUserId: string, tx?: Tx): Promise<ReceivingRecord | undefined>;
```

In `server/routes.ts`, update the PUT handler call to pass `req.user!.id`:
```typescript
// Change:
(tx) => storage.updateReceivingRecord(req.params.id, data, tx),
// To:
(tx) => storage.updateReceivingRecord(req.params.id, data, req.user!.id, tx),
```

- [ ] **Step 5: Update qcReviewReceivingRecord with Gate 3 + F-06 + auto-qualification**

Replace the existing `qcReviewReceivingRecord` method:

```typescript
async qcReviewReceivingRecord(
  id: string,
  disposition: string,
  reviewedByUserId: string,
  notes?: string,
  outerTx?: Tx,
): Promise<ReceivingRecord | undefined> {
  const run = async (tx: Tx) => {
    const [existing] = await tx
      .select()
      .from(schema.receivingRecords)
      .where(eq(schema.receivingRecords.id, id));
    if (!existing) return undefined;

    assertNotLocked("receiving_record", existing.status);

    const newStatus =
      disposition === "APPROVED" || disposition === "APPROVED_WITH_CONDITIONS" ? "APPROVED" : "REJECTED";
    assertValidTransition("receiving_record", existing.status, newStatus);

    // Gate 3: require at least one COA before APPROVED
    if (newStatus === "APPROVED") {
      const [coa] = await tx
        .select({ id: schema.coaDocuments.id })
        .from(schema.coaDocuments)
        .where(eq(schema.coaDocuments.lotId, existing.lotId))
        .limit(1);
      if (!coa) {
        const err = new Error("Cannot approve: no COA document is linked to this lot. Attach a COA before approving.");
        (err as any).status = 422;
        throw err;
      }
    }

    // F-06: fetch full identity snapshot
    const [reviewer] = await tx
      .select({ fullName: schema.users.fullName, title: schema.users.title })
      .from(schema.users)
      .where(eq(schema.users.id, reviewedByUserId));
    const qcReviewedBy = reviewer
      ? { userId: reviewedByUserId, fullName: reviewer.fullName, title: reviewer.title ?? null }
      : { userId: null, fullName: reviewedByUserId, title: null };

    const [updated] = await tx
      .update(schema.receivingRecords)
      .set({
        status: newStatus,
        qcDisposition: disposition,
        qcReviewedBy,
        qcReviewedAt: new Date(),
        qcNotes: notes ?? existing.qcNotes,
        updatedAt: new Date(),
      })
      .where(eq(schema.receivingRecords.id, id))
      .returning();

    await tx.update(schema.lots).set({ quarantineStatus: newStatus }).where(eq(schema.lots.id, existing.lotId));

    // Auto-create approved_materials entry on first approval
    if (newStatus === "APPROVED" && existing.requiresQualification && existing.supplierId) {
      const [lot] = await tx
        .select({ productId: schema.lots.productId })
        .from(schema.lots)
        .where(eq(schema.lots.id, existing.lotId));
      if (lot?.productId) {
        await tx
          .insert(schema.approvedMaterials)
          .values({
            productId: lot.productId,
            supplierId: existing.supplierId,
            approvedByUserId: reviewedByUserId,
          })
          .onConflictDoUpdate({
            target: [schema.approvedMaterials.productId, schema.approvedMaterials.supplierId],
            set: { isActive: true, approvedByUserId: reviewedByUserId, approvedAt: new Date() },
          });
      }
    }

    return updated!;
  };
  return outerTx ? run(outerTx) : db.transaction(run);
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
DATABASE_URL=$DATABASE_URL pnpm test:integration -- -t "R-01 — state machine gates"
```

Expected: all 5 tests PASS.

- [ ] **Step 7: Run full test suite to check for regressions**

```bash
DATABASE_URL=$DATABASE_URL pnpm test:integration
```

Expected: no new failures. If F-05 or F-06 tests fail due to signature changes, inspect and fix.

- [ ] **Step 8: Commit**

```bash
git add server/db-storage.ts server/storage.ts server/routes.ts server/__tests__/r01-gates.test.ts
git commit -m "feat(r01): state machine gates, F-06 identity snapshot, auto-qualification on first approval"
```

---

### Task 5: GET /api/tasks endpoint

**Goal:** A derived tasks endpoint that returns role-specific actionable items computed from receiving record state — no separate tasks table.

**Files:**
- Modify: `server/storage.ts`
- Modify: `server/db-storage.ts`
- Modify: `server/routes.ts`
- Create: `server/__tests__/r01-tasks.test.ts`

**Acceptance Criteria:**
- [ ] QA user sees: FULL_LAB_TEST lots in QUARANTINED/SAMPLING, requires_qualification lots, PENDING_QC lots
- [ ] RECEIVING user sees: IDENTITY_CHECK lots in QUARANTINED, REJECTED lots
- [ ] PRODUCTION user sees empty array
- [ ] Unauthenticated request gets 401

**Verify:** `DATABASE_URL=<url> pnpm test:integration -- -t "R-01 — tasks endpoint"` → all pass

**Steps:**

- [ ] **Step 1: Define the UserTask type and add to storage interface**

Add to `server/storage.ts`:

```typescript
export interface UserTask {
  id: string; // receivingRecord.id
  taskType:
    | "LAB_TEST_REQUIRED"
    | "QUALIFICATION_REQUIRED"
    | "PENDING_QC"
    | "IDENTITY_CHECK_REQUIRED"
    | "REJECTED_LOT";
  receivingRecordId: string;
  receivingIdentifier: string;
  materialName: string | null;
  supplierName: string | null;
  quantityReceived: string | null;
  uom: string | null;
  dateReceived: string | null;
  isUrgent: boolean;
}

// In IStorage interface:
getUserTasks(userId: string, roles: string[]): Promise<UserTask[]>;
```

- [ ] **Step 2: Write failing integration test**

Create `server/__tests__/r01-tasks.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { storage } from "../storage";
import { hashPassword } from "../auth/password";
import { db } from "../db";
import * as schema from "@shared/schema";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

async function cleanDb() {
  await db.update(schema.validationDocuments).set({ signatureId: null });
  await db.delete(schema.electronicSignatures);
  await db.delete(schema.receivingRecords);
  await db.delete(schema.approvedMaterials);
  await db.delete(schema.auditTrail);
  await db.delete(schema.passwordHistory);
  await db.delete(schema.userRoles);
  await db.delete(schema.users);
}

async function seedReceivingRecord(opts: { status: string; qcWorkflowType: string; requiresQualification?: boolean; productName?: string }) {
  const [product] = await db.insert(schema.products).values({ name: opts.productName ?? "Tasks Test Product", sku: `TASK-${Date.now()}-${Math.random()}`, category: "ACTIVE_INGREDIENT", defaultUom: "g", status: "ACTIVE" }).returning();
  const [supplier] = await db.insert(schema.suppliers).values({ name: "Tasks Test Supplier" }).returning();
  const [lot] = await db.insert(schema.lots).values({ productId: product!.id, lotNumber: `TASK-LOT-${Date.now()}`, supplierName: supplier!.name, quarantineStatus: opts.status }).returning();
  const [record] = await db.insert(schema.receivingRecords).values({
    lotId: lot!.id,
    supplierId: supplier!.id,
    uniqueIdentifier: `RCV-TASK-${Date.now()}`,
    status: opts.status,
    qcWorkflowType: opts.qcWorkflowType,
    requiresQualification: opts.requiresQualification ?? false,
    dateReceived: "2026-04-23",
    quantityReceived: "10",
    uom: "kg",
  }).returning();
  return record!;
}

describeIfDb("R-01 — tasks endpoint", () => {
  let app: Express;
  let adminId: string;
  let qaId: string;
  let receivingId: string;
  let productionId: string;

  beforeAll(async () => { app = await buildTestApp(); });

  beforeEach(async () => {
    await cleanDb();
    const admin = await storage.createUser({ email: "admin@tasks.test", fullName: "Admin", title: null, passwordHash: await hashPassword("Neurogan1!Secure"), roles: ["ADMIN"], createdByUserId: null, grantedByUserId: null });
    adminId = admin.id;
    const qa = await storage.createUser({ email: "qa@tasks.test", fullName: "QA User", title: "QC Manager", passwordHash: await hashPassword("Neurogan1!Secure"), roles: ["QA"], createdByUserId: adminId, grantedByUserId: adminId });
    qaId = qa.id;
    const recv = await storage.createUser({ email: "recv@tasks.test", fullName: "Warehouse User", title: null, passwordHash: await hashPassword("Neurogan1!Secure"), roles: ["RECEIVING"], createdByUserId: adminId, grantedByUserId: adminId });
    receivingId = recv.id;
    const prod = await storage.createUser({ email: "prod@tasks.test", fullName: "Production User", title: null, passwordHash: await hashPassword("Neurogan1!Secure"), roles: ["PRODUCTION"], createdByUserId: adminId, grantedByUserId: adminId });
    productionId = prod.id;
  });

  afterAll(async () => { await cleanDb(); });

  it("GET /api/tasks returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/tasks");
    expect(res.status).toBe(401);
  });

  it("QA user sees FULL_LAB_TEST and PENDING_QC tasks", async () => {
    await seedReceivingRecord({ status: "QUARANTINED", qcWorkflowType: "FULL_LAB_TEST", requiresQualification: true, productName: "Hemp Extract" });
    await seedReceivingRecord({ status: "PENDING_QC", qcWorkflowType: "COA_REVIEW", productName: "Bottles" });

    const res = await request(app).get("/api/tasks").set("x-test-user-id", qaId);
    expect(res.status).toBe(200);
    const tasks = res.body as any[];
    expect(tasks.some((t) => t.taskType === "LAB_TEST_REQUIRED")).toBe(true);
    expect(tasks.some((t) => t.taskType === "PENDING_QC")).toBe(true);
  });

  it("RECEIVING user sees IDENTITY_CHECK tasks", async () => {
    await seedReceivingRecord({ status: "QUARANTINED", qcWorkflowType: "IDENTITY_CHECK", productName: "MCT Oil" });

    const res = await request(app).get("/api/tasks").set("x-test-user-id", receivingId);
    expect(res.status).toBe(200);
    const tasks = res.body as any[];
    expect(tasks.some((t) => t.taskType === "IDENTITY_CHECK_REQUIRED")).toBe(true);
  });

  it("PRODUCTION user sees empty tasks", async () => {
    await seedReceivingRecord({ status: "QUARANTINED", qcWorkflowType: "FULL_LAB_TEST" });
    const res = await request(app).get("/api/tasks").set("x-test-user-id", productionId);
    expect(res.status).toBe(200);
    expect((res.body as any[]).length).toBe(0);
  });
});
```

- [ ] **Step 3: Implement getUserTasks in db-storage.ts**

```typescript
async getUserTasks(userId: string, roles: string[]): Promise<UserTask[]> {
  const tasks: UserTask[] = [];
  const isQa = roles.includes("QA") || roles.includes("ADMIN");
  const isReceiving = roles.includes("RECEIVING") || roles.includes("ADMIN");

  const baseSelect = {
    id: schema.receivingRecords.id,
    receivingIdentifier: schema.receivingRecords.uniqueIdentifier,
    status: schema.receivingRecords.status,
    qcWorkflowType: schema.receivingRecords.qcWorkflowType,
    requiresQualification: schema.receivingRecords.requiresQualification,
    quantityReceived: schema.receivingRecords.quantityReceived,
    uom: schema.receivingRecords.uom,
    dateReceived: schema.receivingRecords.dateReceived,
    materialName: schema.products.name,
    supplierName: schema.suppliers.name,
  };

  if (isQa) {
    // Lab test required
    const labTestRows = await db
      .select(baseSelect)
      .from(schema.receivingRecords)
      .leftJoin(schema.lots, eq(schema.receivingRecords.lotId, schema.lots.id))
      .leftJoin(schema.products, eq(schema.lots.productId, schema.products.id))
      .leftJoin(schema.suppliers, eq(schema.receivingRecords.supplierId, schema.suppliers.id))
      .where(
        and(
          eq(schema.receivingRecords.qcWorkflowType, "FULL_LAB_TEST"),
          sql`${schema.receivingRecords.status} IN ('QUARANTINED', 'SAMPLING')`,
        ),
      );

    for (const row of labTestRows) {
      tasks.push({
        id: `lab-${row.id}`,
        taskType: row.requiresQualification ? "QUALIFICATION_REQUIRED" : "LAB_TEST_REQUIRED",
        receivingRecordId: row.id,
        receivingIdentifier: row.receivingIdentifier,
        materialName: row.materialName ?? null,
        supplierName: row.supplierName ?? null,
        quantityReceived: row.quantityReceived ?? null,
        uom: row.uom ?? null,
        dateReceived: row.dateReceived ?? null,
        isUrgent: !!row.requiresQualification,
      });
    }

    // Pending QC disposition
    const pendingQcRows = await db
      .select(baseSelect)
      .from(schema.receivingRecords)
      .leftJoin(schema.lots, eq(schema.receivingRecords.lotId, schema.lots.id))
      .leftJoin(schema.products, eq(schema.lots.productId, schema.products.id))
      .leftJoin(schema.suppliers, eq(schema.receivingRecords.supplierId, schema.suppliers.id))
      .where(eq(schema.receivingRecords.status, "PENDING_QC"));

    for (const row of pendingQcRows) {
      tasks.push({
        id: `qc-${row.id}`,
        taskType: "PENDING_QC",
        receivingRecordId: row.id,
        receivingIdentifier: row.receivingIdentifier,
        materialName: row.materialName ?? null,
        supplierName: row.supplierName ?? null,
        quantityReceived: row.quantityReceived ?? null,
        uom: row.uom ?? null,
        dateReceived: row.dateReceived ?? null,
        isUrgent: false,
      });
    }
  }

  if (isReceiving) {
    // Identity check required
    const identityCheckRows = await db
      .select(baseSelect)
      .from(schema.receivingRecords)
      .leftJoin(schema.lots, eq(schema.receivingRecords.lotId, schema.lots.id))
      .leftJoin(schema.products, eq(schema.lots.productId, schema.products.id))
      .leftJoin(schema.suppliers, eq(schema.receivingRecords.supplierId, schema.suppliers.id))
      .where(
        and(
          eq(schema.receivingRecords.qcWorkflowType, "IDENTITY_CHECK"),
          eq(schema.receivingRecords.status, "QUARANTINED"),
        ),
      );

    for (const row of identityCheckRows) {
      tasks.push({
        id: `id-check-${row.id}`,
        taskType: "IDENTITY_CHECK_REQUIRED",
        receivingRecordId: row.id,
        receivingIdentifier: row.receivingIdentifier,
        materialName: row.materialName ?? null,
        supplierName: row.supplierName ?? null,
        quantityReceived: row.quantityReceived ?? null,
        uom: row.uom ?? null,
        dateReceived: row.dateReceived ?? null,
        isUrgent: false,
      });
    }

    // Rejected lots
    const rejectedRows = await db
      .select(baseSelect)
      .from(schema.receivingRecords)
      .leftJoin(schema.lots, eq(schema.receivingRecords.lotId, schema.lots.id))
      .leftJoin(schema.products, eq(schema.lots.productId, schema.products.id))
      .leftJoin(schema.suppliers, eq(schema.receivingRecords.supplierId, schema.suppliers.id))
      .where(eq(schema.receivingRecords.status, "REJECTED"));

    for (const row of rejectedRows) {
      tasks.push({
        id: `rejected-${row.id}`,
        taskType: "REJECTED_LOT",
        receivingRecordId: row.id,
        receivingIdentifier: row.receivingIdentifier,
        materialName: row.materialName ?? null,
        supplierName: row.supplierName ?? null,
        quantityReceived: row.quantityReceived ?? null,
        uom: row.uom ?? null,
        dateReceived: row.dateReceived ?? null,
        isUrgent: true,
      });
    }
  }

  return tasks;
}
```

Also add `sql` to the drizzle-orm import if not already present.

- [ ] **Step 4: Add /api/tasks route**

```typescript
app.get("/api/tasks", requireAuth, async (req, res, next) => {
  try {
    const tasks = await storage.getUserTasks(req.user!.id, req.user!.roles);
    res.json(tasks);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Run tests to verify pass**

```bash
DATABASE_URL=$DATABASE_URL pnpm test:integration -- -t "R-01 — tasks endpoint"
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/storage.ts server/db-storage.ts server/routes.ts server/__tests__/r01-tasks.test.ts
git commit -m "feat(r01): add GET /api/tasks derived task list endpoint"
```

---

### Task 6: Dashboard tasks widget

**Goal:** A user-specific tasks widget on the dashboard showing actionable items with links to receiving records. Role-based display: QA sees lab/QC tasks, Warehouse sees identity checks and rejected lots, Production sees empty state.

**Files:**
- Create: `client/src/components/DashboardTasks.tsx`
- Modify: `client/src/pages/dashboard.tsx`

**Acceptance Criteria:**
- [ ] Widget appears on dashboard below the summary strip
- [ ] Tasks from GET /api/tasks render with correct icons and labels
- [ ] Clicking a task navigates to `/receiving` (the receiving page, which handles deep-linking by record ID)
- [ ] Badge on the widget header shows the total task count
- [ ] Empty state shown when no tasks

**Verify:** Start dev server, log in as a QA user who has pending lots, verify tasks appear. Log in as production user, verify empty state.

**Steps:**

- [ ] **Step 1: Create DashboardTasks.tsx**

Create `client/src/components/DashboardTasks.tsx`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlertTriangle, FlaskConical, ClipboardCheck, Search, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface UserTask {
  id: string;
  taskType: "LAB_TEST_REQUIRED" | "QUALIFICATION_REQUIRED" | "PENDING_QC" | "IDENTITY_CHECK_REQUIRED" | "REJECTED_LOT";
  receivingRecordId: string;
  receivingIdentifier: string;
  materialName: string | null;
  supplierName: string | null;
  quantityReceived: string | null;
  uom: string | null;
  dateReceived: string | null;
  isUrgent: boolean;
}

async function fetchTasks(): Promise<UserTask[]> {
  const res = await fetch("/api/tasks", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load tasks");
  return res.json();
}

const TASK_CONFIG: Record<UserTask["taskType"], { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  LAB_TEST_REQUIRED: { label: "Full lab test required", icon: FlaskConical },
  QUALIFICATION_REQUIRED: { label: "New material — qualification required", icon: AlertTriangle },
  PENDING_QC: { label: "Lot pending QC disposition", icon: ClipboardCheck },
  IDENTITY_CHECK_REQUIRED: { label: "Identity check required", icon: Search },
  REJECTED_LOT: { label: "Rejected lot — coordinate return", icon: XCircle },
};

export function DashboardTasks() {
  const [, navigate] = useLocation();
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["dashboard-tasks"],
    queryFn: fetchTasks,
    staleTime: 30_000,
  });

  return (
    <Card data-testid="card-my-tasks">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          My Tasks
          {tasks.length > 0 && (
            <Badge className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0 h-4 ml-1">
              {tasks.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : tasks.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">No tasks right now</div>
        ) : (
          <div className="space-y-1">
            {tasks.map((task) => {
              const config = TASK_CONFIG[task.taskType];
              const Icon = config.icon;
              return (
                <button
                  key={task.id}
                  className="w-full text-left flex items-start gap-2.5 rounded-md p-2 hover:bg-muted transition-colors"
                  onClick={() => navigate(`/receiving?highlight=${task.receivingRecordId}`)}
                  data-testid={`task-item-${task.taskType}`}
                >
                  <Icon
                    className={`h-4 w-4 mt-0.5 shrink-0 ${
                      task.isUrgent ? "text-amber-400" : task.taskType === "REJECTED_LOT" ? "text-destructive" : "text-muted-foreground"
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium leading-tight">{config.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {task.materialName ?? "Unknown material"}
                      {task.supplierName ? ` · ${task.supplierName}` : ""}
                      {task.quantityReceived ? ` · ${task.quantityReceived} ${task.uom ?? ""}` : ""}
                      {task.dateReceived ? ` · ${task.receivingIdentifier}` : ""}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Add DashboardTasks to dashboard.tsx**

In `client/src/pages/dashboard.tsx`, add the import:

```typescript
import { DashboardTasks } from "@/components/DashboardTasks";
```

Then in the return JSX, add the widget after the summary strip and before the main 2-col grid. Find the `{/* Top row: Production Batches + Open POs */}` comment and insert before it:

```typescript
      {/* Tasks widget */}
      <DashboardTasks />

      {/* Top row: Production Batches + Open POs */}
```

- [ ] **Step 3: Verify in browser**

```bash
pnpm dev
```

Open `http://localhost:5000` (or whatever the dev port is), log in, and verify:
- Tasks widget appears on dashboard with "No tasks right now" if no pending lots
- Creating a receiving record for an unapproved material and checking dashboard shows the task

- [ ] **Step 4: Commit**

```bash
git add client/src/components/DashboardTasks.tsx client/src/pages/dashboard.tsx
git commit -m "feat(r01): add role-specific tasks widget to dashboard"
```

---

### Task 7: Settings UI — Labs and Approved Materials tabs

**Goal:** Two new tabs in Settings — "Labs" (CRUD for labs registry) and "Approved Materials" (read-only list with revoke action). Both visible to ADMIN and QA.

**Files:**
- Create: `client/src/pages/settings/LabsSettings.tsx`
- Create: `client/src/pages/settings/ApprovedMaterials.tsx`
- Modify: `client/src/pages/settings.tsx`

**Acceptance Criteria:**
- [ ] "Labs" tab appears in Settings for ADMIN and QA users
- [ ] Labs tab lists all labs with name, type badge, address, active status
- [ ] Add lab form creates a new lab
- [ ] Deactivate toggle soft-deletes (sets isActive=false)
- [ ] "Approved Materials" tab lists all entries with product name, supplier name, approver, date
- [ ] Revoke button on each entry calls DELETE /api/approved-materials/:id

**Verify:** Start dev server, open Settings as admin user, verify both tabs appear and are functional.

**Steps:**

- [ ] **Step 1: Create LabsSettings.tsx**

Create `client/src/pages/settings/LabsSettings.tsx`:

```typescript
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Lab {
  id: string;
  name: string;
  address: string | null;
  type: "IN_HOUSE" | "THIRD_PARTY";
  isActive: boolean;
  createdAt: string;
}

async function fetchLabs(): Promise<Lab[]> {
  const res = await fetch("/api/labs", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load labs");
  return res.json();
}

async function createLab(data: { name: string; address: string; type: string }): Promise<Lab> {
  const res = await fetch("/api/labs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create lab");
  return res.json();
}

async function patchLab(id: string, data: Partial<Lab>): Promise<Lab> {
  const res = await fetch(`/api/labs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update lab");
  return res.json();
}

export function LabsSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: labs = [], isLoading } = useQuery({ queryKey: ["labs"], queryFn: fetchLabs });

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [type, setType] = useState<"IN_HOUSE" | "THIRD_PARTY">("THIRD_PARTY");

  const createMutation = useMutation({
    mutationFn: createLab,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labs"] });
      setName("");
      setAddress("");
      setType("THIRD_PARTY");
      toast({ title: "Lab added" });
    },
    onError: () => toast({ title: "Failed to add lab", variant: "destructive" }),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Lab> }) => patchLab(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labs"] });
      toast({ title: "Lab updated" });
    },
    onError: () => toast({ title: "Failed to update lab", variant: "destructive" }),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1">Testing Labs</h2>
        <p className="text-sm text-muted-foreground">Approved labs for COA testing. COA documents must reference a lab from this list.</p>
      </div>

      <div className="border rounded-lg overflow-hidden">
        {labs.map((lab) => (
          <div key={lab.id} className="flex items-center justify-between px-4 py-3 border-b last:border-b-0">
            <div>
              <div className="text-sm font-medium flex items-center gap-2">
                {lab.name}
                <Badge variant={lab.type === "IN_HOUSE" ? "default" : "secondary"} className="text-[10px]">
                  {lab.type === "IN_HOUSE" ? "In-House" : "Third Party"}
                </Badge>
                {!lab.isActive && <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>}
              </div>
              {lab.address && <div className="text-xs text-muted-foreground mt-0.5">{lab.address}</div>}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => patchMutation.mutate({ id: lab.id, data: { isActive: !lab.isActive } })}
            >
              {lab.isActive ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
        ))}
        {labs.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground text-center">No labs configured.</div>
        )}
      </div>

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
              <SelectTrigger className="mt-1 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="IN_HOUSE">In-House</SelectItem>
                <SelectItem value="THIRD_PARTY">Third Party</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => createMutation.mutate({ name, address, type })}
          disabled={!name || createMutation.isPending}
        >
          Add lab
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create ApprovedMaterials.tsx**

Create `client/src/pages/settings/ApprovedMaterials.tsx`:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

interface ApprovedMaterialEntry {
  id: string;
  productName: string;
  productSku: string;
  supplierName: string;
  approvedByName: string;
  approvedAt: string;
  notes: string | null;
  isActive: boolean;
}

async function fetchApprovedMaterials(): Promise<ApprovedMaterialEntry[]> {
  const res = await fetch("/api/approved-materials", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load approved materials");
  return res.json();
}

async function revokeApprovedMaterial(id: string): Promise<void> {
  const res = await fetch(`/api/approved-materials/${id}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) throw new Error("Failed to revoke");
}

export function ApprovedMaterialsSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useQuery({ queryKey: ["approved-materials"], queryFn: fetchApprovedMaterials });

  const revokeMutation = useMutation({
    mutationFn: revokeApprovedMaterial,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approved-materials"] });
      qc.invalidateQueries({ queryKey: ["dashboard-tasks"] });
      toast({ title: "Approval revoked. Future receipts of this material will require re-qualification." });
    },
    onError: () => toast({ title: "Failed to revoke approval", variant: "destructive" }),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold mb-1">Approved Materials</h2>
        <p className="text-sm text-muted-foreground">
          Materials and supplier combinations approved for receiving. Created automatically on first QC approval of a new material.
          Revoking forces re-qualification on the next receipt.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4">
          No approved materials yet. They appear here automatically after a new material is received and QC-approved for the first time.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Material</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Approved by</TableHead>
              <TableHead>Date</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="font-medium text-sm">{item.productName}</div>
                  <div className="text-xs text-muted-foreground">{item.productSku}</div>
                </TableCell>
                <TableCell className="text-sm">{item.supplierName}</TableCell>
                <TableCell className="text-sm">{item.approvedByName}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(item.approvedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-destructive hover:text-destructive"
                    onClick={() => revokeMutation.mutate(item.id)}
                    disabled={revokeMutation.isPending}
                  >
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add tabs to settings.tsx**

In `client/src/pages/settings.tsx`:

1. Add lazy imports near the other lazy imports at the top of the file:

```typescript
const LazyLabsSettings = lazy(() => import("@/pages/settings/LabsSettings").then((m) => ({ default: m.LabsSettings })));
const LazyApprovedMaterials = lazy(() => import("@/pages/settings/ApprovedMaterials").then((m) => ({ default: m.ApprovedMaterialsSettings })));

function LabsEmbed() {
  return <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}><LazyLabsSettings /></Suspense>;
}

function ApprovedMaterialsEmbed() {
  return <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}><LazyApprovedMaterials /></Suspense>;
}
```

2. Add `"labs"` and `"approved-materials"` to the `SettingsTab` type:

```typescript
type SettingsTab = "settings" | "locations" | "sku-manager" | "users" | "validation" | "labs" | "approved-materials";
```

3. Add two tab buttons after the "System Validation" tab button (visible to ADMIN or QA):

```typescript
{(isAdmin || isQa) && (
  <button
    onClick={() => setActiveTab("labs")}
    className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === "labs" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
  >
    Labs
    {activeTab === "labs" && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-t-full" />}
  </button>
)}
{(isAdmin || isQa) && (
  <button
    onClick={() => setActiveTab("approved-materials")}
    className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === "approved-materials" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
  >
    Approved Materials
    {activeTab === "approved-materials" && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-t-full" />}
  </button>
)}
```

4. Add tab content rendering:

```typescript
{activeTab === "labs" && <LabsEmbed />}
{activeTab === "approved-materials" && <ApprovedMaterialsEmbed />}
```

Note: check where `isQa` is derived in settings.tsx. If it doesn't exist, add it alongside `isAdmin`: `const isQa = user?.roles?.some((r) => r === "QA") ?? false;`

- [ ] **Step 4: Verify in browser**

```bash
pnpm dev
```

Navigate to Settings as admin. Verify "Labs" and "Approved Materials" tabs appear, labs list shows seeded labs, add-lab form works.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/settings/LabsSettings.tsx client/src/pages/settings/ApprovedMaterials.tsx client/src/pages/settings.tsx
git commit -m "feat(r01): add Labs and Approved Materials tabs to Settings"
```

---

### Task 8: Receiving UI — workflow type banner and qualification flag

**Goal:** Show a "NEW MATERIAL — Qualification required" banner on receiving records that have `requires_qualification = true`, and show the workflow type badge so warehouse and lab staff know what's expected of them.

**Files:**
- Modify: `client/src/pages/receiving.tsx`

**Acceptance Criteria:**
- [ ] Records with `requires_qualification = true` show an amber banner: "New material — QC qualification required before release"
- [ ] A workflow type badge shows on each record: "Full Lab Test", "Identity Check", "COA Review", or "Exempt"
- [ ] The `visualExamBy` text input is removed from the visual inspection form (server now auto-captures it from the session)
- [ ] `visualExamBy` snapshot is displayed as read-only in the inspection summary when already set

**Verify:** Start dev server. Create a receiving record for an unapproved ACTIVE_INGREDIENT. Verify banner appears. Complete visual inspection — verify the form no longer has a "Visual Exam By" text input.

**Steps:**

- [ ] **Step 1: Add workflow type badge and qualification banner to the receiving detail panel**

In `client/src/pages/receiving.tsx`, find where the receiving record detail is rendered. Locate the section that shows the record header/status and add:

```typescript
{/* Qualification banner */}
{selectedRecord.requiresQualification && (
  <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400 mb-3">
    <AlertTriangle className="h-4 w-4 shrink-0" />
    <span>New material — QC qualification required before release to inventory</span>
  </div>
)}

{/* Workflow type badge */}
{selectedRecord.qcWorkflowType && (
  <div className="flex items-center gap-2 mb-3">
    <span className="text-xs text-muted-foreground">QC Workflow:</span>
    <Badge variant="secondary" className="text-xs">
      {selectedRecord.qcWorkflowType === "FULL_LAB_TEST" && "Full Lab Test"}
      {selectedRecord.qcWorkflowType === "IDENTITY_CHECK" && "Identity Check"}
      {selectedRecord.qcWorkflowType === "COA_REVIEW" && "COA Review"}
      {selectedRecord.qcWorkflowType === "EXEMPT" && "Exempt"}
    </Badge>
  </div>
)}
```

Add `AlertTriangle` to the lucide-react import if not already present.

- [ ] **Step 2: Remove the visualExamBy text input from the visual inspection form**

Find the input field for `visualExamBy` in the visual inspection form section. It looks like:

```typescript
// Remove this input:
<Input
  value={inspectionForm.visualExamBy ?? ""}
  onChange={(e) => setInspectionForm({ ...inspectionForm, visualExamBy: e.target.value })}
  placeholder="Inspector name"
/>
```

Remove the input and its label. Also remove `visualExamBy` from the inspection form state and from the PUT request body when submitting the inspection.

- [ ] **Step 3: Display the visualExamBy snapshot as read-only when already set**

Where the inspection "signed off by" details are shown (after inspection is complete), update to render from the jsonb snapshot:

```typescript
{selectedRecord.visualExamBy && typeof selectedRecord.visualExamBy === "object" && (
  <span className="text-sm text-muted-foreground">
    Inspected by {(selectedRecord.visualExamBy as any).fullName}
    {(selectedRecord.visualExamBy as any).title ? ` (${(selectedRecord.visualExamBy as any).title})` : ""}
  </span>
)}
```

Similarly update `qcReviewedBy` display to render the jsonb snapshot:

```typescript
{selectedRecord.qcReviewedBy && typeof selectedRecord.qcReviewedBy === "object" && (
  <span>
    {(selectedRecord.qcReviewedBy as any).fullName}
    {(selectedRecord.qcReviewedBy as any).title ? ` · ${(selectedRecord.qcReviewedBy as any).title}` : ""}
  </span>
)}
```

- [ ] **Step 4: Update TypeScript types for the receiving record**

In `receiving.tsx`, update any local type definitions to reflect that `visualExamBy` and `qcReviewedBy` are now `object | null` instead of `string | null`:

```typescript
interface ReceivingRecordDetail {
  // ... existing fields ...
  visualExamBy: { userId: string | null; fullName: string; title: string | null } | null;
  qcReviewedBy: { userId: string | null; fullName: string; title: string | null } | null;
  requiresQualification: boolean;
  qcWorkflowType: "FULL_LAB_TEST" | "IDENTITY_CHECK" | "COA_REVIEW" | "EXEMPT" | null;
}
```

- [ ] **Step 5: Verify typecheck passes**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Verify in browser**

```bash
pnpm dev
```

1. Create a receiving record for an active ingredient from an unapproved supplier → amber banner and "Full Lab Test" badge appear
2. Complete visual inspection → no "Visual Exam By" input, submit works, snapshot displays correctly
3. Create a receiving record for primary packaging → "COA Review" badge, no qualification banner

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/receiving.tsx
git commit -m "feat(r01): receiving UI — workflow type badge, qualification banner, F-06 display"
```

---

## Final verification

After all tasks are complete, run the full test suite:

```bash
pnpm typecheck && DATABASE_URL=$DATABASE_URL pnpm test:integration && pnpm test
```

Expected: all existing tests pass, all new R-01 tests pass, 0 typecheck errors.
