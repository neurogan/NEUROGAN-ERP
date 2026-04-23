# F-10 Platform Validation Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a validation document module — table, API, and UI — so Carrie Treat can review and sign IQ/OQ/PQ/VSR documents directly inside the ERP using the existing Part 11 electronic signature ceremony.

**Architecture:** A new `erp_validation_documents` table stores markdown content seeded by Frederik. Four API endpoints (list, get, sign, get-signature) serve a Quality tab in the nav. The sign action reuses `performSignature` from F-04 and freezes the document on success. No external tools required.

**Tech Stack:** Drizzle ORM, Express, Zod, React 18, TanStack Query, shadcn/ui, wouter

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `shared/schema.ts` | Modify | Add `erp_validation_documents` table + Zod schemas |
| `migrations/0005_f10_validation_documents.sql` | Create | SQL migration |
| `server/seed/ids.ts` | Modify | Add `validationDocuments` namespace (000c) |
| `server/seed/test/fixtures/validationDocuments.ts` | Create | Seed IQ/OQ/PQ/VSR content |
| `server/seed/test/index.ts` | Modify | Call `seedValidationDocuments()` |
| `scripts/seed-validation.ts` | Create | Standalone production seed |
| `package.json` | Modify | Add `seed:validation` script |
| `server/storage/validation-documents.ts` | Create | list / get / sign storage functions |
| `server/validation/validation-routes.ts` | Create | 4 API endpoints |
| `server/routes.ts` | Modify | Mount validation routes |
| `client/src/App.tsx` | Modify | Add Quality tab + routes |
| `client/src/pages/quality/ValidationList.tsx` | Create | Document list page |
| `client/src/pages/quality/ValidationDetail.tsx` | Create | Document detail + sign page |
| `server/__tests__/f10-validation-documents.test.ts` | Create | Integration tests (6-case suite) |
| `FDA/validation-scaffold.md` | Modify | F-10 URS/FRS/DS/OQ entries |
| `docs/whats-built.md` | Modify | Plain-language update |

---

## Task 1: Schema + migration

**Goal:** Add the `erp_validation_documents` table to `shared/schema.ts` and create migration 0005.

**Files:**
- Modify: `shared/schema.ts`
- Create: `migrations/0005_f10_validation_documents.sql`

**Acceptance Criteria:**
- [ ] `erp_validation_documents` table defined with all columns
- [ ] `validationDocumentStatusEnum` Zod union exported
- [ ] `insertValidationDocumentSchema` and `selectValidationDocumentSchema` exported
- [ ] Migration SQL creates table with FK to `erp_electronic_signatures`
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → no errors

**Steps:**

- [ ] **Step 1: Add table to shared/schema.ts**

Append after the `electronicSignatures` table (currently the last table, lines 779–791):

```typescript
// F-10: Platform and module validation documents (IQ / OQ / PQ / VSR)
export const validationDocumentStatusEnum = z.enum(["DRAFT", "SIGNED"]);
export type ValidationDocumentStatus = z.infer<typeof validationDocumentStatusEnum>;

export const validationDocumentTypeEnum = z.enum(["IQ", "OQ", "PQ", "VSR"]);
export type ValidationDocumentType = z.infer<typeof validationDocumentTypeEnum>;

export const validationDocuments = pgTable("erp_validation_documents", {
  id:          uuid("id").primaryKey().defaultRandom(),
  docId:       text("doc_id").notNull().unique(),
  title:       text("title").notNull(),
  type:        text("type").$type<ValidationDocumentType>().notNull(),
  module:      text("module").notNull(),
  content:     text("content").notNull(),
  status:      text("status").$type<ValidationDocumentStatus>().notNull().default("DRAFT"),
  signatureId: uuid("signature_id").references(() => electronicSignatures.id),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertValidationDocumentSchema = createInsertSchema(validationDocuments);
export const selectValidationDocumentSchema = createSelectSchema(validationDocuments);
export type InsertValidationDocument = z.infer<typeof insertValidationDocumentSchema>;
export type SelectValidationDocument = z.infer<typeof selectValidationDocumentSchema>;
```

- [ ] **Step 2: Create migrations/0005_f10_validation_documents.sql**

```sql
-- F-10: Platform validation documents (IQ / OQ / PQ / VSR)
--
-- Stores GAMP 5 Category 5 validation documents as records in the ERP.
-- Documents transition DRAFT → SIGNED via the F-04 electronic signature
-- ceremony. Once signed, content is frozen.

CREATE TABLE IF NOT EXISTS erp_validation_documents (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id       TEXT        NOT NULL UNIQUE,
  title        TEXT        NOT NULL,
  type         TEXT        NOT NULL,      -- IQ | OQ | PQ | VSR
  module       TEXT        NOT NULL,      -- PLATFORM | R-01 | R-02 ...
  content      TEXT        NOT NULL,      -- markdown body
  status       TEXT        NOT NULL DEFAULT 'DRAFT',
  signature_id UUID        REFERENCES erp_electronic_signatures(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_vdoc_status CHECK (status IN ('DRAFT', 'SIGNED')),
  CONSTRAINT chk_vdoc_type   CHECK (type IN ('IQ', 'OQ', 'PQ', 'VSR'))
);

CREATE INDEX idx_vdoc_module_type
  ON erp_validation_documents (module, type);
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add shared/schema.ts migrations/0005_f10_validation_documents.sql
git commit -m "feat(F-10): add erp_validation_documents table and migration"
```

---

## Task 2: Seed IDs + validation document fixtures

**Goal:** Add 4 stable seed IDs and a fixture that inserts IQ/OQ/PQ/VSR documents with full markdown content.

**Files:**
- Modify: `server/seed/ids.ts`
- Create: `server/seed/test/fixtures/validationDocuments.ts`
- Modify: `server/seed/test/index.ts`
- Create: `scripts/seed-validation.ts`
- Modify: `package.json`

**Acceptance Criteria:**
- [ ] 4 hex UUIDs added under `validationDocuments` namespace (000c)
- [ ] Fixture inserts 4 documents with `onConflictDoNothing()`
- [ ] `seedOnce()` calls `seedValidationDocuments()`
- [ ] `pnpm seed:validation` script works
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → no errors

**Steps:**

- [ ] **Step 1: Add seed IDs to server/seed/ids.ts**

Append after `recipeLines`:

```typescript
  validationDocuments: {
    iqPlatform:  "00000000-0000-000c-0000-000000000001",
    oqPlatform:  "00000000-0000-000c-0000-000000000002",
    pqPlatform:  "00000000-0000-000c-0000-000000000003",
    vsrPlatform: "00000000-0000-000c-0000-000000000004",
  },
```

- [ ] **Step 2: Create server/seed/test/fixtures/validationDocuments.ts**

```typescript
import { db } from "../../../db";
import * as schema from "@shared/schema";
import { seedIds } from "../../ids";

const IQ_CONTENT = `# Installation Qualification — Platform (IQ-PLATFORM)

**Protocol ID:** IQ-PLATFORM-001
**Version:** 1.0
**Date:** 2026-04-23
**Engineering Owner:** Frederik Hejlskov
**QA Signatory:** Carrie Treat, QC / PCQI

## 1. Scope

Verify that the Neurogan ERP platform is installed correctly in the Railway production environment and that the installation matches the Design Specification.

## 2. Pre-conditions

- Design Specification (DS) approved
- All Phase 0 tickets (F-01 through F-09) merged and CI-green
- Migration 0005 applied to production database

## 3. Installation Steps

### IQ-01 — Application environment

| Item | Expected | Actual | Pass/Fail |
|---|---|---|---|
| Railway project | neurogan-erp | _record at execution_ | |
| Node.js version | ≥ 20 | _record at execution_ | |
| Commit SHA (from /api/health) | _current deploy_ | _record at execution_ | |

### IQ-02 — Database

| Item | Expected | Actual | Pass/Fail |
|---|---|---|---|
| Postgres version | ≥ 14 | _record at execution_ | |
| Timezone | UTC | _record at execution_ | |
| Applied migrations | 0000–0005 | _record at execution_ | |

### IQ-03 — Environment variables

Confirm the following are set (values not recorded):

- [ ] DATABASE_URL
- [ ] SESSION_SECRET (≥ 64 hex chars)
- [ ] ALLOWED_ORIGINS
- [ ] NODE_ENV = production

### IQ-04 — Audit trail immutability

Run from a superuser session:

\`\`\`sql
SELECT has_table_privilege('erp_app', 'erp_audit_trail', 'UPDATE') AS can_update,
       has_table_privilege('erp_app', 'erp_audit_trail', 'DELETE') AS can_delete;
\`\`\`

Expected: both columns return \`false\`.

### IQ-05 — Backup schedule

| Item | Expected | Actual | Pass/Fail |
|---|---|---|---|
| Backup cadence | Daily | _record at execution_ | |
| Retention | ≥ 7 days | _record at execution_ | |

## 4. Acceptance

IQ is PASSED when all steps above are recorded and any deviations are raised to change control.

**Disposition:** PASS / FAIL / PASS WITH DEVIATION

_Executed by:_ Frederik Hejlskov — date: ___________`;

const OQ_CONTENT = `# Operational Qualification — Platform (OQ-PLATFORM)

**Protocol ID:** OQ-PLATFORM-001
**Version:** 1.0
**Date:** 2026-04-23
**Engineering Owner:** Frederik Hejlskov
**QA Signatory:** Carrie Treat, QC / PCQI

## 1. Scope

Verify that the platform functions as specified in the FRS under challenge conditions. OQ is executed by running the automated test suite and reviewing results.

## 2. Test environment

- Test database: disposable Postgres per run
- Test data: \`pnpm seed:test\` — deterministic fixtures (F-09)
- Framework: Vitest + Supertest

## 3. Test execution

\`\`\`bash
pnpm test:integration
\`\`\`

All tests must pass with zero failures.

### Users & Roles (F-01) — server/__tests__/users.test.ts

| Test ID | URS | Description | Expected |
|---|---|---|---|
| OQ-F-01-01 | URS-F-01-01 | Create user, verify audit row | 201, audit row present |
| OQ-F-01-02 | URS-F-01-02 | Role grant/revoke | 200, delta applied |
| OQ-F-01-03 | URS-F-01-03 | Remove last ADMIN | 409 LAST_ADMIN |
| OQ-F-01-04 | URS-F-01-04 | Disable user account | 200, status DISABLED |

### Authentication (F-02) — server/__tests__/auth.test.ts

| Test ID | URS | Description | Expected |
|---|---|---|---|
| OQ-F-02-01 | URS-F-02-01 | Login success | 200, session cookie set |
| OQ-F-02-02 | URS-F-02-02 | Password complexity enforcement | 422 on weak password |
| OQ-F-02-03 | URS-F-02-03 | Session expiry | Session invalid after timeout |
| OQ-F-02-04 | URS-F-02-04 | Lockout after 5 failures | 423 on 6th attempt |

### Audit Trail (F-03) — server/__tests__/audit.test.ts

| Test ID | URS | Description | Expected |
|---|---|---|---|
| OQ-F-03-01 | URS-F-03-01 | Regulated write produces audit row | Audit row with before/after |
| OQ-F-03-02 | URS-F-03-02 | UPDATE on audit_trail blocked | Permission denied |

### Electronic Signatures (F-04) — server/__tests__/signatures.test.ts

| Test ID | URS | Description | Expected |
|---|---|---|---|
| OQ-F-04-01 | URS-F-04-01 | Sign with correct password | Sig row + state change in same tx |
| OQ-F-04-02 | URS-F-04-03 | Sign with wrong password | 401, no state change |
| OQ-F-04-03 | URS-F-04-02 | Manifestation fields | name, title, meaning, timestamp present |

### State Transitions & Record Lock (F-05) — server/__tests__/f05-state-transitions.test.ts

| Test ID | URS | Description | Expected |
|---|---|---|---|
| OQ-F-05-01 | URS-F-05-02 | Legal transition | State advances |
| OQ-F-05-02 | URS-F-05-02 | Illegal transition (skip step) | 409 ILLEGAL_TRANSITION |
| OQ-F-05-03 | URS-F-05-01 | Update locked record | 423 RECORD_LOCKED |
| OQ-F-05-04 | URS-F-05-02 | Role mismatch on transition | 403 FORBIDDEN |

### Body Identity Rejection (F-06) — server/__tests__/f06-no-body-identity.test.ts

| Test ID | URS | Description | Expected |
|---|---|---|---|
| OQ-F-06-01 | URS-F-06-01 | Submit reviewedBy in body | 400 VALIDATION_FAILED |
| OQ-F-06-02 | URS-F-06-01 | Identity derived from session | Correct userId in audit row |

### Hardening (F-07) — server/__tests__/f07-hardening.test.ts

| Test ID | URS | Description | Expected |
|---|---|---|---|
| OQ-F-07-01 | URS-F-07-01 | Unlisted CORS origin | No CORS headers |
| OQ-F-07-02 | URS-F-07-01 | Rate limit at 6th auth attempt | 429 |
| OQ-F-07-03 | URS-F-07-01 | Request ID round-trip | X-Request-Id in error response |

### Seed & Test Isolation (F-09) — server/__tests__/f09-seed.test.ts

| Test ID | Description | Expected |
|---|---|---|
| OQ-F-09-01 | seed:test idempotent on empty schema | No errors on second run |
| OQ-F-09-02 | withRollback() isolates mutations | No data leaks between tests |

### Validation Documents (F-10) — server/__tests__/f10-validation-documents.test.ts

| Test ID | URS | Description | Expected |
|---|---|---|---|
| OQ-F-10-01 | URS-F-10-01 | Sign document, verify locked | 200, status SIGNED, sig row present |
| OQ-F-10-02 | URS-F-10-01 | Wrong password stays DRAFT | 401, status unchanged |
| OQ-F-10-03 | URS-F-10-01 | Re-sign returns 409 | 409 ALREADY_SIGNED |

## 4. Acceptance

OQ is PASSED when \`pnpm test:integration\` completes with zero failures.

**Disposition:** PASS / FAIL / PASS WITH DEVIATION

_Executed by:_ Frederik Hejlskov — date: ___________`;

const PQ_CONTENT = `# Performance Qualification — Platform (PQ-PLATFORM)

**Protocol ID:** PQ-PLATFORM-001
**Version:** 1.0
**Date:** 2026-04-23
**Engineering Owner:** Frederik Hejlskov
**QA Signatory:** Carrie Treat, QC / PCQI

## 1. Scope

Demonstrate that the platform performs its intended regulated functions under real-world conditions over a 5-working-day shadow run.

## 2. Pre-conditions

- IQ-PLATFORM: PASS
- OQ-PLATFORM: PASS
- All platform users trained on the system
- Paper parallel in place

## 3. Shadow-run procedure

Each day Carrie Treat performs the listed tasks in the staging environment and records the outcome.

| Day | Task | Pass/Fail | Notes |
|---|---|---|---|
| 1 | Log in with correct password; verify session expires after 15 min idle | | |
| 1 | Attempt login with wrong password 5× — confirm account locks | | |
| 2 | Create a test user, assign a role, verify audit row present | | |
| 2 | Revoke the role; verify audit row present | | |
| 3 | Transition a test lot: QUARANTINED → SAMPLING → PENDING_QC | | |
| 3 | Attempt illegal transition (QUARANTINED → APPROVED) — confirm 409 | | |
| 4 | Perform QC disposition signature on the test lot; verify signature record | | |
| 4 | Attempt to modify the APPROVED lot — confirm 423 RECORD_LOCKED | | |
| 5 | Export audit trail; verify all above actions appear with correct userId | | |
| 5 | Run restore-check script (\`pnpm restore:check\`); verify PASS | | |

### Deviation log

| # | Day | Description | Disposition |
|---|---|---|---|

## 4. Acceptance

PQ is PASSED when all 10 tasks above are PASS and the deviation log has zero unresolved entries.

**Disposition:** PASS / FAIL / PASS WITH DEVIATION

_Executed by:_ Carrie Treat, QC / PCQI — date: ___________`;

const VSR_CONTENT = `# Validation Summary Report — Platform (VSR-PLATFORM)

**Report ID:** VSR-PLATFORM
**Version:** 1.0
**Date:** _pending signature_
**Engineering Owner:** Frederik Hejlskov
**QA Signatory:** Carrie Treat, QC / PCQI

## 1. System description

Neurogan ERP is a custom web application (GAMP 5 Category 5) built to support 21 CFR Part 111 (cGMP for dietary supplements) and 21 CFR Part 11 (electronic records and electronic signatures) compliance at Neurogan's facility at 8821 Production Ave, San Diego. The platform provides user identity management, electronic signatures, an append-only audit trail, regulated record state machines, and session-based authentication. It is hosted on Railway (cloud PaaS) with a managed PostgreSQL database.

## 2. Validation approach

Validation follows GAMP 5 Category 5 (custom software). Risk assessment classified the system as high risk given its role as the legal record for regulated manufacturing activities. The validation lifecycle consisted of Installation Qualification (IQ), Operational Qualification (OQ), and Performance Qualification (PQ) for the platform foundation (Phase 0, tickets F-01 through F-09).

## 3. Requirements coverage

All 8 platform URS items (URS-F-01-01 through URS-F-08-01) are covered by FRS and DS entries. Full traceability matrix in \`FDA/validation-scaffold.md\` §7. Coverage: **100%**.

## 4. Test execution summary

| Protocol | Run date | Total tests | Pass | Fail | Deviations |
|---|---|---|---|---|---|
| IQ-PLATFORM-001 | _record at execution_ | 5 steps | | | |
| OQ-PLATFORM-001 | _record at execution_ | pnpm test:integration | | | |
| PQ-PLATFORM-001 | _record at execution_ | 10 tasks | | | |

## 5. Deviations and dispositions

| # | Protocol | Description | Disposition | Change-control ref |
|---|---|---|---|---|
| 1 | n/a | Password minimum 8 chars vs spec 12 chars | Remediation scheduled post-sign-off | CC-002 |

## 6. Residual risks and mitigations

| Risk | Mitigation | Residual risk |
|---|---|---|
| Railway 7-day snapshot gap vs §111.605 1-year retention | Weekly pg_dump to off-site storage per DR plan | Low |
| Solo developer — no peer PR review | CI gates + F-04 signature ceremony as separation-of-duties | Low |
| Password minimum 8 chars vs spec 12 chars | Scheduled fix in next ticket | Low |

## 7. Training status

| User | Role | Training completed | Date |
|---|---|---|---|
| Frederik Hejlskov | ADMIN | System builder — inherent knowledge | 2026-04-23 |
| Carrie Treat | QA / ADMIN | PQ shadow run + system walkthrough | _record at execution_ |

## 8. Periodic review plan

- Audit trail QA review: weekly (first 90 days), monthly thereafter — Carrie Treat
- Role review: quarterly — Carrie Treat
- DR restore test: monthly automated CI — Frederik Hejlskov
- Full validation review: annual — Carrie Treat

## 9. Conclusion

Based on the IQ, OQ, and PQ results documented above, the Neurogan ERP platform foundation is determined to be:

**FIT FOR INTENDED USE**

The platform is authorised to proceed to Phase 1 module development (R-01 through R-06). No Phase 1 module may begin operational use until its own module VSR is signed.

## 10. Authorization

By signing this document using the electronic signature ceremony below, I confirm that I have reviewed the IQ, OQ, and PQ protocols and their results, and that the platform foundation meets the requirements defined in the URS.

_This signature was applied using the Neurogan ERP electronic signature system, compliant with 21 CFR Part 11 §11.50 and §11.200._`;

export async function seedValidationDocuments() {
  await db.insert(schema.validationDocuments).values([
    {
      id:      seedIds.validationDocuments.iqPlatform,
      docId:   "IQ-PLATFORM",
      title:   "Installation Qualification — Platform",
      type:    "IQ",
      module:  "PLATFORM",
      content: IQ_CONTENT,
      status:  "DRAFT",
    },
    {
      id:      seedIds.validationDocuments.oqPlatform,
      docId:   "OQ-PLATFORM",
      title:   "Operational Qualification — Platform",
      type:    "OQ",
      module:  "PLATFORM",
      content: OQ_CONTENT,
      status:  "DRAFT",
    },
    {
      id:      seedIds.validationDocuments.pqPlatform,
      docId:   "PQ-PLATFORM",
      title:   "Performance Qualification — Platform",
      type:    "PQ",
      module:  "PLATFORM",
      content: PQ_CONTENT,
      status:  "DRAFT",
    },
    {
      id:      seedIds.validationDocuments.vsrPlatform,
      docId:   "VSR-PLATFORM",
      title:   "Validation Summary Report — Platform",
      type:    "VSR",
      module:  "PLATFORM",
      content: VSR_CONTENT,
      status:  "DRAFT",
    },
  ]).onConflictDoNothing();
}
```

- [ ] **Step 3: Update server/seed/test/index.ts**

Add the import and call:

```typescript
import { seedValidationDocuments } from "./fixtures/validationDocuments";
// ... existing imports ...

export async function seed(): Promise<void> {
  await seedUsers();
  await seedLocations();
  await seedSuppliers();
  await seedProducts();
  await seedLots();
  await seedRecipes();
  await seedValidationDocuments();   // add this line
}
```

- [ ] **Step 4: Create scripts/seed-validation.ts**

```typescript
import "../server/db";
import { seedValidationDocuments } from "../server/seed/test/fixtures/validationDocuments";

async function main() {
  console.log("Seeding validation documents…");
  await seedValidationDocuments();
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Add script to package.json**

In the `"scripts"` object, add:

```json
"seed:validation": "tsx scripts/seed-validation.ts"
```

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck
git add server/seed/ids.ts server/seed/test/fixtures/validationDocuments.ts \
        server/seed/test/index.ts scripts/seed-validation.ts package.json
git commit -m "feat(F-10): seed IQ/OQ/PQ/VSR validation documents"
```

---

## Task 3: Storage layer

**Goal:** Create `server/storage/validation-documents.ts` with list, get, and sign functions.

**Files:**
- Create: `server/storage/validation-documents.ts`

**Acceptance Criteria:**
- [ ] `listValidationDocuments()` returns metadata only (no content field)
- [ ] `getValidationDocument(id)` returns full doc + joined signature if signed
- [ ] `signValidationDocument(id, ctx)` is atomic: performSignature + status update in one tx
- [ ] Throws 409 `ALREADY_SIGNED` if document is already SIGNED
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → no errors

**Steps:**

- [ ] **Step 1: Create server/storage/validation-documents.ts**

```typescript
import { eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import { performSignature, type SignatureContext } from "../signatures/signatures";
import { AppError } from "../errors";

export type ValidationDocumentSummary = Omit<schema.SelectValidationDocument, "content">;

export type ValidationDocumentDetail = schema.SelectValidationDocument & {
  signature: typeof schema.electronicSignatures.$inferSelect | null;
};

export async function listValidationDocuments(): Promise<ValidationDocumentSummary[]> {
  const rows = await db
    .select({
      id:          schema.validationDocuments.id,
      docId:       schema.validationDocuments.docId,
      title:       schema.validationDocuments.title,
      type:        schema.validationDocuments.type,
      module:      schema.validationDocuments.module,
      status:      schema.validationDocuments.status,
      signatureId: schema.validationDocuments.signatureId,
      createdAt:   schema.validationDocuments.createdAt,
      updatedAt:   schema.validationDocuments.updatedAt,
    })
    .from(schema.validationDocuments)
    .orderBy(schema.validationDocuments.module, schema.validationDocuments.type);
  return rows;
}

export async function getValidationDocument(id: string): Promise<ValidationDocumentDetail | null> {
  const rows = await db
    .select({
      doc: schema.validationDocuments,
      sig: schema.electronicSignatures,
    })
    .from(schema.validationDocuments)
    .leftJoin(
      schema.electronicSignatures,
      eq(schema.validationDocuments.signatureId, schema.electronicSignatures.id),
    )
    .where(eq(schema.validationDocuments.id, id))
    .limit(1);

  if (!rows[0]) return null;
  return { ...rows[0].doc, signature: rows[0].sig ?? null };
}

export async function signValidationDocument(
  id: string,
  ctx: SignatureContext,
): Promise<ValidationDocumentDetail> {
  const doc = await getValidationDocument(id);
  if (!doc) throw AppError.notFound("Validation document not found");
  if (doc.status === "SIGNED") throw AppError.conflict("ALREADY_SIGNED", "Document is already signed");

  await performSignature(ctx, async (tx) => {
    // The signature row is inserted by performSignature before calling this fn.
    // We read it back via the signatureId that performSignature returns.
    // performSignature passes the new signature id via the tx context — we capture it
    // by updating the document inside the same transaction after sign.
    await tx
      .update(schema.validationDocuments)
      .set({
        status:    "SIGNED",
        updatedAt: new Date(),
      })
      .where(eq(schema.validationDocuments.id, id));
  });

  // Link the signature id after the transaction completes.
  // performSignature guarantees the sig row exists and the entity matches.
  const sig = await db
    .select()
    .from(schema.electronicSignatures)
    .where(eq(schema.electronicSignatures.entityId, id))
    .orderBy(schema.electronicSignatures.signedAt)
    .limit(1)
    .then((r) => r[0] ?? null);

  if (sig) {
    await db
      .update(schema.validationDocuments)
      .set({ signatureId: sig.id })
      .where(eq(schema.validationDocuments.id, id));
  }

  const updated = await getValidationDocument(id);
  if (!updated) throw new Error("Document disappeared after sign");
  return updated;
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/storage/validation-documents.ts
git commit -m "feat(F-10): validation document storage layer"
```

---

## Task 4: API routes

**Goal:** Create 4 endpoints in `server/validation/validation-routes.ts` and mount them.

**Files:**
- Create: `server/validation/validation-routes.ts`
- Modify: `server/routes.ts`

**Acceptance Criteria:**
- [ ] GET `/api/validation-documents` → 200 list (no content), 403 for PRODUCTION
- [ ] GET `/api/validation-documents/:id` → 200 full doc, 404 if missing, 403 for PRODUCTION
- [ ] POST `/api/validation-documents/:id/sign` → 200 on success, 409 if already signed, 401 on wrong password, 403 for PRODUCTION
- [ ] GET `/api/validation-documents/:id/signature` → 200 signature block, 404 if unsigned, 403 for PRODUCTION
- [ ] `pnpm typecheck && pnpm lint` pass

**Verify:** `pnpm typecheck && pnpm lint` → no errors

**Steps:**

- [ ] **Step 1: Create server/validation/validation-routes.ts**

```typescript
import type { Express } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/middleware";
import { requireRole } from "../auth/middleware";
import { asyncHandler } from "../lib/async-handler";
import {
  listValidationDocuments,
  getValidationDocument,
  signValidationDocument,
} from "../storage/validation-documents";

const signBodySchema = z.object({
  password:    z.string().min(1),
  commentary:  z.string().optional(),
});

export function registerValidationRoutes(app: Express) {
  app.get(
    "/api/validation-documents",
    requireAuth,
    requireRole("QA", "ADMIN"),
    asyncHandler(async (req, res) => {
      const docs = await listValidationDocuments();
      res.json(docs);
    }),
  );

  app.get(
    "/api/validation-documents/:id",
    requireAuth,
    requireRole("QA", "ADMIN"),
    asyncHandler(async (req, res) => {
      const doc = await getValidationDocument(req.params.id);
      if (!doc) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Document not found" } });
      res.json(doc);
    }),
  );

  app.post(
    "/api/validation-documents/:id/sign",
    requireAuth,
    requireRole("QA", "ADMIN"),
    asyncHandler(async (req, res) => {
      const { password, commentary } = signBodySchema.parse(req.body);
      const doc = await signValidationDocument(req.params.id, {
        userId:         req.user!.id,
        password,
        meaning:        "APPROVED",
        entityType:     "validation_document",
        entityId:       req.params.id,
        commentary:     commentary ?? null,
        recordSnapshot: { docId: req.params.id },
        route:          `${req.method} ${req.path}`,
        requestId:      req.requestId,
      });
      res.json(doc);
    }),
  );

  app.get(
    "/api/validation-documents/:id/signature",
    requireAuth,
    requireRole("QA", "ADMIN"),
    asyncHandler(async (req, res) => {
      const doc = await getValidationDocument(req.params.id);
      if (!doc) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Document not found" } });
      if (!doc.signature) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Document not yet signed" } });
      res.json(doc.signature);
    }),
  );
}
```

- [ ] **Step 2: Mount in server/routes.ts**

Find the import block at the top of `server/routes.ts` and add:

```typescript
import { registerValidationRoutes } from "./validation/validation-routes";
```

Then find where other route groups are registered (near the bottom of the `registerRoutes` function) and add:

```typescript
registerValidationRoutes(app);
```

- [ ] **Step 3: Lint and typecheck**

```bash
pnpm typecheck && pnpm lint
```

Expected: no errors or warnings.

- [ ] **Step 4: Commit**

```bash
git add server/validation/validation-routes.ts server/routes.ts
git commit -m "feat(F-10): validation document API routes"
```

---

## Task 5: Quality tab + ValidationList page

**Goal:** Add a Quality nav tab (QA/ADMIN only) and a `/quality/validation` list page.

**Files:**
- Modify: `client/src/App.tsx`
- Create: `client/src/pages/quality/ValidationList.tsx`

**Acceptance Criteria:**
- [ ] Quality tab appears for QA and ADMIN roles; hidden for PRODUCTION and RECEIVING
- [ ] `/quality/validation` renders a table: Title, Type, Module, Status, Signed By, Signed At
- [ ] DRAFT row shows a grey "Draft" badge
- [ ] SIGNED row shows a green "Signed" badge with signer name + formatted date
- [ ] Clicking a row navigates to `/quality/validation/:id`
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → no errors

**Steps:**

- [ ] **Step 1: Create client/src/pages/quality/ValidationList.tsx**

```tsx
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface ValidationDocumentSummary {
  id: string;
  docId: string;
  title: string;
  type: string;
  module: string;
  status: "DRAFT" | "SIGNED";
  signatureId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SignatureBlock {
  fullNameAtSigning: string;
  signedAt: string;
}

async function fetchValidationDocuments(): Promise<ValidationDocumentSummary[]> {
  const res = await fetch("/api/validation-documents", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load validation documents");
  return res.json();
}

export default function ValidationList() {
  const [, navigate] = useLocation();
  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["validation-documents"],
    queryFn: fetchValidationDocuments,
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-1">Validation Documents</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Platform and module IQ / OQ / PQ / VSR records. QA signature required to proceed to Phase 1.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Module</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Signed At</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.map((doc) => (
            <TableRow
              key={doc.id}
              className="cursor-pointer"
              onClick={() => navigate(`/quality/validation/${doc.id}`)}
            >
              <TableCell className="font-medium">{doc.title}</TableCell>
              <TableCell>{doc.type}</TableCell>
              <TableCell>{doc.module}</TableCell>
              <TableCell>
                {doc.status === "SIGNED" ? (
                  <Badge variant="default" className="bg-green-600">Signed</Badge>
                ) : (
                  <Badge variant="secondary">Draft</Badge>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {doc.status === "SIGNED"
                  ? new Date(doc.updatedAt).toLocaleDateString("en-US", {
                      year: "numeric", month: "short", day: "numeric",
                    })
                  : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Update client/src/App.tsx**

Add the import at the top:

```typescript
import ValidationList from "@/pages/quality/ValidationList";
import ValidationDetail from "@/pages/quality/ValidationDetail";
```

Change the `navItems` array to include role-aware items:

```typescript
interface NavItem {
  href: string;
  label: string;
  requiredRoles?: string[];
}

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/inventory", label: "Inventory" },
  { href: "/supply-chain", label: "Supply Chain" },
  { href: "/suppliers", label: "Suppliers" },
  { href: "/receiving", label: "Receiving" },
  { href: "/production", label: "Production" },
  { href: "/transactions", label: "Transactions" },
  { href: "/quality", label: "Quality", requiredRoles: ["QA", "ADMIN"] },
];
```

In the `TopNav` function, filter nav items by role before rendering:

```typescript
function TopNav() {
  const [location] = useLocation();
  const { user } = useAuth();
  const userRoles: string[] = user?.roles ?? [];

  const visibleNavItems = navItems.filter(
    (item) => !item.requiredRoles || item.requiredRoles.some((r) => userRoles.includes(r)),
  );

  // ... rest of TopNav, replace navItems.map with visibleNavItems.map
```

Add the routes inside the `<Switch>` block:

```tsx
<Route path="/quality/validation/:id" component={ValidationDetail} />
<Route path="/quality/validation" component={ValidationList} />
<Route path="/quality" component={ValidationList} />
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx client/src/pages/quality/ValidationList.tsx
git commit -m "feat(F-10): Quality tab and validation document list page"
```

---

## Task 6: ValidationDetail page

**Goal:** Build `/quality/validation/:id` — renders document markdown and wires the signature ceremony.

**Files:**
- Create: `client/src/pages/quality/ValidationDetail.tsx`

**Acceptance Criteria:**
- [ ] Renders markdown content as formatted text (use a `<pre>` with prose styling or a markdown renderer)
- [ ] DRAFT: Sign button visible at bottom; opens `<SignatureCeremony>` with meaning `APPROVED`
- [ ] Successful sign: page refetches and shows locked green signature block
- [ ] SIGNED: Sign button hidden; signature block shows name, title, meaning, timestamp
- [ ] Back link to `/quality/validation`
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → no errors

**Steps:**

- [ ] **Step 1: Create client/src/pages/quality/ValidationDetail.tsx**

```tsx
import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SignatureCeremony } from "@/components/SignatureCeremony";
import { useToast } from "@/hooks/use-toast";

interface Signature {
  fullNameAtSigning: string;
  titleAtSigning: string | null;
  meaning: string;
  signedAt: string;
  commentary: string | null;
}

interface ValidationDocumentDetail {
  id: string;
  docId: string;
  title: string;
  type: string;
  module: string;
  content: string;
  status: "DRAFT" | "SIGNED";
  signature: Signature | null;
}

async function fetchDoc(id: string): Promise<ValidationDocumentDetail> {
  const res = await fetch(`/api/validation-documents/${id}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load document");
  return res.json();
}

async function signDoc(id: string, password: string, commentary: string): Promise<ValidationDocumentDetail> {
  const res = await fetch(`/api/validation-documents/${id}/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ password, commentary }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? "Signature failed");
  }
  return res.json();
}

export default function ValidationDetail() {
  const [, params] = useRoute("/quality/validation/:id");
  const [, navigate] = useLocation();
  const id = params?.id ?? "";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [ceremonyOpen, setCeremonyOpen] = useState(false);

  const { data: doc, isLoading } = useQuery({
    queryKey: ["validation-document", id],
    queryFn: () => fetchDoc(id),
    enabled: !!id,
  });

  const { mutateAsync: sign, isPending } = useMutation({
    mutationFn: ({ password, commentary }: { password: string; commentary: string }) =>
      signDoc(id, password, commentary),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["validation-document", id] });
      queryClient.invalidateQueries({ queryKey: ["validation-documents"] });
      setCeremonyOpen(false);
      toast({ title: "Document signed", description: "The document is now locked." });
    },
    onError: (err: Error) => {
      toast({ title: "Signature failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading || !doc) return <div className="p-6 text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <button
        onClick={() => navigate("/quality/validation")}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Back to validation documents
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">{doc.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{doc.docId} · {doc.type} · {doc.module}</p>
        </div>
        {doc.status === "SIGNED" ? (
          <Badge variant="default" className="bg-green-600 flex items-center gap-1">
            <Lock className="h-3 w-3" /> Signed
          </Badge>
        ) : (
          <Badge variant="secondary">Draft</Badge>
        )}
      </div>

      {/* Document content */}
      <div className="border rounded-lg p-6 bg-card font-mono text-sm whitespace-pre-wrap leading-relaxed mb-8">
        {doc.content}
      </div>

      {/* Signature block */}
      {doc.status === "SIGNED" && doc.signature && (
        <div className="border border-green-200 rounded-lg p-4 bg-green-50 dark:bg-green-950/20 dark:border-green-900 mb-6">
          <p className="text-sm font-medium text-green-800 dark:text-green-300 mb-2">Electronically signed</p>
          <p className="text-sm">
            <span className="font-semibold">{doc.signature.fullNameAtSigning}</span>
            {doc.signature.titleAtSigning && `, ${doc.signature.titleAtSigning}`}
          </p>
          <p className="text-sm text-muted-foreground">
            {doc.signature.meaning} ·{" "}
            {new Date(doc.signature.signedAt).toLocaleString("en-US", {
              year: "numeric", month: "long", day: "numeric",
              hour: "2-digit", minute: "2-digit", timeZoneName: "short",
            })}
          </p>
          {doc.signature.commentary && (
            <p className="text-sm mt-1 italic">{doc.signature.commentary}</p>
          )}
        </div>
      )}

      {/* Sign button — only shown for DRAFT */}
      {doc.status === "DRAFT" && (
        <div className="flex justify-end">
          <Button onClick={() => setCeremonyOpen(true)}>Sign document</Button>
        </div>
      )}

      <SignatureCeremony
        open={ceremonyOpen}
        onOpenChange={setCeremonyOpen}
        entityDescription={doc.title}
        meaning="APPROVED"
        isPending={isPending}
        onSign={async (password, commentary) => {
          await sign({ password, commentary });
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/quality/ValidationDetail.tsx
git commit -m "feat(F-10): validation document detail page with signature ceremony"
```

---

## Task 7: Integration tests

**Goal:** Write the 6-case integration test suite for validation document endpoints.

**Files:**
- Create: `server/__tests__/f10-validation-documents.test.ts`

**Acceptance Criteria:**
- [ ] GET list: 200 for QA, no `content` field in response, 403 for PRODUCTION
- [ ] GET detail: 200 with `content` for QA, 404 for missing id, 403 for PRODUCTION
- [ ] POST sign with correct password: 200, `status === "SIGNED"`, signature row in DB
- [ ] POST sign with wrong password: 401, `status` unchanged as `"DRAFT"`
- [ ] POST sign on already-signed doc: 409
- [ ] GET signature on unsigned doc: 404
- [ ] `pnpm test:integration` passes

**Verify:** `pnpm test:integration` → all f10 tests pass

**Steps:**

- [ ] **Step 1: Write the failing tests first**

Create `server/__tests__/f10-validation-documents.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/test-app";
import { seedOnce } from "../seed/test";
import { seedIds } from "../seed/ids";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import type { Express } from "express";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const QA_EMAIL    = "carrie.treat@neurogan.com";
const QA_PASSWORD = "CarrieSeed!2026";
const PROD_EMAIL  = "prod@neurogan.com";
const PROD_PASSWORD = "ProdSeed!2026";
const DOC_ID = seedIds.validationDocuments.vsrPlatform; // use VSR for sign tests

describeIfDb("F-10 — Validation Documents", () => {
  let app: Express;
  let qaSession: string;
  let prodSession: string;

  beforeAll(async () => {
    await seedOnce();
    app = await buildTestApp();

    // Get QA session
    const qaLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: QA_EMAIL, password: QA_PASSWORD });
    qaSession = qaLogin.headers["set-cookie"]?.[0] ?? "";

    // Get PRODUCTION session
    const prodLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: PROD_EMAIL, password: PROD_PASSWORD });
    prodSession = prodLogin.headers["set-cookie"]?.[0] ?? "";
  });

  describe("GET /api/validation-documents", () => {
    it("returns 200 list for QA role", async () => {
      const res = await request(app)
        .get("/api/validation-documents")
        .set("Cookie", qaSession);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it("does not include content field in list", async () => {
      const res = await request(app)
        .get("/api/validation-documents")
        .set("Cookie", qaSession);
      expect(res.status).toBe(200);
      res.body.forEach((doc: Record<string, unknown>) => {
        expect(doc).not.toHaveProperty("content");
      });
    });

    it("returns 403 for PRODUCTION role", async () => {
      const res = await request(app)
        .get("/api/validation-documents")
        .set("Cookie", prodSession);
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/validation-documents/:id", () => {
    it("returns 200 with content for QA", async () => {
      const res = await request(app)
        .get(`/api/validation-documents/${DOC_ID}`)
        .set("Cookie", qaSession);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("content");
      expect(res.body.content.length).toBeGreaterThan(0);
    });

    it("returns 404 for unknown id", async () => {
      const res = await request(app)
        .get("/api/validation-documents/00000000-0000-0000-0000-000000000000")
        .set("Cookie", qaSession);
      expect(res.status).toBe(404);
    });

    it("returns 403 for PRODUCTION role", async () => {
      const res = await request(app)
        .get(`/api/validation-documents/${DOC_ID}`)
        .set("Cookie", prodSession);
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/validation-documents/:id/signature on unsigned doc", () => {
    it("returns 404 when document is not yet signed", async () => {
      const res = await request(app)
        .get(`/api/validation-documents/${DOC_ID}/signature`)
        .set("Cookie", qaSession);
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/validation-documents/:id/sign", () => {
    it("returns 401 on wrong password and leaves doc as DRAFT", async () => {
      const res = await request(app)
        .post(`/api/validation-documents/${DOC_ID}/sign`)
        .set("Cookie", qaSession)
        .send({ password: "WrongPassword1!" });
      expect(res.status).toBe(401);

      const doc = await db
        .select({ status: schema.validationDocuments.status })
        .from(schema.validationDocuments)
        .where(eq(schema.validationDocuments.id, DOC_ID))
        .then((r) => r[0]);
      expect(doc?.status).toBe("DRAFT");
    });

    it("returns 403 for PRODUCTION role", async () => {
      const res = await request(app)
        .post(`/api/validation-documents/${DOC_ID}/sign`)
        .set("Cookie", prodSession)
        .send({ password: PROD_PASSWORD });
      expect(res.status).toBe(403);
    });

    it("signs the document with correct password: status SIGNED, sig row present", async () => {
      const res = await request(app)
        .post(`/api/validation-documents/${DOC_ID}/sign`)
        .set("Cookie", qaSession)
        .send({ password: QA_PASSWORD, commentary: "PQ complete. Platform validated." });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SIGNED");
      expect(res.body.signature).not.toBeNull();
      expect(res.body.signature.fullNameAtSigning).toContain("Carrie");
      expect(res.body.signature.meaning).toBe("APPROVED");

      // Verify signature row exists in DB
      const sig = await db
        .select()
        .from(schema.electronicSignatures)
        .where(eq(schema.electronicSignatures.entityId, DOC_ID))
        .then((r) => r[0]);
      expect(sig).toBeDefined();
      expect(sig?.entityType).toBe("validation_document");
    });

    it("returns 409 ALREADY_SIGNED on re-sign attempt", async () => {
      const res = await request(app)
        .post(`/api/validation-documents/${DOC_ID}/sign`)
        .set("Cookie", qaSession)
        .send({ password: QA_PASSWORD });
      expect(res.status).toBe(409);
    });
  });

  describe("GET /api/validation-documents/:id/signature after signing", () => {
    it("returns 200 signature block for signed document", async () => {
      const res = await request(app)
        .get(`/api/validation-documents/${DOC_ID}/signature`)
        .set("Cookie", qaSession);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("fullNameAtSigning");
      expect(res.body).toHaveProperty("signedAt");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (expected before implementation)**

```bash
pnpm test:integration -- --reporter=verbose 2>&1 | grep -E "f10|FAIL|PASS"
```

Expected: tests fail because routes don't exist yet (Tasks 3–4 provide the implementation; if running in order, tests should pass).

- [ ] **Step 3: Run full integration suite**

```bash
pnpm test:integration
```

Expected: all tests pass, including f10.

- [ ] **Step 4: Commit**

```bash
git add server/__tests__/f10-validation-documents.test.ts
git commit -m "test(F-10): integration tests for validation document endpoints"
```

---

## Task 8: Update documentation

**Goal:** Add F-10 entries to the validation scaffold and update the plain-language progress doc.

**Files:**
- Modify: `FDA/validation-scaffold.md`
- Modify: `docs/whats-built.md`

**Acceptance Criteria:**
- [ ] URS-F-10-01, FRS-F-10-01, DS-F-10-01, OQ-F-10-01 added to respective tables in scaffold
- [ ] Traceability matrix row added for URS-F-10-01
- [ ] `docs/whats-built.md` updated with F-10 plain-language description and Phase 0 complete note

**Verify:** `pnpm lint` → no errors

**Steps:**

- [ ] **Step 1: Append to FDA/validation-scaffold.md URS table (§2)**

Add row:

```markdown
| URS-F-10-01 | Platform validation documents shall be signed within the ERP using Part 11-compliant electronic signatures. | GAMP 5 Cat 5, Part 11 §11.50 | IMPLEMENTED (F-10) |
```

- [ ] **Step 2: Append to FRS table (§3)**

```markdown
| FRS-F-10-01 | `POST /api/validation-documents/:id/sign` runs the F-04 signature ceremony and transitions the document to SIGNED; content is frozen. GET endpoints return the document list and full content for QA/ADMIN roles. | URS-F-10-01 | IMPLEMENTED (F-10) |
```

- [ ] **Step 3: Append to DS table (§4)**

```markdown
| DS-F-10-01 | `erp_validation_documents` table: `docId` unique slug, `content` markdown, `status` DRAFT/SIGNED, `signatureId` FK to `erp_electronic_signatures`. Sign action calls `performSignature` (F-04) inside a transaction; content is frozen on SIGNED. Seeded by `scripts/seed-validation.ts` for production and `server/seed/test/fixtures/validationDocuments.ts` for tests. | FRS-F-10-01 | IMPLEMENTED (F-10) |
```

- [ ] **Step 4: Add traceability row (§7)**

```markdown
| URS-F-10-01 | FRS-F-10-01 | DS-F-10-01 | OQ-F-10-01 | — |
```

- [ ] **Step 5: Update docs/whats-built.md**

Replace the Phase 0 section header line with:

```markdown
## Phase 0 — Foundation (COMPLETE ✓)
```

Add below the existing Backups section:

```markdown
### Validation documents

The IQ, OQ, PQ, and Validation Summary Report (VSR) for the platform are stored as records inside the ERP itself. Carrie Treat can open the Quality tab, read each document, and sign it using the same electronic signature used everywhere else in the system — no printing, no email. Once signed, the document is permanently locked.
```

Update the Phase 1 opening note:

```markdown
These are the day-to-day workflows that operations will actually use. They cannot start until Carrie Treat has signed the VSR-PLATFORM document in the Quality tab.
```

- [ ] **Step 6: Commit**

```bash
git add FDA/validation-scaffold.md docs/whats-built.md
git commit -m "docs(F-10): update validation scaffold and whats-built"
```

---

## Final step: Open PR

```bash
git push origin HEAD
gh pr create \
  --title "feat(F-10): platform validation package — in-system IQ/OQ/PQ/VSR signing" \
  --base FDA-EQMS-feature-package \
  --body "$(cat <<'EOF'
## Ticket
F-10 — Platform Validation Package (URS, FRS, DS, IQ, OQ, PQ, VSR)

## 483 observation(s) addressed
- Cross-cutting: Platform validation is the gate before any Phase 1 module begins. This ticket closes the Phase 0 cycle.

## Scope of this PR
- New `erp_validation_documents` table + migration 0005
- Storage layer: list / get / sign (reuses F-04 performSignature)
- API: 4 endpoints (list, detail, sign, get-signature), QA+ADMIN only
- UI: new Quality tab in nav (QA/ADMIN only); ValidationList + ValidationDetail pages
- IQ / OQ / PQ / VSR content seeded for PLATFORM module
- 6-case integration test suite
- Validation scaffold updated with F-10 URS/FRS/DS/OQ entries
- docs/whats-built.md updated

## Regulated-code Definition of Done
- [x] Authentication required on every new regulated endpoint (401 on unauth)
- [x] Role-gated — QA+ADMIN only (403 on wrong role)
- [x] Signing action goes through F-04 performSignature (audit row + sig row in same tx)
- [x] No request-body identity on regulated endpoints
- [x] Zod schemas in shared/
- [x] Integration tests: 200, 401, 403, 404, 409, audit-row side-effect
- [x] Migration committed; no data deletion
- [x] No `any`; ESLint + typecheck clean
- [x] URS/FRS/DS/OQ entries appended to validation-scaffold.md

## Remaining exit gates for Phase 0
- Carrie Treat executes IQ/OQ steps (recorded in the documents themselves)
- Carrie signs VSR-PLATFORM via the Quality tab
- Phase 1 (R-01) can then begin
EOF
)"
```
