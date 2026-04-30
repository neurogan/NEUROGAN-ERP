# T-08 OOS Investigation Workflow — Design Spec

**Status:** Draft, pending user review
**Date:** 2026-04-25
**Branch:** `ticket/t-08-oos-investigation` (to be created from `FDA-EQMS-feature-package`)
**Owner:** Frederik (solo dev), QC stakeholder: Steven Burgueno (QC Manager)

## 1. Goal

When a lab test result records `pass=false` (out-of-spec), the system automatically opens an investigation row that QC must close with a documented disposition and an electronic signature. Closes the regulatory floor for FDA 483 Observation 4 and SOP-QC-006.

## 2. Regulatory Context

- **21 CFR §111.113** — investigations of unanticipated occurrences (every OOS must be investigated)
- **21 CFR §111.123** — records of QC review (closure decisions must be signed and traceable)
- **SOP-QC-006** OOS Investigation — owned by QC/PCQI, listed in FDA 483 response
- **OOS-2026-001** reference structure (in `FDA/Response Package - FDA Form 483.md` §F): investigation ID, scope (lots/COAs), lead investigator, lot-by-lot disposition, recall decision tree, closure record

## 3. Scope

**In scope (this ticket):**
- Auto-create investigation row on `pass=false` in same DB transaction as the test result insert
- "Mark no investigation needed" fast-path closure with reason code (still requires signature)
- One investigation per `(coa_document_id)` — junction table holds the list of failing test result rows
- Auto-transition lot to `ON_HOLD` on investigation open
- Closure dispositions: `APPROVED`, `REJECTED`, `RECALL`, `NO_INVESTIGATION_NEEDED`
- Structured recall form (class, distribution scope, FDA/customer notification dates, recovery target, additional affected lots)
- F-04 closure ceremony with new meaning code `OOS_INVESTIGATION_CLOSE`
- QC list page + detail dialog + close/no-investigation modals
- Role gating: write actions limited to `QC_MANAGER`, `PCQI`, `ADMIN`

**Out of scope (deferred):**
- Formal spec master (separate `erp_specifications` table) — Approach B in brainstorming, defer to future ticket
- Full CAPA lifecycle (root cause → corrective + preventive actions → effectiveness check) — Phase 2/3
- `RELEASE_WITH_DEVIATION` disposition — explicitly excluded per scope decision
- Lot release workflow change — separate ticket; APPROVED dispositions do NOT auto-release the lot
- Recall PDF attachment — structured form only, no file upload

## 4. Architecture

Mirrors T-07 lab qualifications: routes in `server/routes.ts`, storage methods in `server/db-storage.ts`, schema in `shared/schema.ts`, single-page React UI. No new module folders. Closure ceremonies use the existing `performSignature` wrapper, which inserts the signature and the state mutation in one transaction.

The investigation lifecycle is a thin state machine — `OPEN → RETEST_PENDING ↔ OPEN → CLOSED` — backed by check constraints rather than an event log table. F-03 audit trail (existing) captures every write, which gives us forensic queryability without a dedicated event log.

## 5. Schema (migration 0016_t08_oos_investigations.sql)

### `erp_oos_investigations`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `default gen_random_uuid()` |
| `oos_number` | `text` UNIQUE NOT NULL | Format `OOS-YYYY-NNN`, generated from counter |
| `coa_document_id` | `varchar` NOT NULL | FK → `erp_coa_documents(id)` |
| `lot_id` | `varchar` NOT NULL | FK → `erp_lots(id)`, denormalized from COA |
| `status` | `text` NOT NULL | CHECK IN (`OPEN`,`RETEST_PENDING`,`CLOSED`), default `OPEN` |
| `disposition` | `text` NULL | CHECK IS NULL OR IN (`APPROVED`,`REJECTED`,`RECALL`,`NO_INVESTIGATION_NEEDED`) |
| `disposition_reason` | `text` NULL | Free-text justification |
| `no_investigation_reason` | `text` NULL | CHECK IS NULL OR IN (`LAB_ERROR`,`SAMPLE_INVALID`,`INSTRUMENT_OUT_OF_CALIBRATION`,`OTHER`); only set when `disposition='NO_INVESTIGATION_NEEDED'` |
| `recall_class` | `text` NULL | CHECK IS NULL OR IN (`I`,`II`,`III`) |
| `recall_distribution_scope` | `text` NULL | Narrative |
| `recall_fda_notification_date` | `date` NULL | |
| `recall_customer_notification_date` | `date` NULL | |
| `recall_recovery_target_date` | `date` NULL | |
| `recall_affected_lot_ids` | `varchar[]` NULL | Additional lots beyond `lot_id` |
| `lead_investigator_user_id` | `uuid` NULL | FK → `erp_users(id)`, required at closure |
| `auto_created_at` | `timestamptz` NOT NULL | `default now()` |
| `closed_by_user_id` | `uuid` NULL | FK → `erp_users(id)` |
| `closed_at` | `timestamptz` NULL | |
| `closure_signature_id` | `uuid` NULL | FK → `erp_electronic_signatures(id)` |
| `created_at` | `timestamptz` NOT NULL | `default now()` |
| `updated_at` | `timestamptz` NOT NULL | `default now()` |

**Indexes:**
- Unique partial: `(coa_document_id) WHERE status != 'CLOSED'` — enforces "one open investigation per COA"
- Non-unique: `(status)`, `(lot_id)`, `(auto_created_at DESC)` — for the queue page

**Check constraints:**
- `closed_consistency`: `(status='CLOSED') = (closed_by_user_id IS NOT NULL AND closed_at IS NOT NULL AND closure_signature_id IS NOT NULL AND disposition IS NOT NULL AND lead_investigator_user_id IS NOT NULL AND disposition_reason IS NOT NULL)`
- `recall_fields_required`: `(disposition='RECALL') = (recall_class IS NOT NULL AND recall_distribution_scope IS NOT NULL)`
- `no_investigation_reason_consistency`: `(no_investigation_reason IS NOT NULL) = (disposition='NO_INVESTIGATION_NEEDED')`

### `erp_oos_investigation_test_results` (junction)

| Column | Type | Notes |
|---|---|---|
| `investigation_id` | `uuid` NOT NULL | FK → `erp_oos_investigations(id)` ON DELETE CASCADE |
| `lab_test_result_id` | `uuid` NOT NULL | FK → `erp_lab_test_results(id)` |

PRIMARY KEY `(investigation_id, lab_test_result_id)`

### `erp_oos_investigation_counter`

| Column | Type | Notes |
|---|---|---|
| `year` | `int` PK | |
| `last_seq` | `int` NOT NULL | `default 0` |

Increment idiom (atomic, race-safe):
```sql
INSERT INTO erp_oos_investigation_counter (year, last_seq) VALUES ($1, 1)
  ON CONFLICT (year) DO UPDATE SET last_seq = erp_oos_investigation_counter.last_seq + 1
  RETURNING last_seq;
```

### Migration safety

No `erp_users` or `erp_user_roles` mutations in this migration. Existing `pnpm check:migrations` CI guard passes by default. No explicit user-safety RAISE EXCEPTION needed (only required for migrations that touch user-adjacent tables).

## 6. Signature meaning code

Add `"OOS_INVESTIGATION_CLOSE"` to `signatureMeaningEnum` in `shared/schema.ts:849` (between `LAB_DISQUALIFICATION` and the closing bracket). This is the only enum value added by T-08; both standard closure and fast-path closure use this same meaning code.

## 7. Backend

### Storage methods (`server/db-storage.ts`)

```ts
async getOrCreateOpenOosInvestigation(
  coaDocumentId: string,
  lotId: string,
  labTestResultId: string,
  tx: Tx,
): Promise<OosInvestigation>
```
Idempotent. If a row with `coa_document_id=$1` AND `status IN ('OPEN','RETEST_PENDING')` exists, attach the test result to the junction (ON CONFLICT DO NOTHING) and return the existing row. Else: increment counter for current year, format `OOS-YYYY-NNN` (zero-padded to 3 digits), insert new investigation, attach junction row, return.

```ts
async getOosInvestigationById(id: string): Promise<OosInvestigationDetail | null>
```
Returns investigation + linked lot + linked COA + linked failing test results + closure signature (if any) + lead investigator user info.

```ts
async listOosInvestigations(filters: {
  status?: OosStatus | "ALL";
  lotId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}): Promise<OosInvestigationSummary[]>
```
For the queue page. Default `status='OPEN'`. Sorted by `auto_created_at DESC`.

```ts
async assignOosLeadInvestigator(
  investigationId: string,
  userId: string,
  tx: Tx,
): Promise<OosInvestigation>
```
Sets `lead_investigator_user_id`. Allowed any time before closure. Idempotent (no-op if already assigned to same user).

```ts
async setOosRetestPending(investigationId: string, tx: Tx): Promise<OosInvestigation>
async clearOosRetestPending(investigationId: string, tx: Tx): Promise<OosInvestigation>
```
Status transitions `OPEN ↔ RETEST_PENDING`. Reject if status is `CLOSED`.

```ts
async closeOosInvestigation(
  investigationId: string,
  payload: {
    disposition: "APPROVED" | "REJECTED" | "RECALL";
    dispositionReason: string;
    leadInvestigatorUserId: string;
    recallDetails?: {
      class: "I" | "II" | "III";
      distributionScope: string;
      fdaNotificationDate?: Date;
      customerNotificationDate?: Date;
      recoveryTargetDate?: Date;
      affectedLotIds?: string[];
    };
  },
  closedByUserId: string,
  signatureId: string,
  tx: Tx,
): Promise<OosInvestigation>
```
Validates required fields per disposition (RECALL must include `recallDetails.class` + `distributionScope`). Sets all closure columns. If `disposition='REJECTED'`, also UPDATE `lots.quarantine_status = 'REJECTED'` for `lot_id`. RECALL/APPROVED leave lot in `ON_HOLD` (release is a separate workflow).

```ts
async markOosNoInvestigationNeeded(
  investigationId: string,
  reason: "LAB_ERROR" | "SAMPLE_INVALID" | "INSTRUMENT_OUT_OF_CALIBRATION" | "OTHER",
  reasonNarrative: string,
  leadInvestigatorUserId: string,
  closedByUserId: string,
  signatureId: string,
  tx: Tx,
): Promise<OosInvestigation>
```
Fast-path closure. Sets `disposition='NO_INVESTIGATION_NEEDED'`, `no_investigation_reason=$reason`, `disposition_reason=$reasonNarrative`. Lot stays `ON_HOLD` (does NOT auto-release).

### Hook into `addLabTestResult`

In `server/db-storage.ts`, modify `addLabTestResult` (currently lines 1908-1922):

```ts
async addLabTestResult(coaId, data, userId, tx?) {
  const txOrDb = tx ?? db;
  const [result] = await txOrDb.insert(schema.labTestResults).values({
    ...data,
    coaDocumentId: coaId,
    testedByUserId: userId,
  }).returning();

  if (!data.pass) {
    // existing behavior
    await txOrDb.update(schema.coaDocuments)
      .set({ overallResult: "FAIL" })
      .where(eq(schema.coaDocuments.id, coaId));

    // NEW: T-08 hook
    const coa = await txOrDb.select({ lotId: schema.coaDocuments.lotId })
      .from(schema.coaDocuments)
      .where(eq(schema.coaDocuments.id, coaId))
      .limit(1);
    if (coa[0]) {
      await this.getOrCreateOpenOosInvestigation(coaId, coa[0].lotId, result!.id, txOrDb);
      // Idempotent lot status flip
      await txOrDb.update(schema.lots)
        .set({ quarantineStatus: "ON_HOLD" })
        .where(and(
          eq(schema.lots.id, coa[0].lotId),
          notInArray(schema.lots.quarantineStatus, ["ON_HOLD", "REJECTED"]),
        ));
    }
  }
  return result!;
}
```

The lot-status guard (`notInArray`) preserves terminal `REJECTED` state — once a lot is rejected, a new failing test still attaches to an investigation but does NOT flip the lot back from REJECTED to ON_HOLD.

### Routes (`server/routes.ts`)

| Method | Path | Auth | Body |
|---|---|---|---|
| GET | `/api/oos-investigations` | authenticated | query: `status?`, `lotId?`, `dateFrom?`, `dateTo?` |
| GET | `/api/oos-investigations/:id` | authenticated | — |
| POST | `/api/oos-investigations/:id/assign-lead` | QC_MANAGER, PCQI, ADMIN | `{ userId }` |
| POST | `/api/oos-investigations/:id/retest-pending` | QC_MANAGER, PCQI, ADMIN | — |
| POST | `/api/oos-investigations/:id/clear-retest` | QC_MANAGER, PCQI, ADMIN | — |
| POST | `/api/oos-investigations/:id/close` | QC_MANAGER, PCQI, ADMIN | `{ disposition, dispositionReason, leadInvestigatorUserId, recallDetails?, signaturePassword }` |
| POST | `/api/oos-investigations/:id/mark-no-investigation-needed` | QC_MANAGER, PCQI, ADMIN | `{ reason, reasonNarrative, leadInvestigatorUserId, signaturePassword }` |

The two closure routes wrap their storage call in `performSignature` with `meaning: "OOS_INVESTIGATION_CLOSE"`, `entityType: "oos_investigation"`, `entityId: investigationId`. Signature row insertion and state mutation happen in the same transaction; signature failure rolls back the closure.

## 8. Frontend

**Page:** `client/src/pages/OosInvestigations.tsx` — single file, mirroring `LabsSettings.tsx` shape.

**Layout:**
- Filter bar: status dropdown (default `OPEN`, options `OPEN | RETEST_PENDING | CLOSED | ALL`), lot search input, date range picker, "Refresh" button
- Table columns: OOS number, lot, COA, opened (date), status badge, disposition badge (if closed), days open, "View" button
- Empty state: "No OOS investigations match the current filters."

**Detail dialog (opens on "View"):**
- Header: OOS number, lot link, COA link, status badge, disposition badge, days open
- Section: "Failing test results" — table of analyte, spec range, result, units (from `notes`), technician, tested-at
- Section: "Investigation log" — filtered audit trail entries where `entityType='oos_investigation'` AND `entityId=:id`
- Section: "Lead investigator" — name + "Assign me" button (only enabled if user has QC role and is not currently the lead)
- Section: "Status actions" (only if QC role and not closed):
  - "Mark retest pending" / "Clear retest pending" toggle button
  - "Mark no investigation needed" button → opens NoInvestigationNeededModal
  - "Close investigation" button → opens CloseInvestigationModal
- After closure: section becomes read-only summary with disposition, reason, signature link

**NoInvestigationNeededModal:**
- Reason dropdown: `LAB_ERROR | SAMPLE_INVALID | INSTRUMENT_OUT_OF_CALIBRATION | OTHER`
- Narrative textarea (required)
- Signature password input
- Submit calls `POST /mark-no-investigation-needed`; rejects if no `lead_investigator_user_id` set

**CloseInvestigationModal:**
- Disposition dropdown: `APPROVED | REJECTED | RECALL`
- Reason textarea (required)
- If `RECALL` selected, expand structured recall form:
  - Class radio: I / II / III
  - Distribution scope textarea (required)
  - FDA notification date picker
  - Customer notification date picker
  - Recovery target date picker
  - Additional affected lots multi-select (chips, queries `/api/lots`)
- Signature password input
- Submit calls `POST /close`; rejects if no `lead_investigator_user_id` set

**Side nav link:** add "OOS Investigations" entry under the Lab section, visible to roles `QC_MANAGER`, `PCQI`, `ADMIN`. Badge with count of `OPEN+RETEST_PENDING` investigations.

## 9. Data flow

1. Lab tech submits COA + test results via existing T-06 flow
2. `addLabTestResult` sees `pass=false` → updates `coa.overallResult='FAIL'` (existing) → calls `getOrCreateOpenOosInvestigation` → flips `lot.quarantine_status` to `ON_HOLD` (idempotent guard) — all in same `tx`
3. Investigation appears in QC queue (default filter `status=OPEN`)
4. QC opens detail, clicks "Assign me as lead investigator"
5. QC chooses path:
   - **Fast-path:** "Mark no investigation needed" → reason + narrative + signature → status flips to CLOSED with `disposition='NO_INVESTIGATION_NEEDED'`. Lot stays `ON_HOLD`.
   - **Standard:** optionally toggle RETEST_PENDING while waiting on retest results → "Close investigation" → pick disposition → fill required fields → signature → status flips to CLOSED. If `disposition='REJECTED'`, lot flips to `REJECTED`. If `APPROVED` or `RECALL`, lot stays `ON_HOLD`.

## 10. Error handling

| Scenario | Behavior |
|---|---|
| Concurrent failing inserts on same COA | Unique partial index prevents duplicate OPEN; second insert path catches the conflict, looks up the existing OPEN investigation, attaches via junction (ON CONFLICT DO NOTHING) |
| Closure with missing required fields per disposition | API layer Zod validation rejects 400; DB CHECK constraint is the second line of defense |
| Signature password wrong during closure | `performSignature` throws → tx rolls back → investigation stays OPEN |
| Lot is already in REJECTED state when failing test arrives | Investigation auto-creates as normal; lot status guard preserves REJECTED (does NOT flip back to ON_HOLD) |
| `lead_investigator_user_id` not set when closure is attempted | API rejects 422 with clear error before signature attempt |
| Counter year wraps (Dec 31 → Jan 1) | New row inserted for the new year via `ON CONFLICT (year) DO UPDATE`; sequence resets to 001. `oos_number` is unique because the year prefix differs. |
| User with no QC role attempts to close | Route-level role check returns 403 before reaching storage |

## 11. Testing strategy

### Unit / storage tests (TDD, in `server/db-storage.test.ts` or co-located)
- `getOrCreateOpenOosInvestigation` idempotency: second call with same COA returns same investigation, attaches second test result to junction
- `getOrCreateOpenOosInvestigation` counter: format `OOS-2026-001`, second this-year creates `OOS-2026-002`, year rollover creates `OOS-2027-001`
- `closeOosInvestigation` happy paths per disposition (APPROVED, REJECTED, RECALL): all closure fields set, status=CLOSED
- `closeOosInvestigation` validation: RECALL without `recall_class` rejects; REJECTED flips lot to REJECTED; APPROVED leaves lot ON_HOLD
- `markOosNoInvestigationNeeded`: closure fields set with `disposition=NO_INVESTIGATION_NEEDED`, lot stays ON_HOLD
- Retest transitions: OPEN → RETEST_PENDING → OPEN → CLOSED
- Closure on already-CLOSED investigation rejects
- `addLabTestResult` hook: failing result with no existing investigation creates one + flips lot to ON_HOLD; failing result on REJECTED lot creates investigation but doesn't change lot status

### Integration test (end-to-end DB)
- Create lot → COA → submit failing test result → verify investigation auto-created and lot ON_HOLD
- Submit second failing test result on same COA → verify same investigation, both results in junction
- QC closes with RECALL disposition → verify all recall fields persisted, signature linked, lot still ON_HOLD

### Frontend smoke test
- List page renders with filter, queue updates on close
- Close modal flow: select RECALL → expanded form appears → submit succeeds with valid signature
- Read-only mode after closure: action buttons disabled

### Migration safety
- Existing `pnpm check:migrations` already enforces no DELETE-by-pattern + RAISE EXCEPTION rule on user-adjacent tables. This migration touches no user-adjacent tables, so it passes by construction.
- `server/scripts/dryrun-prod-pending.ts` runs the migration in a rollback-only transaction against prod before merge.

## 12. Files

### Create
- `migrations/0016_t08_oos_investigations.sql`
- `migrations/meta/0016_snapshot.json` (drizzle-kit generated)
- `client/src/pages/OosInvestigations.tsx`
- `client/src/components/oos/CloseInvestigationModal.tsx`
- `client/src/components/oos/NoInvestigationNeededModal.tsx`
- `client/src/components/oos/RecallDetailsForm.tsx`

### Modify
- `shared/schema.ts` — add `signatureMeaningEnum` value `OOS_INVESTIGATION_CLOSE`; add Drizzle definitions for `oosInvestigations`, `oosInvestigationTestResults`, `oosInvestigationCounter`; export TS types
- `server/db-storage.ts` — add storage methods (§7); modify `addLabTestResult` to call hook
- `server/routes.ts` — add 7 new routes (§7)
- `client/src/App.tsx` (or router) — register `/oos-investigations` route
- `client/src/components/Sidebar.tsx` (or equivalent nav) — add link with role gating + open-count badge
- `migrations/meta/_journal.json` — drizzle-kit appends 0016 entry

## 13. Estimated breakdown

7 tasks, ~1 sprint:
1. Migration 0016 + Drizzle schema additions + signature enum value
2. OOS-YYYY-NNN counter helper + tests (unit-test the increment idiom in isolation)
3. Storage methods + tests (TDD per method, including hook)
4. Route handlers + `performSignature` integration + route tests
5. List page + detail dialog + filters
6. Close modals (CloseInvestigationModal + NoInvestigationNeededModal + RecallDetailsForm)
7. Side-nav link + role gating + open-count badge + smoke test

## 14. Open questions

None at design time. All scope decisions locked during brainstorming on 2026-04-25.

---

**Self-review checklist:**
- [x] No TBD/TODO placeholders
- [x] No internal contradictions (lot-status behavior consistent across §7 hook, §7 closeOosInvestigation, §10 error handling)
- [x] Disposition enum consistent everywhere (§3 in-scope, §5 schema, §7 storage, §8 modal, §10 error handling)
- [x] Signature meaning code referenced consistently as `OOS_INVESTIGATION_CLOSE` (§6, §7, §10)
- [x] Field names match between schema (§5), storage methods (§7), and routes (§7) — `lead_investigator_user_id`, `coa_document_id`, `quarantine_status` all consistent
- [x] Junction table cardinality clear: one investigation per COA, multiple test results per investigation
- [x] Migration safety addressed (§5, §11)
