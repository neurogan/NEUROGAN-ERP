# R-06 Returned Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the returned-product quarantine → QA-disposition → investigation-trigger workflow to close FDA Form 483 Obs 12 (§111.503/510/513).

**Architecture:** Two new DB tables (`erp_returned_products`, `erp_return_investigations`), a standalone storage module (`server/storage/returned-products.ts`) mirroring the complaints pattern, seven new API routes, three frontend pages under the Quality tab, and two new dashboard tiles. The investigation trigger fires automatically inside the intake transaction when a lot's return count hits the configurable `returnsInvestigationThresholdCount` app-setting. Both disposition and investigation-close use the F-04 inline ceremony (password verified outside transaction, atomic tx: sig row → record update → audit rows).

**Tech Stack:** PostgreSQL + Drizzle ORM, Express, Zod, React + TanStack Query + wouter, shadcn/ui, Vitest + supertest.

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `migrations/0020_r06_returned_product.sql` | DDL for both tables + app_settings seed |
| `server/storage/returned-products.ts` | All storage functions: intake, list, get, signDisposition, investigations, summary |
| `server/__tests__/r06-returned-products.storage.test.ts` | Storage unit tests |
| `server/__tests__/r06-returned-products.routes.test.ts` | Route integration tests |
| `client/src/pages/quality/returns.tsx` | Returns list + intake modal |
| `client/src/pages/quality/ReturnDetail.tsx` | Return detail + F-04 disposition ceremony |
| `client/src/pages/quality/ReturnInvestigations.tsx` | Investigations list + F-04 close ceremony |

### Modified files
| File | Change |
|---|---|
| `migrations/meta/_journal.json` | Add idx 20 entry |
| `shared/schema.ts` | 2 new tables, new type literals, new enum values |
| `server/signatures/signatures.ts` | 2 new entries in `MEANING_VERB` |
| `server/storage.ts` | `ReturnTaskType`, update `UserTask` union types |
| `server/db-storage.ts` | Import returned-products storage, add tasks, add `getReturnsSummary` delegation |
| `server/routes.ts` | 7 new routes + 1 summary route |
| `server/storage/complaints.ts` | `getComplaintsSummary` SLA-split carry-over fix |
| `client/src/pages/quality/index.tsx` | Enable Returns subtab |
| `client/src/App.tsx` | Add 3 return page routes |
| `client/src/pages/dashboard.tsx` | 2 new return tiles + SLA display fix |

---

## Task 0: Migration + schema foundation

**Goal:** Create migration 0020, add two tables to schema.ts, extend enums, register in journal.

**Files:**
- Create: `migrations/0020_r06_returned_product.sql`
- Modify: `migrations/meta/_journal.json`
- Modify: `shared/schema.ts`
- Modify: `server/signatures/signatures.ts`
- Modify: `server/storage.ts`

**Acceptance Criteria:**
- [ ] `pnpm migrate:up` applies cleanly against a fresh DB
- [ ] `pnpm check:migrations` passes
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm migrate:up && pnpm check:migrations && pnpm typecheck` → no errors

**Steps:**

- [ ] **Step 1: Create migration SQL**

Create `migrations/0020_r06_returned_product.sql`:

```sql
-- 0020: R-06 Returned Product module.
-- Closes FDA Form 483 Obs 12 (§111.503, §111.510, §111.513).
-- Adds 2 tables: erp_returned_products, erp_return_investigations.
-- Seeds 1 app_settings_kv key.

-- ── 1. erp_returned_products ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "erp_returned_products" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "return_ref"                  text NOT NULL UNIQUE,
  "source"                      text NOT NULL
                                  CHECK ("source" IN ('AMAZON_FBA','WHOLESALE','OTHER')),
  "lot_id"                      varchar REFERENCES "erp_lots"("id"),
  "lot_code_raw"                text NOT NULL,
  "qty_returned"                integer NOT NULL,
  "uom"                         text NOT NULL,
  "wholesale_customer_name"     text,
  "carrier_tracking_ref"        text,
  "received_by_user_id"         uuid NOT NULL REFERENCES "erp_users"("id"),
  "received_at"                 timestamptz NOT NULL,
  "condition_notes"             text,
  "status"                      text NOT NULL DEFAULT 'QUARANTINE'
                                  CHECK ("status" IN ('QUARANTINE','DISPOSED')),
  "disposition"                 text
                                  CHECK ("disposition" IN ('RETURN_TO_INVENTORY','DESTROY')),
  "disposition_notes"           text,
  "disposition_signature_id"    uuid REFERENCES "erp_electronic_signatures"("id"),
  "dispositioned_by_user_id"    uuid REFERENCES "erp_users"("id"),
  "dispositioned_at"            timestamptz,
  "investigation_triggered"     boolean NOT NULL DEFAULT false,
  "created_by_user_id"          uuid NOT NULL REFERENCES "erp_users"("id"),
  "created_at"                  timestamptz NOT NULL DEFAULT now(),
  "updated_at"                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "returned_products_status_idx"      ON "erp_returned_products" ("status");
CREATE INDEX IF NOT EXISTS "returned_products_lot_id_idx"      ON "erp_returned_products" ("lot_id");
CREATE INDEX IF NOT EXISTS "returned_products_received_at_idx" ON "erp_returned_products" ("received_at");

-- ── 2. erp_return_investigations ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "erp_return_investigations" (
  "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "lot_id"                  varchar NOT NULL REFERENCES "erp_lots"("id"),
  "triggered_at"            timestamptz NOT NULL,
  "returns_count"           integer NOT NULL,
  "threshold_at_trigger"    integer NOT NULL,
  "status"                  text NOT NULL DEFAULT 'OPEN'
                              CHECK ("status" IN ('OPEN','CLOSED')),
  "root_cause"              text,
  "corrective_action"       text,
  "closed_by_user_id"       uuid REFERENCES "erp_users"("id"),
  "closed_at"               timestamptz,
  "close_signature_id"      uuid REFERENCES "erp_electronic_signatures"("id"),
  "created_at"              timestamptz NOT NULL DEFAULT now(),
  "updated_at"              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "return_investigations_lot_id_idx" ON "erp_return_investigations" ("lot_id");
CREATE INDEX IF NOT EXISTS "return_investigations_status_idx" ON "erp_return_investigations" ("status");

-- ── 3. App settings ──────────────────────────────────────────────────────────

INSERT INTO "erp_app_settings_kv" ("key", "value") VALUES
  ('returnsInvestigationThresholdCount', '3')
ON CONFLICT ("key") DO NOTHING;
```

- [ ] **Step 2: Register migration in journal**

In `migrations/meta/_journal.json`, append after the last entry (idx 19):

```json
    {
      "idx": 20,
      "version": "7",
      "when": 1745501200000,
      "tag": "0020_r06_returned_product",
      "breakpoints": true
    }
```

- [ ] **Step 3: Add schema types and tables to `shared/schema.ts`**

After the last line of the file (after `export type SaerSubmission = typeof saerSubmissions.$inferSelect;`), append:

```typescript
// ─── R-06 Returned Products ────────────────────────────────────────────────

export type ReturnSource = "AMAZON_FBA" | "WHOLESALE" | "OTHER";
export type ReturnedProductStatus = "QUARANTINE" | "DISPOSED";
export type ReturnDisposition = "RETURN_TO_INVENTORY" | "DESTROY";
export type ReturnInvestigationStatus = "OPEN" | "CLOSED";

export const returnedProducts = pgTable("erp_returned_products", {
  id:                     uuid("id").primaryKey().defaultRandom(),
  returnRef:              text("return_ref").notNull().unique(),
  source:                 text("source").$type<ReturnSource>().notNull(),
  lotId:                  varchar("lot_id").references(() => lots.id),
  lotCodeRaw:             text("lot_code_raw").notNull(),
  qtyReturned:            integer("qty_returned").notNull(),
  uom:                    text("uom").notNull(),
  wholesaleCustomerName:  text("wholesale_customer_name"),
  carrierTrackingRef:     text("carrier_tracking_ref"),
  receivedByUserId:       uuid("received_by_user_id").notNull().references(() => users.id),
  receivedAt:             timestamp("received_at", { withTimezone: true }).notNull(),
  conditionNotes:         text("condition_notes"),
  status:                 text("status").$type<ReturnedProductStatus>().notNull().default("QUARANTINE"),
  disposition:            text("disposition").$type<ReturnDisposition>(),
  dispositionNotes:       text("disposition_notes"),
  dispositionSignatureId: uuid("disposition_signature_id").references(() => electronicSignatures.id),
  dispositionedByUserId:  uuid("dispositioned_by_user_id").references(() => users.id),
  dispositionedAt:        timestamp("dispositioned_at", { withTimezone: true }),
  investigationTriggered: boolean("investigation_triggered").notNull().default(false),
  createdByUserId:        uuid("created_by_user_id").notNull().references(() => users.id),
  createdAt:              timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:              timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReturnedProduct = typeof returnedProducts.$inferSelect;
export const insertReturnedProductSchema = createInsertSchema(returnedProducts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReturnedProduct = z.infer<typeof insertReturnedProductSchema>;

export const returnInvestigations = pgTable("erp_return_investigations", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  lotId:              varchar("lot_id").notNull().references(() => lots.id),
  triggeredAt:        timestamp("triggered_at", { withTimezone: true }).notNull(),
  returnsCount:       integer("returns_count").notNull(),
  thresholdAtTrigger: integer("threshold_at_trigger").notNull(),
  status:             text("status").$type<ReturnInvestigationStatus>().notNull().default("OPEN"),
  rootCause:          text("root_cause"),
  correctiveAction:   text("corrective_action"),
  closedByUserId:     uuid("closed_by_user_id").references(() => users.id),
  closedAt:           timestamp("closed_at", { withTimezone: true }),
  closeSignatureId:   uuid("close_signature_id").references(() => electronicSignatures.id),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReturnInvestigation = typeof returnInvestigations.$inferSelect;
export const insertReturnInvestigationSchema = createInsertSchema(returnInvestigations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReturnInvestigation = z.infer<typeof insertReturnInvestigationSchema>;
```

- [ ] **Step 4: Extend enums in `shared/schema.ts`**

In `signatureMeaningEnum` (around line 978), add two entries before the closing `]);`:
```typescript
  "RETURNED_PRODUCT_DISPOSITION",
  "RETURN_INVESTIGATION_CLOSE",
```

In `auditActionEnum` (around line 896), add after the `"SAER_ACKNOWLEDGED"` line:
```typescript
  // R-06 Returned Products
  "RETURN_INTAKE",
  "RETURN_DISPOSITION_SIGNED",
  "RETURN_INVESTIGATION_OPENED",
  "RETURN_INVESTIGATION_CLOSED",
```

- [ ] **Step 5: Add verb entries to `server/signatures/signatures.ts`**

In `MEANING_VERB` (line 33), add after `"SOP_RETIRED": "retired SOP for",`:
```typescript
  RETURNED_PRODUCT_DISPOSITION: "issued return disposition for",
  RETURN_INVESTIGATION_CLOSE: "closed return investigation for",
```

Note: `RETURN_DISPOSITION` already exists in the enum for a different usage — `RETURNED_PRODUCT_DISPOSITION` is the new R-06 meaning.

- [ ] **Step 6: Add `ReturnTaskType` to `server/storage.ts`**

After the `ComplaintTaskType` definition (around line 53), add:
```typescript
export type ReturnTaskType =
  | "RETURN_PENDING_DISPOSITION"
  | "RETURN_INVESTIGATION_OPEN";
```

Update the `UserTask` interface `taskType` field from:
```typescript
  taskType: ReceivingTaskType | ComplaintTaskType;
```
to:
```typescript
  taskType: ReceivingTaskType | ComplaintTaskType | ReturnTaskType;
```

Update the `sourceModule` field from:
```typescript
  sourceModule: "RECEIVING" | "COMPLAINT";
```
to:
```typescript
  sourceModule: "RECEIVING" | "COMPLAINT" | "RETURN";
```

- [ ] **Step 7: Verify**

```bash
pnpm migrate:up && pnpm check:migrations && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add migrations/0020_r06_returned_product.sql migrations/meta/_journal.json shared/schema.ts server/signatures/signatures.ts server/storage.ts
git commit -m "feat(r06): migration 0020, schema tables, enum extensions"
```

---

## Task 1: Storage layer — intake, list, get, investigations

**Goal:** Implement all storage functions for returned products and return investigations in a standalone module.

**Files:**
- Create: `server/storage/returned-products.ts`
- Test: `server/__tests__/r06-returned-products.storage.test.ts`

**Acceptance Criteria:**
- [ ] `createReturnIntake` creates a `QUARANTINE` record with `RET-YYYYMMDD-NNN` ref
- [ ] `createReturnIntake` opens an investigation when lot count ≥ threshold
- [ ] A second intake for the same lot does NOT open a second investigation when one is already open
- [ ] `listReturnedProducts` filters by status and lotId
- [ ] `getReturnedProduct` throws 404 for unknown ID

**Verify:** `pnpm test r06-returned-products.storage` → all pass

**Steps:**

- [ ] **Step 1: Write the failing tests first**

Create `server/__tests__/r06-returned-products.storage.test.ts`:

```typescript
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
    await db.insert(schema.appSettingsKv).values({ key: `returnsInvestigationThresholdCount`, value: "2" })
      .onConflictDoUpdate({ target: schema.appSettingsKv.key, set: { value: "2" } });

    await returnsStorage.createReturnIntake({ source: "AMAZON_FBA", lotCodeRaw: "x", lotId, qtyReturned: 1, uom: "UNITS", receivedAt: new Date(), userId, requestId: "r1", route: "/" });
    const { investigationOpened } = await returnsStorage.createReturnIntake({ source: "AMAZON_FBA", lotCodeRaw: "x", lotId, qtyReturned: 1, uom: "UNITS", receivedAt: new Date(), userId, requestId: "r2", route: "/" });

    expect(investigationOpened).toBe(true);
    const invs = await returnsStorage.listReturnInvestigations({ lotId });
    expect(invs).toHaveLength(1);
    expect(invs[0].status).toBe("OPEN");

    // Reset threshold
    await db.insert(schema.appSettingsKv).values({ key: `returnsInvestigationThresholdCount`, value: "3" })
      .onConflictDoUpdate({ target: schema.appSettingsKv.key, set: { value: "3" } });
  });

  it("does NOT open a second investigation when one is already open", async () => {
    await db.insert(schema.appSettingsKv).values({ key: `returnsInvestigationThresholdCount`, value: "1" })
      .onConflictDoUpdate({ target: schema.appSettingsKv.key, set: { value: "1" } });

    await returnsStorage.createReturnIntake({ source: "AMAZON_FBA", lotCodeRaw: "x", lotId, qtyReturned: 1, uom: "UNITS", receivedAt: new Date(), userId, requestId: "r1", route: "/" });
    const { investigationOpened } = await returnsStorage.createReturnIntake({ source: "AMAZON_FBA", lotCodeRaw: "x", lotId, qtyReturned: 1, uom: "UNITS", receivedAt: new Date(), userId, requestId: "r2", route: "/" });

    expect(investigationOpened).toBe(false);
    expect(await returnsStorage.listReturnInvestigations({ lotId })).toHaveLength(1);

    await db.insert(schema.appSettingsKv).values({ key: `returnsInvestigationThresholdCount`, value: "3" })
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
```

- [ ] **Step 2: Run tests — expect failures**

```bash
pnpm test r06-returned-products.storage
```

Expected: FAIL — `Cannot find module '../storage/returned-products'`

- [ ] **Step 3: Implement `server/storage/returned-products.ts`**

```typescript
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, ilike, desc, sql } from "drizzle-orm";
import { storage } from "../storage";
import { verifyPassword } from "../auth/password";

function throwStatus(status: number, msg: string, code?: string): never {
  throw Object.assign(new Error(msg), { status, code });
}

async function getNextReturnRef(): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `RET-${today}`;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.returnedProducts)
    .where(sql`${schema.returnedProducts.returnRef} LIKE ${prefix + "%"}`);
  const seq = (row?.count ?? 0) + 1;
  return `RET-${today}-${String(seq).padStart(3, "0")}`;
}

async function getThreshold(): Promise<number> {
  const [row] = await db
    .select()
    .from(schema.appSettingsKv)
    .where(eq(schema.appSettingsKv.key, "returnsInvestigationThresholdCount"));
  return row ? parseInt(row.value, 10) : 3;
}

export async function createReturnIntake(input: {
  source: schema.ReturnSource;
  lotCodeRaw: string;
  lotId?: string | null;
  qtyReturned: number;
  uom: string;
  wholesaleCustomerName?: string | null;
  carrierTrackingRef?: string | null;
  conditionNotes?: string | null;
  receivedAt: Date;
  userId: string;
  requestId: string;
  route: string;
}): Promise<{ returnedProduct: schema.ReturnedProduct; investigationOpened: boolean }> {
  let lotId = input.lotId ?? null;
  if (!lotId) {
    const [lotRow] = await db
      .select({ id: schema.lots.id })
      .from(schema.lots)
      .where(ilike(schema.lots.lotNumber, input.lotCodeRaw));
    lotId = lotRow?.id ?? null;
  }

  const returnRef = await getNextReturnRef();
  const threshold = await getThreshold();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.returnedProducts)
      .values({
        returnRef,
        source: input.source,
        lotId,
        lotCodeRaw: input.lotCodeRaw,
        qtyReturned: input.qtyReturned,
        uom: input.uom,
        wholesaleCustomerName: input.wholesaleCustomerName ?? null,
        carrierTrackingRef: input.carrierTrackingRef ?? null,
        conditionNotes: input.conditionNotes ?? null,
        receivedByUserId: input.userId,
        receivedAt: input.receivedAt,
        status: "QUARANTINE",
        createdByUserId: input.userId,
      })
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: input.userId,
      action: "RETURN_INTAKE",
      entityType: "returned_product",
      entityId: row!.id,
      before: null,
      after: { status: "QUARANTINE", returnRef, lotId, source: input.source },
      requestId: input.requestId,
      route: input.route,
    });

    let investigationOpened = false;

    if (lotId) {
      const [{ count: returnsCount }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.returnedProducts)
        .where(eq(schema.returnedProducts.lotId, lotId));

      const [openInv] = await tx
        .select({ id: schema.returnInvestigations.id })
        .from(schema.returnInvestigations)
        .where(and(
          eq(schema.returnInvestigations.lotId, lotId),
          eq(schema.returnInvestigations.status, "OPEN"),
        ));

      if (returnsCount >= threshold && !openInv) {
        const [inv] = await tx
          .insert(schema.returnInvestigations)
          .values({
            lotId,
            triggeredAt: new Date(),
            returnsCount,
            thresholdAtTrigger: threshold,
          })
          .returning();

        await tx
          .update(schema.returnedProducts)
          .set({ investigationTriggered: true })
          .where(eq(schema.returnedProducts.id, row!.id));

        await tx.insert(schema.auditTrail).values({
          userId: input.userId,
          action: "RETURN_INVESTIGATION_OPENED",
          entityType: "return_investigation",
          entityId: inv!.id,
          before: null,
          after: { lotId, returnsCount, threshold },
          requestId: input.requestId,
          route: input.route,
        });

        investigationOpened = true;
      }
    }

    const [finalRow] = await tx
      .select()
      .from(schema.returnedProducts)
      .where(eq(schema.returnedProducts.id, row!.id));

    return { returnedProduct: finalRow!, investigationOpened };
  });
}

export async function listReturnedProducts(filters?: {
  status?: schema.ReturnedProductStatus;
  lotId?: string;
}): Promise<schema.ReturnedProduct[]> {
  let query = db.select().from(schema.returnedProducts).$dynamic();
  if (filters?.status) query = query.where(eq(schema.returnedProducts.status, filters.status));
  if (filters?.lotId) query = query.where(eq(schema.returnedProducts.lotId, filters.lotId));
  return query.orderBy(desc(schema.returnedProducts.receivedAt));
}

export async function getReturnedProduct(id: string): Promise<schema.ReturnedProduct> {
  const [row] = await db
    .select()
    .from(schema.returnedProducts)
    .where(eq(schema.returnedProducts.id, id));
  if (!row) throwStatus(404, "Returned product not found");
  return row!;
}

export async function signDisposition(input: {
  returnedProductId: string;
  userId: string;
  password: string;
  disposition: schema.ReturnDisposition;
  dispositionNotes?: string | null;
  requestId: string;
  route: string;
}): Promise<schema.ReturnedProduct> {
  const rp = await getReturnedProduct(input.returnedProductId);
  if (rp.status !== "QUARANTINE") {
    throwStatus(409, "Return is not in QUARANTINE status", "INVALID_TRANSITION");
  }
  if (!rp.lotId) {
    throwStatus(409, "Lot must be confirmed before signing disposition", "LOT_UNRESOLVED");
  }

  const fullUser = await storage.getUserByEmail(
    await storage.getUserById(input.userId).then((u) => {
      if (!u) throwStatus(404, "User not found");
      return u!.email;
    }),
  );
  if (!fullUser) throwStatus(404, "User not found");
  if (fullUser.lockedUntil && fullUser.lockedUntil > new Date()) {
    throwStatus(423, "Account temporarily locked", "ACCOUNT_LOCKED");
  }
  const valid = await verifyPassword(fullUser.passwordHash, input.password);
  if (!valid) {
    await storage.recordFailedLogin(fullUser.id);
    throwStatus(401, "Password is incorrect.", "UNAUTHENTICATED");
  }
  await storage.recordSuccessfulLogin(fullUser.id);

  const signedAt = new Date();
  const titlePart = fullUser.title ? ` (${fullUser.title})` : "";

  return db.transaction(async (tx) => {
    const [sigRow] = await tx
      .insert(schema.electronicSignatures)
      .values({
        userId: fullUser.id,
        meaning: "RETURNED_PRODUCT_DISPOSITION",
        entityType: "returned_product",
        entityId: input.returnedProductId,
        commentary: null,
        fullNameAtSigning: fullUser.fullName,
        titleAtSigning: fullUser.title ?? null,
        requestId: input.requestId,
        manifestationJson: {
          text: `I, ${fullUser.fullName}${titlePart}, hereby issued return disposition for this record on ${signedAt.toISOString()}.`,
          fullName: fullUser.fullName,
          title: fullUser.title ?? null,
          meaning: "RETURNED_PRODUCT_DISPOSITION",
          entityType: "returned_product",
          entityId: input.returnedProductId,
          signedAt: signedAt.toISOString(),
          snapshot: { disposition: input.disposition },
        } as Record<string, unknown>,
      })
      .returning();

    const now = new Date();
    const [updated] = await tx
      .update(schema.returnedProducts)
      .set({
        status: "DISPOSED",
        disposition: input.disposition,
        dispositionNotes: input.dispositionNotes ?? null,
        dispositionSignatureId: sigRow!.id,
        dispositionedByUserId: fullUser.id,
        dispositionedAt: signedAt,
        updatedAt: now,
      })
      .where(eq(schema.returnedProducts.id, input.returnedProductId))
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: fullUser.id,
      action: "SIGN",
      entityType: "returned_product",
      entityId: input.returnedProductId,
      before: null,
      after: { signatureId: sigRow!.id, meaning: "RETURNED_PRODUCT_DISPOSITION" },
      route: input.route,
      requestId: input.requestId,
      meta: { signatureId: sigRow!.id, meaning: "RETURNED_PRODUCT_DISPOSITION" },
    });

    await tx.insert(schema.auditTrail).values({
      userId: input.userId,
      action: "RETURN_DISPOSITION_SIGNED",
      entityType: "returned_product",
      entityId: input.returnedProductId,
      before: { status: "QUARANTINE" },
      after: { status: "DISPOSED", disposition: input.disposition, signatureId: sigRow!.id },
      requestId: input.requestId,
      route: input.route,
    });

    return updated!;
  });
}

export async function listReturnInvestigations(filters?: {
  status?: schema.ReturnInvestigationStatus;
  lotId?: string;
}): Promise<schema.ReturnInvestigation[]> {
  let query = db.select().from(schema.returnInvestigations).$dynamic();
  if (filters?.status) query = query.where(eq(schema.returnInvestigations.status, filters.status));
  if (filters?.lotId) query = query.where(eq(schema.returnInvestigations.lotId, filters.lotId));
  return query.orderBy(desc(schema.returnInvestigations.triggeredAt));
}

export async function getReturnInvestigation(id: string): Promise<schema.ReturnInvestigation> {
  const [row] = await db
    .select()
    .from(schema.returnInvestigations)
    .where(eq(schema.returnInvestigations.id, id));
  if (!row) throwStatus(404, "Return investigation not found");
  return row!;
}

export async function closeReturnInvestigation(input: {
  investigationId: string;
  userId: string;
  password: string;
  rootCause: string;
  correctiveAction: string;
  requestId: string;
  route: string;
}): Promise<schema.ReturnInvestigation> {
  const inv = await getReturnInvestigation(input.investigationId);
  if (inv.status !== "OPEN") {
    throwStatus(409, "Investigation is not open", "INVALID_TRANSITION");
  }

  const fullUser = await storage.getUserByEmail(
    await storage.getUserById(input.userId).then((u) => {
      if (!u) throwStatus(404, "User not found");
      return u!.email;
    }),
  );
  if (!fullUser) throwStatus(404, "User not found");
  if (fullUser.lockedUntil && fullUser.lockedUntil > new Date()) {
    throwStatus(423, "Account temporarily locked", "ACCOUNT_LOCKED");
  }
  const valid = await verifyPassword(fullUser.passwordHash, input.password);
  if (!valid) {
    await storage.recordFailedLogin(fullUser.id);
    throwStatus(401, "Password is incorrect.", "UNAUTHENTICATED");
  }
  await storage.recordSuccessfulLogin(fullUser.id);

  const signedAt = new Date();
  const titlePart = fullUser.title ? ` (${fullUser.title})` : "";

  return db.transaction(async (tx) => {
    const [sigRow] = await tx
      .insert(schema.electronicSignatures)
      .values({
        userId: fullUser.id,
        meaning: "RETURN_INVESTIGATION_CLOSE",
        entityType: "return_investigation",
        entityId: input.investigationId,
        commentary: null,
        fullNameAtSigning: fullUser.fullName,
        titleAtSigning: fullUser.title ?? null,
        requestId: input.requestId,
        manifestationJson: {
          text: `I, ${fullUser.fullName}${titlePart}, hereby closed return investigation for this record on ${signedAt.toISOString()}.`,
          fullName: fullUser.fullName,
          title: fullUser.title ?? null,
          meaning: "RETURN_INVESTIGATION_CLOSE",
          entityType: "return_investigation",
          entityId: input.investigationId,
          signedAt: signedAt.toISOString(),
          snapshot: { rootCause: input.rootCause, correctiveAction: input.correctiveAction },
        } as Record<string, unknown>,
      })
      .returning();

    const now = new Date();
    const [updated] = await tx
      .update(schema.returnInvestigations)
      .set({
        status: "CLOSED",
        rootCause: input.rootCause,
        correctiveAction: input.correctiveAction,
        closedByUserId: fullUser.id,
        closedAt: signedAt,
        closeSignatureId: sigRow!.id,
        updatedAt: now,
      })
      .where(eq(schema.returnInvestigations.id, input.investigationId))
      .returning();

    await tx.insert(schema.auditTrail).values({
      userId: fullUser.id,
      action: "SIGN",
      entityType: "return_investigation",
      entityId: input.investigationId,
      before: null,
      after: { signatureId: sigRow!.id, meaning: "RETURN_INVESTIGATION_CLOSE" },
      route: input.route,
      requestId: input.requestId,
      meta: { signatureId: sigRow!.id, meaning: "RETURN_INVESTIGATION_CLOSE" },
    });

    await tx.insert(schema.auditTrail).values({
      userId: input.userId,
      action: "RETURN_INVESTIGATION_CLOSED",
      entityType: "return_investigation",
      entityId: input.investigationId,
      before: { status: "OPEN" },
      after: { status: "CLOSED", signatureId: sigRow!.id, rootCause: input.rootCause },
      requestId: input.requestId,
      route: input.route,
    });

    return updated!;
  });
}

export async function getReturnsSummary(): Promise<{
  awaitingDisposition: number;
  openInvestigations: number;
}> {
  const { sql: sqlFn } = await import("drizzle-orm");

  const [dispRow] = await db
    .select({ count: sqlFn<number>`count(*)::int` })
    .from(schema.returnedProducts)
    .where(eq(schema.returnedProducts.status, "QUARANTINE"));

  const [invRow] = await db
    .select({ count: sqlFn<number>`count(*)::int` })
    .from(schema.returnInvestigations)
    .where(eq(schema.returnInvestigations.status, "OPEN"));

  return {
    awaitingDisposition: dispRow?.count ?? 0,
    openInvestigations: invRow?.count ?? 0,
  };
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm test r06-returned-products.storage
```

Expected: all tests PASS.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add server/storage/returned-products.ts server/__tests__/r06-returned-products.storage.test.ts
git commit -m "feat(r06): storage layer — intake, list, get, F-04 disposition, investigations"
```

---

## Task 2: API routes + integration tests

**Goal:** Add 8 routes to `server/routes.ts` and integration-test them.

**Files:**
- Modify: `server/routes.ts`
- Test: `server/__tests__/r06-returned-products.routes.test.ts`

**Acceptance Criteria:**
- [ ] `POST /api/returned-products` 201 for RECEIVING/QA/ADMIN; 403 for LAB_TECH
- [ ] `GET /api/returned-products` returns list
- [ ] `GET /api/returned-products/:id` returns detail
- [ ] `POST /api/returned-products/:id/disposition` 200 on valid F-04; 401 on bad password
- [ ] `GET /api/return-investigations` returns list
- [ ] `GET /api/return-investigations/:id` returns detail
- [ ] `POST /api/return-investigations/:id/close` 200 on valid F-04
- [ ] `GET /api/returned-products/summary` returns counts

**Verify:** `pnpm test r06-returned-products.routes` → all pass

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/r06-returned-products.routes.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./helpers/test-app";
import { db } from "../db";
import * as schema from "@shared/schema";
import { hashPassword } from "../auth/password";

const PASS = "Test1234!Password";
const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

describeIfDb("R-06 returned-products routes", () => {
  let app: Express;
  let qaUser: schema.User;
  let receivingUser: schema.User;
  let labTechUser: schema.User;
  let lotId: string;
  let returnId: string;

  beforeAll(async () => { app = await buildTestApp(); });

  afterAll(async () => {
    await db.delete(schema.returnInvestigations);
    await db.delete(schema.returnedProducts);
    await db.update(schema.electronicSignatures).set({}).where(undefined as never);
    await db.delete(schema.electronicSignatures);
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

    [qaUser] = await db.insert(schema.users).values({ email: `qa-${Date.now()}@t.local`, fullName: "QA", passwordHash: await hashPassword(PASS), status: "ACTIVE" }).returning();
    await db.insert(schema.userRoles).values({ userId: qaUser.id, role: "QA", grantedByUserId: qaUser.id });

    [receivingUser] = await db.insert(schema.users).values({ email: `rcv-${Date.now()}@t.local`, fullName: "Rcv", passwordHash: await hashPassword(PASS), status: "ACTIVE" }).returning();
    await db.insert(schema.userRoles).values({ userId: receivingUser.id, role: "RECEIVING", grantedByUserId: qaUser.id });

    [labTechUser] = await db.insert(schema.users).values({ email: `lt-${Date.now()}@t.local`, fullName: "LT", passwordHash: await hashPassword(PASS), status: "ACTIVE" }).returning();
    await db.insert(schema.userRoles).values({ userId: labTechUser.id, role: "LAB_TECH", grantedByUserId: qaUser.id });

    const [product] = await db.insert(schema.products).values({ sku: `P-${Date.now()}`, name: "P" }).returning();
    const [lot] = await db.insert(schema.lots).values({ productId: product.id, lotNumber: `LOT-${Date.now()}`, quarantineStatus: "APPROVED" }).returning();
    lotId = lot.id;
  });

  it("POST /api/returned-products — 201 for RECEIVING", async () => {
    const res = await request(app)
      .post("/api/returned-products")
      .set("x-test-user-id", receivingUser.id)
      .send({ source: "AMAZON_FBA", lotCodeRaw: "LOT-001", lotId, qtyReturned: 5, uom: "UNITS", receivedAt: new Date().toISOString() });
    expect(res.status).toBe(201);
    expect(res.body.returnedProduct.status).toBe("QUARANTINE");
    returnId = res.body.returnedProduct.id;
  });

  it("POST /api/returned-products — 403 for LAB_TECH", async () => {
    const res = await request(app)
      .post("/api/returned-products")
      .set("x-test-user-id", labTechUser.id)
      .send({ source: "AMAZON_FBA", lotCodeRaw: "LOT-001", lotId, qtyReturned: 5, uom: "UNITS", receivedAt: new Date().toISOString() });
    expect(res.status).toBe(403);
  });

  it("GET /api/returned-products — returns list for QA", async () => {
    await request(app)
      .post("/api/returned-products")
      .set("x-test-user-id", qaUser.id)
      .send({ source: "WHOLESALE", lotCodeRaw: "LOT-001", lotId, qtyReturned: 3, uom: "UNITS", receivedAt: new Date().toISOString() });
    const res = await request(app).get("/api/returned-products").set("x-test-user-id", qaUser.id);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/returned-products/:id — 200 for QA", async () => {
    const create = await request(app)
      .post("/api/returned-products")
      .set("x-test-user-id", qaUser.id)
      .send({ source: "AMAZON_FBA", lotCodeRaw: "LOT-001", lotId, qtyReturned: 2, uom: "UNITS", receivedAt: new Date().toISOString() });
    const res = await request(app).get(`/api/returned-products/${create.body.returnedProduct.id}`).set("x-test-user-id", qaUser.id);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(create.body.returnedProduct.id);
  });

  it("POST /api/returned-products/:id/disposition — 200 on valid F-04", async () => {
    const create = await request(app)
      .post("/api/returned-products")
      .set("x-test-user-id", qaUser.id)
      .send({ source: "AMAZON_FBA", lotCodeRaw: "LOT-001", lotId, qtyReturned: 2, uom: "UNITS", receivedAt: new Date().toISOString() });
    const res = await request(app)
      .post(`/api/returned-products/${create.body.returnedProduct.id}/disposition`)
      .set("x-test-user-id", qaUser.id)
      .send({ disposition: "DESTROY", password: PASS });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DISPOSED");
    expect(res.body.disposition).toBe("DESTROY");
    expect(res.body.dispositionSignatureId).toBeDefined();
  });

  it("POST /api/returned-products/:id/disposition — 401 on bad password", async () => {
    const create = await request(app)
      .post("/api/returned-products")
      .set("x-test-user-id", qaUser.id)
      .send({ source: "AMAZON_FBA", lotCodeRaw: "LOT-001", lotId, qtyReturned: 2, uom: "UNITS", receivedAt: new Date().toISOString() });
    const res = await request(app)
      .post(`/api/returned-products/${create.body.returnedProduct.id}/disposition`)
      .set("x-test-user-id", qaUser.id)
      .send({ disposition: "DESTROY", password: "WrongPass1!" });
    expect(res.status).toBe(401);
  });

  it("GET /api/returned-products/summary — returns counts", async () => {
    const res = await request(app).get("/api/returned-products/summary").set("x-test-user-id", qaUser.id);
    expect(res.status).toBe(200);
    expect(typeof res.body.awaitingDisposition).toBe("number");
    expect(typeof res.body.openInvestigations).toBe("number");
  });

  it("GET /api/return-investigations — returns list", async () => {
    const res = await request(app).get("/api/return-investigations").set("x-test-user-id", qaUser.id);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
```

- [ ] **Step 2: Run failing**

```bash
pnpm test r06-returned-products.routes
```

Expected: FAIL — routes don't exist yet.

- [ ] **Step 3: Add routes to `server/routes.ts`**

Near the top of routes.ts, after the existing complaint storage import, add:

```typescript
import * as returnsStorage from "./storage/returned-products";
```

Before `return httpServer;` (the last line of `registerRoutes`), add:

```typescript
  // ─── R-06 Returned Products ────────────────────────────────────────────────

  // GET /api/returned-products/summary — dashboard counts (must come before :id route)
  app.get("/api/returned-products/summary", requireAuth, async (_req, res, next) => {
    try {
      const summary = await returnsStorage.getReturnsSummary();
      return res.json(summary);
    } catch (err) { next(err); }
  });

  // POST /api/returned-products — create intake
  app.post("/api/returned-products", requireAuth, requireRole("RECEIVING", "QA", "ADMIN"), async (req, res, next) => {
    try {
      const { source, lotCodeRaw, lotId, qtyReturned, uom, wholesaleCustomerName, carrierTrackingRef, conditionNotes, receivedAt } =
        z.object({
          source: z.enum(["AMAZON_FBA", "WHOLESALE", "OTHER"]),
          lotCodeRaw: z.string().min(1),
          lotId: z.string().uuid().optional(),
          qtyReturned: z.number().int().positive(),
          uom: z.string().min(1),
          wholesaleCustomerName: z.string().optional(),
          carrierTrackingRef: z.string().optional(),
          conditionNotes: z.string().optional(),
          receivedAt: z.string().datetime(),
        }).parse(req.body);
      const result = await returnsStorage.createReturnIntake({
        source, lotCodeRaw, lotId, qtyReturned, uom,
        wholesaleCustomerName, carrierTrackingRef, conditionNotes,
        receivedAt: new Date(receivedAt),
        userId: req.user!.id,
        requestId: req.requestId,
        route: req.path,
      });
      return res.status(201).json(result);
    } catch (err) { next(err); }
  });

  // GET /api/returned-products — list
  app.get("/api/returned-products", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const { status, lotId } = z.object({
        status: z.enum(["QUARANTINE", "DISPOSED"]).optional(),
        lotId: z.string().optional(),
      }).parse(req.query);
      return res.json(await returnsStorage.listReturnedProducts({ status, lotId }));
    } catch (err) { next(err); }
  });

  // GET /api/returned-products/:id — detail
  app.get<{ id: string }>("/api/returned-products/:id", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      return res.json(await returnsStorage.getReturnedProduct(req.params.id));
    } catch (err) { next(err); }
  });

  // POST /api/returned-products/:id/disposition — F-04
  app.post<{ id: string }>("/api/returned-products/:id/disposition", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const { disposition, dispositionNotes, password } = z.object({
        disposition: z.enum(["RETURN_TO_INVENTORY", "DESTROY"]),
        dispositionNotes: z.string().optional(),
        password: z.string().min(1),
      }).parse(req.body);
      const updated = await returnsStorage.signDisposition({
        returnedProductId: req.params.id, disposition, dispositionNotes,
        userId: req.user!.id, password,
        requestId: req.requestId, route: req.path,
      });
      return res.json(updated);
    } catch (err) { next(err); }
  });

  // GET /api/return-investigations — list
  app.get("/api/return-investigations", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const { status, lotId } = z.object({
        status: z.enum(["OPEN", "CLOSED"]).optional(),
        lotId: z.string().optional(),
      }).parse(req.query);
      return res.json(await returnsStorage.listReturnInvestigations({ status, lotId }));
    } catch (err) { next(err); }
  });

  // GET /api/return-investigations/:id — detail
  app.get<{ id: string }>("/api/return-investigations/:id", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      return res.json(await returnsStorage.getReturnInvestigation(req.params.id));
    } catch (err) { next(err); }
  });

  // POST /api/return-investigations/:id/close — F-04
  app.post<{ id: string }>("/api/return-investigations/:id/close", requireAuth, requireRole("QA", "ADMIN"), async (req, res, next) => {
    try {
      const { rootCause, correctiveAction, password } = z.object({
        rootCause: z.string().min(1),
        correctiveAction: z.string().min(1),
        password: z.string().min(1),
      }).parse(req.body);
      const updated = await returnsStorage.closeReturnInvestigation({
        investigationId: req.params.id, rootCause, correctiveAction,
        userId: req.user!.id, password,
        requestId: req.requestId, route: req.path,
      });
      return res.json(updated);
    } catch (err) { next(err); }
  });
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm test r06-returned-products.routes
```

Expected: all PASS.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add server/routes.ts server/__tests__/r06-returned-products.routes.test.ts
git commit -m "feat(r06): API routes — intake, disposition, investigations"
```

---

## Task 3: Dashboard summary + getUserTasks + SLA fix

**Goal:** Wire return task types into `getUserTasks`, add summary delegation, add two dashboard tiles, and fix the R-05 carry-over (complaint SLA split).

**Files:**
- Modify: `server/db-storage.ts`
- Modify: `server/storage/complaints.ts`
- Modify: `client/src/pages/dashboard.tsx`

**Acceptance Criteria:**
- [ ] `getUserTasks` returns `RETURN_PENDING_DISPOSITION` tasks for QA when returns are in QUARANTINE
- [ ] `getUserTasks` returns `RETURN_INVESTIGATION_OPEN` tasks for QA when investigations are OPEN
- [ ] Dashboard renders "Returns awaiting disposition" and "Open return investigations" tiles
- [ ] Complaint triage tile shows overdue badge when intake_at + SLA has passed

**Verify:** `pnpm typecheck && pnpm lint` → no errors

**Steps:**

- [ ] **Step 1: Import returned-products storage in `server/db-storage.ts`**

At the top of `server/db-storage.ts`, after the existing storage imports, add:

```typescript
import * as returnsStorage from "./storage/returned-products";
```

- [ ] **Step 2: Add return task queries to `getUserTasks` in `server/db-storage.ts`**

Inside `getUserTasks`, after the existing SAER task block (around line 3310, just before `if (isWarehouse)`), add:

```typescript
    // Return tasks — QA/ADMIN only
    if (isQa || isAdmin) {
      const pendingDispositionRows = await db
        .select({
          id: schema.returnedProducts.id,
          returnRef: schema.returnedProducts.returnRef,
          source: schema.returnedProducts.source,
          qtyReturned: schema.returnedProducts.qtyReturned,
          uom: schema.returnedProducts.uom,
          receivedAt: schema.returnedProducts.receivedAt,
        })
        .from(schema.returnedProducts)
        .where(eq(schema.returnedProducts.status, "QUARANTINE"));

      for (const row of pendingDispositionRows) {
        tasks.push({
          id: `return-disp-${row.id}`,
          taskType: "RETURN_PENDING_DISPOSITION",
          sourceModule: "RETURN",
          sourceRecordId: row.id,
          sourceIdentifier: row.returnRef,
          primaryLabel: `${row.source.replace("_", " ")} — ${row.qtyReturned} ${row.uom}`,
          secondaryLabel: new Date(row.receivedAt).toLocaleDateString(),
          quantityReceived: null,
          uom: null,
          dateReceived: null,
          isUrgent: false,
          dueAt: null,
        });
      }

      const openInvRows = await db
        .select({
          id: schema.returnInvestigations.id,
          lotId: schema.returnInvestigations.lotId,
          returnsCount: schema.returnInvestigations.returnsCount,
          triggeredAt: schema.returnInvestigations.triggeredAt,
          lotNumber: schema.lots.lotNumber,
        })
        .from(schema.returnInvestigations)
        .leftJoin(schema.lots, eq(schema.lots.id, schema.returnInvestigations.lotId))
        .where(eq(schema.returnInvestigations.status, "OPEN"));

      for (const row of openInvRows) {
        tasks.push({
          id: `return-inv-${row.id}`,
          taskType: "RETURN_INVESTIGATION_OPEN",
          sourceModule: "RETURN",
          sourceRecordId: row.id,
          sourceIdentifier: row.lotNumber ?? row.lotId,
          primaryLabel: `${row.returnsCount} returns — investigation required`,
          secondaryLabel: row.lotNumber ?? null,
          quantityReceived: null,
          uom: null,
          dateReceived: null,
          isUrgent: true,
          dueAt: null,
        });
      }
    }
```

Note: `isQa` and `isAdmin` are already defined earlier in `getUserTasks`. Check the exact variable names at the top of that function (look for `const isQa = roles.includes("QA")` or similar) and use the same names.

- [ ] **Step 3: Fix getComplaintsSummary SLA split in `server/storage/complaints.ts`**

Replace the current `getComplaintsSummary` function (lines ~849–885) with:

```typescript
export async function getComplaintsSummary(): Promise<{
  awaitingTriage: number;
  triageOverdue: number;
  aeDueSoon: number;
  awaitingDisposition: number;
  dispositionOverdue: number;
  callbackFailures: number;
}> {
  const { getFailedCallbackIds } = await import("../integrations/helpcore");
  const { businessDaysUntil } = await import("../lib/business-days");
  const { sql: sqlFn } = await import("drizzle-orm");

  const triageRows = await db
    .select({ intakeAt: schema.complaints.intakeAt })
    .from(schema.complaints)
    .where(eq(schema.complaints.status, "TRIAGE"));

  const [slaTriageRow] = await db
    .select()
    .from(schema.appSettingsKv)
    .where(eq(schema.appSettingsKv.key, "complaintTriageSlaBusinessDays"));
  const triageSla = slaTriageRow ? parseInt(slaTriageRow.value, 10) : 1;

  const [slaDispRow] = await db
    .select()
    .from(schema.appSettingsKv)
    .where(eq(schema.appSettingsKv.key, "dispositionSlaBusinessDays"));
  const dispSla = slaDispRow ? parseInt(slaDispRow.value, 10) : 5;

  const now = new Date();
  let triageOverdue = 0;
  for (const { intakeAt } of triageRows) {
    const bdsRemaining = await businessDaysUntil(now, new Date(intakeAt.getTime() + triageSla * 86_400_000 * 1.5));
    if (bdsRemaining < 0) triageOverdue++;
  }

  const dispositionRows = await db
    .select({ investigatedAt: schema.complaints.investigatedAt })
    .from(schema.complaints)
    .where(eq(schema.complaints.status, "AWAITING_DISPOSITION"));

  let dispositionOverdue = 0;
  for (const { investigatedAt } of dispositionRows) {
    if (!investigatedAt) continue;
    const bdsRemaining = await businessDaysUntil(now, new Date(investigatedAt.getTime() + dispSla * 86_400_000 * 1.5));
    if (bdsRemaining < 0) dispositionOverdue++;
  }

  const openAes = await db
    .select({ dueAt: schema.adverseEvents.dueAt })
    .from(schema.adverseEvents)
    .where(eq(schema.adverseEvents.status, "OPEN"));

  const aeDueSoon = (
    await Promise.all(openAes.map(ae => businessDaysUntil(now, ae.dueAt)))
  ).filter(bds => bds <= 2).length;

  return {
    awaitingTriage: triageRows.length,
    triageOverdue,
    aeDueSoon,
    awaitingDisposition: dispositionRows.length,
    dispositionOverdue,
    callbackFailures: getFailedCallbackIds().length,
  };
}
```

- [ ] **Step 4: Add return dashboard tiles and update complaint tiles in `client/src/pages/dashboard.tsx`**

Find the `complaintsSummary` query (around line 221). After it, add a return summary query:

```typescript
  const { data: returnsSummary } = useQuery<{
    awaitingDisposition: number;
    openInvestigations: number;
  }>({
    queryKey: ["/api/returned-products/summary"],
    queryFn: async () => (await apiRequest("GET", "/api/returned-products/summary")).json(),
  });
```

In the complaints tiles block, update the triage card to show overdue context. Find `{complaintsSummary.awaitingTriage}` badge and update the card text to:

```tsx
<p className="text-sm text-muted-foreground">
  {complaintsSummary.awaitingTriage === 0
    ? "No complaints awaiting triage."
    : `${complaintsSummary.awaitingTriage} awaiting triage${complaintsSummary.triageOverdue > 0 ? ` (${complaintsSummary.triageOverdue} overdue)` : ""}.`}
</p>
```

After the existing R-05 complaint tiles block (after the closing `</>` of the `complaintsSummary &&` block), add:

```tsx
        {/* R-06 Return tiles */}
        {returnsSummary && (
          <>
            <Link href="/quality/returns">
              <Card data-testid="card-returns-disposition" className="cursor-pointer hover:bg-muted/50 transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center justify-between">
                    Returns awaiting disposition
                    {returnsSummary.awaitingDisposition > 0 && (
                      <Badge className="bg-amber-500/20 text-amber-300 border-0 text-xs">
                        {returnsSummary.awaitingDisposition}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {returnsSummary.awaitingDisposition === 0
                      ? "No returns in quarantine."
                      : `${returnsSummary.awaitingDisposition} return${returnsSummary.awaitingDisposition > 1 ? "s" : ""} awaiting QA disposition.`}
                  </p>
                </CardContent>
              </Card>
            </Link>

            <Link href="/quality/returns">
              <Card data-testid="card-returns-investigations" className="cursor-pointer hover:bg-muted/50 transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center justify-between">
                    Open return investigations
                    {returnsSummary.openInvestigations > 0 && (
                      <Badge className="bg-destructive/20 text-destructive border-0 text-xs">
                        {returnsSummary.openInvestigations}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {returnsSummary.openInvestigations === 0
                      ? "No open return investigations."
                      : `${returnsSummary.openInvestigations} lot${returnsSummary.openInvestigations > 1 ? "s" : ""} with open return investigation.`}
                  </p>
                </CardContent>
              </Card>
            </Link>
          </>
        )}
```

- [ ] **Step 5: Typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add server/db-storage.ts server/storage/complaints.ts client/src/pages/dashboard.tsx
git commit -m "feat(r06): getUserTasks return tasks, dashboard tiles, complaint SLA split"
```

---

## Task 4: Frontend pages + navigation

**Goal:** Create three frontend pages and wire them into the Quality tab and App router.

**Files:**
- Create: `client/src/pages/quality/returns.tsx`
- Create: `client/src/pages/quality/ReturnDetail.tsx`
- Create: `client/src/pages/quality/ReturnInvestigations.tsx`
- Modify: `client/src/pages/quality/index.tsx`
- Modify: `client/src/App.tsx`

**Acceptance Criteria:**
- [ ] Returns subtab is enabled in the Quality tab
- [ ] Returns list renders with status badges and "Log return" button
- [ ] Intake modal submits to `POST /api/returned-products`
- [ ] ReturnDetail shows F-04 disposition form when in QUARANTINE
- [ ] ReturnDetail shows investigation banner when lot has open investigation
- [ ] ReturnInvestigations shows close form and F-04 button

**Verify:** `pnpm typecheck && pnpm lint` → no errors

**Steps:**

- [ ] **Step 1: Enable Returns subtab in `client/src/pages/quality/index.tsx`**

Replace the entire file content with:

```typescript
import { useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import LabelingPage from "./labeling";
import SopsPage from "./sops";
import ComplaintsPage from "./complaints";
import ReturnsPage from "./returns";

type QualityTab = "labeling" | "sops" | "complaints" | "returns";

const ACTIVE_TABS: { value: QualityTab; label: string }[] = [
  { value: "labeling", label: "Labeling" },
  { value: "sops", label: "SOPs" },
  { value: "complaints", label: "Complaints" },
  { value: "returns", label: "Returns" },
];

const DISABLED_TABS: { value: string; label: string; tooltip: string }[] = [
  { value: "validation", label: "Validation", tooltip: "Coming soon" },
];

export default function QualityPage() {
  const [, params] = useRoute<{ tab?: string }>("/quality/:tab");
  const [, setLocation] = useLocation();
  const tabParam = params?.tab;

  const validTabs: QualityTab[] = ["labeling", "sops", "complaints", "returns"];

  useEffect(() => {
    if (!tabParam || !validTabs.includes(tabParam as QualityTab)) {
      setLocation("/quality/labeling", { replace: true });
    }
  }, [tabParam, setLocation]);

  const activeTab: QualityTab =
    tabParam === "sops" ? "sops"
    : tabParam === "complaints" ? "complaints"
    : tabParam === "returns" ? "returns"
    : "labeling";

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Quality</h1>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setLocation(`/quality/${v}`)}>
        <TabsList>
          {ACTIVE_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} data-testid={`tab-quality-${t.value}`}>
              {t.label}
            </TabsTrigger>
          ))}
          {DISABLED_TABS.map((t) => (
            <Tooltip key={t.value}>
              <TooltipTrigger asChild>
                <span>
                  <TabsTrigger value={t.value} disabled data-testid={`tab-quality-${t.value}`} className="cursor-not-allowed opacity-40">
                    {t.label}
                  </TabsTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t.tooltip}</TooltipContent>
            </Tooltip>
          ))}
        </TabsList>
      </Tabs>

      {activeTab === "labeling" && <LabelingPage />}
      {activeTab === "sops" && <SopsPage />}
      {activeTab === "complaints" && <ComplaintsPage />}
      {activeTab === "returns" && <ReturnsPage />}
    </div>
  );
}
```

- [ ] **Step 2: Add return routes to `client/src/App.tsx`**

In `App.tsx`, after the existing quality route imports, add:

```typescript
import ReturnDetail from "@/pages/quality/ReturnDetail";
import ReturnInvestigations from "@/pages/quality/ReturnInvestigations";
```

In the routes section, after the complaint routes, add:

```typescript
          <Route path="/quality/returns" component={QualityPage} />
          <Route path="/quality/returns/:id" component={ReturnDetail} />
          <Route path="/quality/return-investigations" component={ReturnInvestigations} />
```

- [ ] **Step 3: Create `client/src/pages/quality/returns.tsx`**

```typescript
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ReturnedProduct {
  id: string;
  returnRef: string;
  source: string;
  lotId: string | null;
  lotCodeRaw: string;
  qtyReturned: number;
  uom: string;
  status: "QUARANTINE" | "DISPOSED";
  disposition: string | null;
  receivedAt: string;
}

const SOURCE_LABELS: Record<string, string> = {
  AMAZON_FBA: "Amazon FBA",
  WHOLESALE: "Wholesale",
  OTHER: "Other",
};

export default function ReturnsPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const { data: returns = [], isLoading } = useQuery<ReturnedProduct[]>({
    queryKey: ["/api/returned-products", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const res = await apiRequest("GET", `/api/returned-products?${params}`);
      return res.json();
    },
  });

  const [form, setForm] = useState({
    source: "AMAZON_FBA" as string,
    lotCodeRaw: "",
    qtyReturned: "",
    uom: "UNITS",
    wholesaleCustomerName: "",
    carrierTrackingRef: "",
    conditionNotes: "",
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/returned-products", {
      source: form.source,
      lotCodeRaw: form.lotCodeRaw,
      qtyReturned: parseInt(form.qtyReturned, 10),
      uom: form.uom,
      wholesaleCustomerName: form.wholesaleCustomerName || undefined,
      carrierTrackingRef: form.carrierTrackingRef || undefined,
      conditionNotes: form.conditionNotes || undefined,
      receivedAt: new Date().toISOString(),
    }).then(r => r.json()),
    onSuccess: () => {
      setShowModal(false);
      setForm({ source: "AMAZON_FBA", lotCodeRaw: "", qtyReturned: "", uom: "UNITS", wholesaleCustomerName: "", carrierTrackingRef: "", conditionNotes: "" });
      void qc.invalidateQueries({ queryKey: ["/api/returned-products"] });
    },
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(["", "QUARANTINE", "DISPOSED"] as const).map((s) => (
            <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)}>
              {s === "" ? "All" : s === "QUARANTINE" ? "Quarantine" : "Disposed"}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate("/quality/return-investigations")}>
            Investigations
          </Button>
          <Button size="sm" onClick={() => setShowModal(true)}>Log return</Button>
        </div>
      </div>

      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Ref</th>
              <th className="text-left p-3 font-medium">Source</th>
              <th className="text-left p-3 font-medium">Lot</th>
              <th className="text-left p-3 font-medium">Qty</th>
              <th className="text-left p-3 font-medium">Received</th>
              <th className="text-left p-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {returns.length === 0 && (
              <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No returns found.</td></tr>
            )}
            {returns.map((r) => (
              <tr key={r.id} className="border-t cursor-pointer hover:bg-muted/30" onClick={() => navigate(`/quality/returns/${r.id}`)}>
                <td className="p-3 font-mono text-xs">{r.returnRef}</td>
                <td className="p-3">{SOURCE_LABELS[r.source] ?? r.source}</td>
                <td className="p-3 text-xs">{r.lotCodeRaw}</td>
                <td className="p-3">{r.qtyReturned} {r.uom}</td>
                <td className="p-3 text-xs">{new Date(r.receivedAt).toLocaleDateString()}</td>
                <td className="p-3">
                  {r.status === "QUARANTINE"
                    ? <Badge className="bg-amber-500/20 text-amber-300 border-0">Quarantine</Badge>
                    : r.disposition === "DESTROY"
                      ? <Badge className="bg-destructive/20 text-destructive border-0">Destroyed</Badge>
                      : <Badge className="bg-green-500/20 text-green-300 border-0">Returned to inventory</Badge>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Log return</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Source</Label>
              <Select value={form.source} onValueChange={(v) => setForm(f => ({ ...f, source: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AMAZON_FBA">Amazon FBA</SelectItem>
                  <SelectItem value="WHOLESALE">Wholesale</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Lot code (on box)</Label>
              <Input value={form.lotCodeRaw} onChange={e => setForm(f => ({ ...f, lotCodeRaw: e.target.value }))} placeholder="e.g. LOT-20240101-001" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Qty returned</Label>
                <Input type="number" value={form.qtyReturned} onChange={e => setForm(f => ({ ...f, qtyReturned: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">UOM</Label>
                <Input value={form.uom} onChange={e => setForm(f => ({ ...f, uom: e.target.value }))} />
              </div>
            </div>
            {form.source === "WHOLESALE" && (
              <div>
                <Label className="text-xs">Wholesale customer name</Label>
                <Input value={form.wholesaleCustomerName} onChange={e => setForm(f => ({ ...f, wholesaleCustomerName: e.target.value }))} />
              </div>
            )}
            <div>
              <Label className="text-xs">Carrier / Amazon tracking ref (optional)</Label>
              <Input value={form.carrierTrackingRef} onChange={e => setForm(f => ({ ...f, carrierTrackingRef: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Condition notes</Label>
              <Textarea rows={2} value={form.conditionNotes} onChange={e => setForm(f => ({ ...f, conditionNotes: e.target.value }))} placeholder="Seal intact? Damage? Labels correct?" />
            </div>
            <Button
              className="w-full"
              onClick={() => createMutation.mutate()}
              disabled={!form.lotCodeRaw || !form.qtyReturned || createMutation.isPending}
            >
              {createMutation.isPending ? "Logging…" : "Log return"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Create `client/src/pages/quality/ReturnDetail.tsx`**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { SignatureCeremony } from "@/components/SignatureCeremony";

interface ReturnedProduct {
  id: string;
  returnRef: string;
  source: string;
  lotId: string | null;
  lotCodeRaw: string;
  qtyReturned: number;
  uom: string;
  wholesaleCustomerName: string | null;
  carrierTrackingRef: string | null;
  conditionNotes: string | null;
  status: "QUARANTINE" | "DISPOSED";
  disposition: string | null;
  dispositionNotes: string | null;
  dispositionedAt: string | null;
  investigationTriggered: boolean;
  receivedAt: string;
}

interface ReturnInvestigation {
  id: string;
  status: "OPEN" | "CLOSED";
}

const SOURCE_LABELS: Record<string, string> = {
  AMAZON_FBA: "Amazon FBA",
  WHOLESALE: "Wholesale",
  OTHER: "Other",
};

export default function ReturnDetail() {
  const [, params] = useRoute<{ id: string }>("/quality/returns/:id");
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const id = params?.id ?? "";

  const { data: rp, isLoading } = useQuery<ReturnedProduct>({
    queryKey: [`/api/returned-products/${id}`],
    queryFn: () => apiRequest("GET", `/api/returned-products/${id}`).then(r => r.json()),
    enabled: !!id,
  });

  const { data: investigations = [] } = useQuery<ReturnInvestigation[]>({
    queryKey: [`/api/return-investigations`, id],
    queryFn: () => apiRequest("GET", `/api/return-investigations?lotId=${rp?.lotId ?? ""}`).then(r => r.json()),
    enabled: !!rp?.lotId,
  });

  const openInvestigation = investigations.find(i => i.status === "OPEN");

  const [dispositionForm, setDispositionForm] = useState({ disposition: "DESTROY" as "DESTROY" | "RETURN_TO_INVENTORY", dispositionNotes: "" });
  const [showCeremony, setShowCeremony] = useState(false);

  const dispositionMutation = useMutation({
    mutationFn: (password: string) =>
      apiRequest("POST", `/api/returned-products/${id}/disposition`, { ...dispositionForm, password }).then(r => r.json()),
    onSuccess: () => {
      setShowCeremony(false);
      void qc.invalidateQueries({ queryKey: [`/api/returned-products/${id}`] });
    },
  });

  if (isLoading || !rp) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/quality/returns")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to returns
        </Button>
        <h1 className="text-xl font-semibold">{rp.returnRef}</h1>
        {rp.status === "QUARANTINE"
          ? <Badge className="bg-amber-500/20 text-amber-300 border-0">Quarantine</Badge>
          : rp.disposition === "DESTROY"
            ? <Badge className="bg-destructive/20 text-destructive border-0">Destroyed</Badge>
            : <Badge className="bg-green-500/20 text-green-300 border-0">Returned to inventory</Badge>
        }
      </div>

      {openInvestigation && (
        <div className="flex items-center gap-2 p-3 rounded-md border border-amber-500/30 bg-amber-500/10 text-sm text-amber-300">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          This lot has an open return investigation.
          <Button size="sm" variant="ghost" className="ml-auto text-xs" onClick={() => navigate("/quality/return-investigations")}>
            View investigation
          </Button>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">Return details</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          <div><span className="text-muted-foreground">Source:</span> {SOURCE_LABELS[rp.source] ?? rp.source}</div>
          <div><span className="text-muted-foreground">Lot code (raw):</span> {rp.lotCodeRaw}</div>
          <div><span className="text-muted-foreground">Quantity:</span> {rp.qtyReturned} {rp.uom}</div>
          <div><span className="text-muted-foreground">Received:</span> {new Date(rp.receivedAt).toLocaleString()}</div>
          {rp.wholesaleCustomerName && <div><span className="text-muted-foreground">Customer:</span> {rp.wholesaleCustomerName}</div>}
          {rp.carrierTrackingRef && <div><span className="text-muted-foreground">Tracking ref:</span> {rp.carrierTrackingRef}</div>}
          {rp.conditionNotes && <div><span className="text-muted-foreground">Condition notes:</span> {rp.conditionNotes}</div>}
        </CardContent>
      </Card>

      {rp.status === "QUARANTINE" && (
        <Card>
          <CardHeader><CardTitle className="text-sm">QA Disposition</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-4">
              {(["DESTROY", "RETURN_TO_INVENTORY"] as const).map((d) => (
                <label key={d} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="disposition"
                    checked={dispositionForm.disposition === d}
                    onChange={() => setDispositionForm(f => ({ ...f, disposition: d }))}
                  />
                  {d === "DESTROY" ? "Destroy" : "Return to inventory"}
                </label>
              ))}
            </div>
            <div>
              <Label className="text-xs">Disposition notes (optional)</Label>
              <Textarea rows={2} value={dispositionForm.dispositionNotes} onChange={e => setDispositionForm(f => ({ ...f, dispositionNotes: e.target.value }))} />
            </div>
            <Button size="sm" onClick={() => setShowCeremony(true)}>
              Sign disposition (F-04)
            </Button>
          </CardContent>
        </Card>
      )}

      {rp.status === "DISPOSED" && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Disposition record</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div><span className="text-muted-foreground">Decision:</span> {rp.disposition === "DESTROY" ? "Destroy" : "Return to inventory"}</div>
            <div><span className="text-muted-foreground">Signed at:</span> {rp.dispositionedAt ? new Date(rp.dispositionedAt).toLocaleString() : "—"}</div>
            {rp.dispositionNotes && <div><span className="text-muted-foreground">Notes:</span> {rp.dispositionNotes}</div>}
          </CardContent>
        </Card>
      )}

      <SignatureCeremony
        open={showCeremony}
        onOpenChange={setShowCeremony}
        entityDescription={`Return ${rp.returnRef} — disposition: ${dispositionForm.disposition === "DESTROY" ? "Destroy" : "Return to inventory"}`}
        meaning="RETURNED_PRODUCT_DISPOSITION"
        isPending={dispositionMutation.isPending}
        onSign={async (password) => { dispositionMutation.mutate(password); }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Create `client/src/pages/quality/ReturnInvestigations.tsx`**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft } from "lucide-react";
import { SignatureCeremony } from "@/components/SignatureCeremony";

interface ReturnInvestigation {
  id: string;
  lotId: string;
  triggeredAt: string;
  returnsCount: number;
  thresholdAtTrigger: number;
  status: "OPEN" | "CLOSED";
  rootCause: string | null;
  correctiveAction: string | null;
  closedAt: string | null;
}

export default function ReturnInvestigations() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"OPEN" | "CLOSED" | "">("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [closeForm, setCloseForm] = useState({ rootCause: "", correctiveAction: "" });
  const [showCeremony, setShowCeremony] = useState(false);

  const { data: investigations = [], isLoading } = useQuery<ReturnInvestigation[]>({
    queryKey: ["/api/return-investigations", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      return apiRequest("GET", `/api/return-investigations?${params}`).then(r => r.json());
    },
  });

  const closeMutation = useMutation({
    mutationFn: (password: string) =>
      apiRequest("POST", `/api/return-investigations/${expandedId}/close`, {
        rootCause: closeForm.rootCause,
        correctiveAction: closeForm.correctiveAction,
        password,
      }).then(r => r.json()),
    onSuccess: () => {
      setShowCeremony(false);
      setExpandedId(null);
      setCloseForm({ rootCause: "", correctiveAction: "" });
      void qc.invalidateQueries({ queryKey: ["/api/return-investigations"] });
    },
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const expanded = expandedId ? investigations.find(i => i.id === expandedId) : null;

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/quality/returns")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to returns
        </Button>
        <h1 className="text-xl font-semibold">Return investigations</h1>
      </div>

      <div className="flex gap-2">
        {(["", "OPEN", "CLOSED"] as const).map((s) => (
          <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)}>
            {s === "" ? "All" : s}
          </Button>
        ))}
      </div>

      <div className="space-y-3">
        {investigations.length === 0 && (
          <p className="text-sm text-muted-foreground">No investigations found.</p>
        )}
        {investigations.map((inv) => (
          <Card key={inv.id} className={inv.status === "OPEN" ? "border-amber-500/30" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>Lot {inv.lotId.slice(0, 8)}… — {inv.returnsCount} returns (threshold {inv.thresholdAtTrigger})</span>
                <div className="flex items-center gap-2">
                  {inv.status === "OPEN"
                    ? <Badge className="bg-amber-500/20 text-amber-300 border-0">Open</Badge>
                    : <Badge className="bg-muted text-muted-foreground border-0">Closed</Badge>
                  }
                  {inv.status === "OPEN" && (
                    <Button size="sm" variant="outline" onClick={() => setExpandedId(expandedId === inv.id ? null : inv.id)}>
                      {expandedId === inv.id ? "Cancel" : "Close investigation"}
                    </Button>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1">
              <div>Triggered: {new Date(inv.triggeredAt).toLocaleString()}</div>
              {inv.rootCause && <div><span className="text-foreground">Root cause:</span> {inv.rootCause}</div>}
              {inv.correctiveAction && <div><span className="text-foreground">Corrective action:</span> {inv.correctiveAction}</div>}
              {inv.closedAt && <div>Closed: {new Date(inv.closedAt).toLocaleString()}</div>}

              {expandedId === inv.id && (
                <div className="pt-3 space-y-3">
                  <div>
                    <Label className="text-xs">Root cause</Label>
                    <Textarea rows={2} value={closeForm.rootCause} onChange={e => setCloseForm(f => ({ ...f, rootCause: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Corrective action</Label>
                    <Textarea rows={2} value={closeForm.correctiveAction} onChange={e => setCloseForm(f => ({ ...f, correctiveAction: e.target.value }))} />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setShowCeremony(true)}
                    disabled={!closeForm.rootCause || !closeForm.correctiveAction}
                  >
                    Sign close (F-04)
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <SignatureCeremony
        open={showCeremony}
        onOpenChange={setShowCeremony}
        entityDescription={`Return investigation — lot ${expanded?.lotId?.slice(0, 8) ?? ""}…`}
        meaning="RETURN_INVESTIGATION_CLOSE"
        isPending={closeMutation.isPending}
        onSign={async (password) => { closeMutation.mutate(password); }}
      />
    </div>
  );
}
```

- [ ] **Step 6: Typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: no errors.

- [ ] **Step 7: Run full test suite**

```bash
pnpm test
```

Expected: all existing tests pass, new tests pass.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/quality/returns.tsx client/src/pages/quality/ReturnDetail.tsx client/src/pages/quality/ReturnInvestigations.tsx client/src/pages/quality/index.tsx client/src/App.tsx
git commit -m "feat(r06): frontend — Returns tab, detail page, investigations page"
```

---

## Final: open PR

```bash
git push -u origin ticket/r-06-returned-product
gh pr create \
  --title "feat(r06): Returned Product module — closes FDA Form 483 Obs 12" \
  --base FDA-EQMS-feature-package \
  --body "$(cat <<'EOF'
## Summary
- Migration 0020: erp_returned_products + erp_return_investigations tables
- Full quarantine → QA disposition (F-04) → DISPOSED workflow
- Automatic investigation trigger when lot return count ≥ configurable threshold (default 3)
- Investigation close with root cause + corrective action + F-04 signature
- 7 API routes + summary endpoint
- Returns subtab in Quality, list/detail/investigations pages
- 2 dashboard tiles (awaiting disposition, open investigations)
- Carry-over: complaint SLA split (triage overdue + disposition overdue) in dashboard counts
- Closes §111.503, §111.510, §111.513 (FDA Form 483 Obs 12)

## Test plan
- [ ] pnpm test r06-returned-products.storage → all pass
- [ ] pnpm test r06-returned-products.routes → all pass
- [ ] pnpm test → full suite passes
- [ ] pnpm typecheck && pnpm lint → clean
- [ ] Manual: log return, sign disposition DESTROY, sign disposition RETURN_TO_INVENTORY
- [ ] Manual: trigger threshold, open investigation banner in ReturnDetail, close investigation
- [ ] Manual: dashboard tiles update on intake

🤖 Generated with Claude Code
EOF
)"
```
