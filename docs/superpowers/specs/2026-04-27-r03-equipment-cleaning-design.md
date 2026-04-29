# R-03 — Equipment & Cleaning (design)

**Status:** Approved 2026-04-27
**Branch:** `ticket/r-03-equipment-cleaning`
**Spec source:** `/Users/frederikhejlskov/Desktop/NEUROGAN/FDA/neurogan-erp-build-spec.md` §5.3
**Closes 483 observation:** Obs 3 (BPRs incomplete: equipment ID, cleaning records, signatures)

## 1. Goal and scope

Build the Equipment & Cleaning module end-to-end: equipment master, IQ/OQ/PQ
qualifications, calibration schedule + records, cleaning logs, and line
clearances. Wire BPR start to enforce three new gates: overdue calibration,
unqualified equipment, and missing line-clearance at product changeover. All
five sub-tickets in §5.3 (R-03-01 through R-03-05) ship together in one PR.

**Out of scope:** asset depreciation/accounting, maintenance work-order
management, calibration vendor scheduling, equipment imaging.

## 2. Architecture and file structure

```
shared/
  schema.ts                                 — new tables, enum additions
migrations/
  0017_r03_equipment_cleaning.sql           — tables + BPR column rename
  __tests__/0017-r03-rename-bpr-cleaning-text.test.ts
server/
  storage/
    equipment.ts                            — equipment + qualifications + calibration
    cleaning-line-clearance.ts              — cleaning logs + line clearances
  state/
    bpr-equipment-gates.ts                  — three gate-check functions
  routes/
    equipment.ts                            — REST endpoints
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
        index.tsx                           — Master subtab (list + CRUD)
        calibration.tsx                     — Calibration subtab
        cleaning.tsx                        — Cleaning Logs subtab
        line-clearance.tsx                  — Line Clearance subtab
        [id].tsx                            — Equipment detail (Overview, Qualifications, Calibration history)
```

Modules follow the boundaries used by T-07 and T-08: storage layer is the
single owner of DB writes; routes call storage methods inside transactions;
gate logic lives in `server/state/` so it is unit-testable independent of HTTP.

## 3. Schema

### 3.1 New tables (added in `shared/schema.ts` after `productionNotes`)

| Table | Key fields | Notes |
|---|---|---|
| `equipment` | `id` uuid pk, `assetTag` text unique not null, `name` text not null, `model` text, `serial` text, `manufacturer` text, `locationId` varchar fk → `erp_locations.id`, `status` text not null default `ACTIVE` (`ACTIVE`/`RETIRED`), `createdAt` ts | Asset master. |
| `equipment_qualifications` | `id` uuid pk, `equipmentId` uuid fk, `type` text not null (`IQ`/`OQ`/`PQ`), `status` text not null (`PENDING`/`QUALIFIED`/`EXPIRED`), `validFrom` date, `validUntil` date, `signatureId` uuid fk → `erp_electronic_signatures.id` (required to mark `QUALIFIED`), `documentUrl` text, `notes` text, `createdAt` ts | One row per qualification cycle. "Is X qualified now?" = exists row per type with `status='QUALIFIED'` AND `now() BETWEEN validFrom AND validUntil`. |
| `calibration_schedules` | `id` uuid pk, `equipmentId` uuid fk unique, `frequencyDays` integer not null, `nextDueAt` ts not null, `lastRecordId` uuid fk nullable | One per equipment. PASS bumps `nextDueAt`. |
| `calibration_records` | `id` uuid pk, `equipmentId` uuid fk, `performedAt` ts not null, `performedByUserId` uuid fk, `result` text not null (`PASS`/`FAIL`), `certUrl` text, `signatureId` uuid fk not null, `notes` text | Append-only. PASS → schedule's `nextDueAt = performedAt + frequencyDays`. FAIL → schedule unchanged. |
| `cleaning_logs` | `id` uuid pk, `equipmentId` uuid fk, `cleanedAt` ts not null, `cleanedByUserId` uuid fk not null, `verifiedByUserId` uuid fk not null, `method` text, `priorProductId` varchar fk nullable, `nextProductId` varchar fk nullable, `signatureId` uuid fk not null, `notes` text | F-05 dual-verification: storage rejects `cleanedBy === verifiedBy` with 409 `IDENTITY_SAME`. |
| `line_clearances` | `id` uuid pk, `equipmentId` uuid fk, `productChangeFromId` varchar fk nullable, `productChangeToId` varchar fk not null, `performedAt` ts not null, `performedByUserId` uuid fk, `signatureId` uuid fk not null, `notes` text | One row per product changeover. |
| `product_equipment` | `productId` varchar fk, `equipmentId` uuid fk, composite pk (productId, equipmentId) | Junction: per-product equipment list. |
| `bpr_equipment_used` | `bprId` varchar fk → `erp_batch_production_records.id`, `equipmentId` uuid fk, composite pk | Snapshot at BPR start: copies from `product_equipment` for the BPR's product; operator can edit before IN_PROGRESS transition. |

### 3.2 Signature meaning additions

Append to `signatureMeaningEnum` in `shared/schema.ts:834`:

- `EQUIPMENT_QUALIFIED`
- `EQUIPMENT_DISQUALIFIED`
- `CALIBRATION_RECORDED`
- `CLEANING_VERIFIED`
- `LINE_CLEARANCE`

### 3.3 BPR migration (the riskiest piece)

Migration 0017 must NOT delete or overwrite any prod data. Two changes to
`erp_batch_production_records`:

1. `ALTER TABLE erp_batch_production_records RENAME COLUMN cleaning_record_reference TO cleaning_record_legacy_text;`
2. `ALTER TABLE erp_batch_production_records ADD COLUMN cleaning_log_id uuid NULL REFERENCES erp_cleaning_logs(id);`

**Required guards** (per migration_user_safety memory and AGENTS.md):

- Migration must be idempotent: wrap each ALTER in `DO $$ BEGIN ... EXCEPTION
  WHEN duplicate_column THEN NULL; END $$;` so re-running is safe.
- No `UPDATE`, no `DELETE`, no `DROP COLUMN` in this migration. The legacy
  free-text column is preserved indefinitely.
- Migration test (`migrations/__tests__/0016-r03-rename-bpr-cleaning-text.test.ts`)
  verifies: pre-existing rows preserve their legacy text; row count unchanged;
  re-running is a no-op.

Updating the Drizzle TS schema: `cleaningRecordReference` is renamed to
`cleaningRecordLegacyText`, and a new `cleaningLogId` field (uuid, nullable, fk)
is added on `batchProductionRecords`. The single client read at `client/src/pages/bpr.tsx:306`
is updated to read both fields (display the FK'd cleaning log if present, else
show the legacy text as a read-only fallback).

## 4. BPR start-gate enforcement

### 4.1 Where the gates fire

Inside `db-storage.ts:681` — the existing transition `existing.status !==
"IN_PROGRESS"` → `data.status === "IN_PROGRESS"` branch. All three checks run
in the same DB transaction as the status update; any failure throws a 409 and
rolls back. The existing BPR auto-create at `db-storage.ts:740-752` only runs
if all four gates pass.

### 4.2 Gate sequence

Gates run in deterministic order; a failure short-circuits and returns the
first error.

**Gate A — `bpr_equipment_used` populated.** If the row count is zero for the
BPR being started, throw 409 `EQUIPMENT_LIST_EMPTY`. Defensive — UI fills
this; this catches API misuse.

**Gate B — calibration overdue.** For each `equipmentId` in
`bpr_equipment_used`:

```sql
SELECT 1 FROM calibration_schedules
WHERE equipment_id = $1 AND next_due_at < now()
```

Any hit → 409 `CALIBRATION_OVERDUE` with payload
`{ equipment: [{ assetTag, dueAt }, ...] }`.

**Gate C — equipment qualified.** For each `equipmentId`, check that all three
qualification types have at least one row with `status='QUALIFIED'` AND
`now() BETWEEN validFrom AND validUntil`:

```sql
SELECT type FROM equipment_qualifications
WHERE equipment_id = $1
  AND status = 'QUALIFIED'
  AND now() BETWEEN valid_from AND valid_until
GROUP BY type
```

If the returned set does not include all of `{IQ, OQ, PQ}` → 409
`EQUIPMENT_NOT_QUALIFIED` with payload
`{ equipment: [{ assetTag, missingTypes: [...] }, ...] }`.

**Gate D — line clearance at product change.** For each `equipmentId`, find
the prior completed BPR on that equipment:

```sql
SELECT bpr.product_id, bpr.completed_at
FROM erp_batch_production_records bpr
JOIN bpr_equipment_used bu ON bu.bpr_id = bpr.id
WHERE bu.equipment_id = $1 AND bpr.status = 'APPROVED'
ORDER BY bpr.completed_at DESC LIMIT 1
```

If a prior row exists and its `product_id !== current.product_id`:

```sql
SELECT 1 FROM line_clearances
WHERE equipment_id = $1
  AND product_change_to_id = $2  -- current product
  AND performed_at > $3          -- prior_bpr.completed_at
```

No match → 409 `LINE_CLEARANCE_MISSING` with payload
`{ equipment: [{ assetTag, fromProduct, toProduct }, ...] }`.

If no prior BPR exists on the equipment, line clearance is not required (first
batch on a new asset).

### 4.3 Equipment list flow

- Production batch is created in `DRAFT` (current behavior unchanged).
- Operator opens batch detail page → clicks "Start" → modal opens:
  - Pre-filled equipment list from `product_equipment` for the batch's product
  - Operator can add/remove rows
  - Submit writes `bpr_equipment_used` and triggers IN_PROGRESS transition in
    the same request
- All four gates run server-side. UI cannot bypass.

### 4.4 Audit and signatures

- Each gate failure writes one `audit_trail` row: `entityType='production_batch'`,
  `action='START_BLOCKED'`, `meta={ code, equipment }`. QA can later trace
  every blocked start.
- Successful start writes one `START` audit row (existing behavior, preserved).
- Calibration records, qualifications (when promoted to `QUALIFIED`), cleaning
  logs, and line clearances each require a F-04 signature. Gates query
  `signatureId IS NOT NULL` so an unsigned draft record cannot satisfy a gate.

## 5. UI

### 5.1 Top-level placement

New top-level "Equipment" tab. **Temporary placement** — to be folded into a
larger Quality/Operations parent during the deferred UI/UX cleanup pass
(consistent with how OOS placement is currently flagged in
`feedback_prefer_subtabs`).

### 5.2 Subtabs

| Subtab | Route | Purpose |
|---|---|---|
| Master | `/equipment` | Asset list, CRUD, click-through to detail |
| Calibration | `/equipment/calibration` | "Due this week" dashboard, per-equipment schedule + record-PASS/FAIL form |
| Cleaning Logs | `/equipment/cleaning` | Log list + new-log form (dual-verification UI) |
| Line Clearance | `/equipment/line-clearance` | Recent clearances + new-clearance form |

### 5.3 Equipment detail page

`/equipment/:id` — internal tabs: **Overview**, **Qualifications** (IQ/OQ/PQ
each with current status + history), **Calibration** (schedule + history).
Cleaning logs and line clearances filter by equipment too but live under their
own subtabs as the primary entry point (operator workflow > asset workflow).

### 5.4 Role gating

Mirrors the existing role-based page pattern:

- `ADMIN`, `QA_MANAGER` — full access incl. promoting qualifications, retiring
  equipment
- `WAREHOUSE`, `LAB_TECH` — log cleaning, log calibration; cannot promote
  qualification
- All authenticated users — read

### 5.5 BPR start modal (operator UX for the gates)

- Triggered from production-batch detail page "Start" button
- Pre-filled equipment list from `product_equipment`; checkbox add/remove
- On submit, if any gate fails the modal shows a red banner per failed gate
  with an actionable fix-link:

| Code | Banner | Action link |
|---|---|---|
| `CALIBRATION_OVERDUE` | "Calibration overdue on Filler-A (due 2026-04-15)." | "Log calibration record" → `/equipment/calibration?equipment=<id>` |
| `EQUIPMENT_NOT_QUALIFIED` | "Filler-A is missing valid OQ." | "Open equipment" → `/equipment/<id>?tab=qualifications` |
| `LINE_CLEARANCE_MISSING` | "Line clearance from CBD-25mg → CBD-50mg required on Filler-A." | "Log line clearance" → `/equipment/line-clearance?equipment=<id>&from=<id>&to=<id>` |

Each link navigates to the relevant form pre-filtered, so the operator can
resolve in two clicks and retry the start.

### 5.6 Dashboards

- "Calibrations due this week" card on the existing main dashboard
- "Equipment qualifications expiring in 30d" card

## 6. Testing

### 6.1 Test files

| File | What it verifies |
|---|---|
| `r03-equipment-master.test.ts` | Equipment CRUD, role gating on retire/qualification promotion |
| `r03-qualifications.test.ts` | Append qualification record (signed), validity-window query, QA-only promotion, expired qualification not counted |
| `r03-calibration.test.ts` | Schedule create, log PASS bumps `nextDueAt`, log FAIL leaves it overdue, signature required |
| `r03-cleaning.test.ts` | Cleaning-log create with F-05 dual-verification (cleanedBy ≠ verifiedBy → 409 `IDENTITY_SAME`), signature required |
| `r03-line-clearance.test.ts` | Clearance create, signature required, retrieval by equipment + product transition |
| `r03-bpr-gates.test.ts` | All four gates from §4: each blocks correctly, all-pass allows transition, error payloads carry the right context |

### 6.2 Test discipline (T-08 lessons)

Each test file has its own `afterAll` cleaning in FK-safe order:

```
bpr_equipment_used
→ cleaning_logs
→ line_clearances
→ calibration_records
→ calibration_schedules
→ equipment_qualifications
→ product_equipment
→ equipment
→ electronicSignatures
→ auditTrail rows by entityType + userId
→ userRoles
→ users
→ lots
→ products
```

Mirrors `r01-tasks` `cleanDb` pattern. T-06 may need an update if any of its
fixture flows touch the BPR start path (run the suite during implementation
and patch if affected). Tests run in `singleFork` pool against real Postgres
— no mocking the DB (per `feedback_migration_user_safety`).

### 6.3 Migration test

`migrations/__tests__/0017-r03-rename-bpr-cleaning-text.test.ts`:

- Pre-existing BPR row with non-null `cleaning_record_reference` → after
  migration, value is in `cleaning_record_legacy_text`, `cleaning_log_id` is
  NULL.
- Total row count unchanged.
- Running the migration twice is a no-op.

## 7. Validation scaffold entries

Append to `/Users/frederikhejlskov/Desktop/NEUROGAN/FDA/validation-scaffold.md`:

- **URS-R-03-01-01** Equipment master records assetTag, model, serial, location.
- **URS-R-03-01-02** Equipment qualifications IQ/OQ/PQ tracked per asset; QA
  promotion required to mark QUALIFIED.
- **URS-R-03-02-01** Calibration overdue blocks BPR start with 409
  `CALIBRATION_OVERDUE`.
- **URS-R-03-03-01** Cleaning log dual-verification: `cleanedByUserId ≠
  verifiedByUserId`.
- **URS-R-03-04-01** Line clearance required at product change vs prior
  completed BPR on same equipment.
- **VSR-R-03** Module IQ/OQ/PQ summary entry; OQ evidence = `r03-*.test.ts`
  files passing in CI.

## 8. Definition of Done

- [ ] All R-03 test files green in CI
- [ ] Pre-existing tests (t06-lab-results, r01-receiving, f05-state-transitions)
      still green — BPR transition path is shared
- [ ] Migration 0017 applies cleanly, idempotent, no row deletions, migration
      test passes
- [ ] Equipment subtab visible to all roles; promote-qualification button only
      visible to `QA_MANAGER` + `ADMIN`
- [ ] BPR start modal shows actionable error per failed gate
- [ ] Validation-scaffold entries appended in canonical FDA folder
- [ ] PR opened against `FDA-EQMS-feature-package` (per `feedback_git_workflow`)

## 9. Decisions log

These are the calls made during brainstorming on 2026-04-27:

| Decision | Choice | Why |
|---|---|---|
| Scope | All 5 sub-tickets in one ticket | User preference; canonical R-03 ships as one module |
| BPR↔equipment association | Per-product list (`product_equipment`) with operator override at BPR start | Pragmatic given recipes have no versioning yet (Phase 2 MMR ticket); preserves history across recipe edits |
| BPR-start gate scope | Calibration AND qualification (both hard 409) | Defense-in-depth; a 483-relevant rule that the canonical spec only partially covered |
| Line clearance trigger | Product change only, vs last *completed* BPR on equipment | Matches §111.260 minimum and what Obs 3 cited; same-SKU back-to-back batches do not require fresh clearance |
| UI placement | Top-level "Equipment" tab (temporary) | No existing parent fits cleanly; deferred UI/UX cleanup pass will fold this into a larger Quality/Operations tab |
| BPR migration safety | Rename `cleaning_record_reference` → `cleaning_record_legacy_text`; add `cleaning_log_id` FK; never drop legacy column | Per `feedback_migration_user_safety` — production data is signed; nothing destructive |
