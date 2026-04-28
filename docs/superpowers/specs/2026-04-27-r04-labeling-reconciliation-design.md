# R-04 Labeling & Reconciliation — Design Spec

**Status:** Draft, pending user review
**Date:** 2026-04-27
**Branch:** `ticket/r-04-labeling-reconciliation` (created from `FDA-EQMS-feature-package`)
**Owner:** Frederik (solo dev), QC stakeholder: Steven Burgueno (QC Manager)

## 1. Goal

Capture every label that leaves the label cage, tie each to a BPR and an artwork version, force a reconciliation at BPR close, and refuse to close any BPR whose `issued − applied − destroyed − returned` variance exceeds tolerance without a signed deviation. Closes FDA Form 483 **Observation 9** (no reconciliation of label/packaging issuance vs. use vs. return — §111.415(f), §111.260(g)) and the ERP-side of **Observation 10** (no written labeling/packaging SOPs — §111.415).

## 2. Regulatory Context

- **21 CFR §111.260(g)** — BPR must include identity of unique labels used and a label reconciliation record
- **21 CFR §111.415(f)** — packaging/labeling operations require a written reconciliation
- **21 CFR §111.415** — labeling/packaging SOPs requirement (Obs 10)
- **21 CFR Part 11** — electronic signatures on QA approvals + reconciliation closure
- **SOP-PR-012** Label Reconciliation — defines tolerance (per app_settings)
- **SOP-PR-013** Labeling/Packaging Operations — versioned reference cited from BPR steps

## 3. Scope

**In scope (this ticket):**
- Per-product artwork master with versioning + QA approval ceremony (F-04 `ARTWORK_APPROVED` / `ARTWORK_RETIRED`)
- Software label cage: spool inventory with check-out flow tied to BPR
- Issuance log: spool → BPR check-out events with quantity
- Print job audit trail per actual print event, written by an injectable `LabelPrintAdapter`
- Two adapter implementations: `ZplOverTcpAdapter` (production default) and `StubAdapter` (CI/dev)
- Reconciliation form at BPR close with file-upload proof
- BPR completion gate: `IN_PROGRESS → COMPLETE` blocked unless reconciliation row exists
- Out-of-tolerance gate: closure blocked unless deviation linked
- Minimal `erp_sops` table + `sopCode` / `sopVersion` columns on `bpr_steps` (Obs 10)
- New top-level "Quality" tab housing Labeling subtab + SOPs subtab + (future migration) Validation
- Role gating: write actions limited to `QA`, `QC_MANAGER`, `PCQI`, `PRODUCTION`, `ADMIN` per surface
- Module IQ/OQ/PQ summary record (VSR-R-04)

**Out of scope (deferred):**
- MMR linkage (`artwork-vs-MMR check at BPR creation`) — MMR is Phase 2
- R-05 Complaints, R-06 Returns, Validation page migration into the new Quality tab — separate tickets; only the Quality routing scaffold ships in R-04
- In-browser label preview / WYSIWYG artwork editor — out, artwork is uploaded as a vendor-rendered PDF/PNG
- Multi-printer fleet management — single configured printer per environment
- Spool barcode scanning — manual spool number entry suffices for v1
- Webcam proof capture — file upload only

## 4. Architecture

Schema additions in `shared/schema.ts`. Routes added to `server/routes.ts`. Storage helpers in new files under `server/storage/`. Print adapter under new `server/printing/` module. UI under new `client/src/pages/quality/` directory with router entries for `/quality/labeling/*` and `/quality/sops`.

The BPR completion gate extends the existing R-03 gate framework (`server/state/bpr-completion-gates.ts` will be the parallel of `bpr-equipment-gates.ts` — created in this ticket since BPR completion currently has no gate framework).

```
                 ┌──────────────┐
                 │ label_artwork│      QA approves a version (F-04)
                 └──────┬───────┘
                        │ artworkId
                ┌───────▼──────┐
                │ label_spools │      Spool received into cage (F-04)
                └───────┬──────┘
                        │ spoolId
        ┌───────────────▼────────────────┐
        │ label_issuance_log             │   Operator checks out spool to BPR
        └───────────────┬────────────────┘
                        │ issuanceLogId
                ┌───────▼────────┐
                │ label_print_jobs│  Print event (F-04 LABEL_PRINT_BATCH)
                └─────────────────┘
                        ║
                        ║ at BPR close
                        ▼
                ┌─────────────────────┐
                │ label_reconciliations│  F-04 LABEL_RECONCILED
                │ (UNIQUE bprId)       │  variance + proofUrl + optional deviationId
                └─────────────────────┘
```

Adapter selection is a runtime concern: `getLabelPrintAdapter()` reads `app_settings.labelPrintAdapter` and returns the configured instance. Tests inject `StubAdapter` directly via DI in route handlers (the route reads from a module-level factory that tests can override).

## 5. Schema (migration `0018_r04_labeling_reconciliation.sql`)

### `erp_label_artwork`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `product_id` | varchar FK → `erp_products.id` | NOT NULL |
| `version` | text | e.g. `"v3"`; UNIQUE per `(product_id, version)` |
| `artwork_file_name` | text | original filename |
| `artwork_file_data` | text | base64-encoded vendor artwork (PDF or image), matches `erp_supplier_documents` pattern |
| `artwork_mime_type` | text | `application/pdf` \| `image/png` \| `image/jpeg` |
| `variable_data_spec` | jsonb | `{"lot":true,"expiry":true,"mfgDate":false}` — declares which fields the print path renders |
| `status` | text | `DRAFT` \| `APPROVED` \| `RETIRED` |
| `approved_by_signature_id` | uuid FK → `erp_electronic_signatures.id` | nullable until APPROVED |
| `approved_at` | timestamp | nullable until APPROVED |
| `retired_by_signature_id` | uuid FK | nullable |
| `retired_at` | timestamp | nullable |
| `created_at`, `updated_at` | timestamp | |

CHECK: `(status = 'APPROVED') = (approved_by_signature_id IS NOT NULL AND approved_at IS NOT NULL)`
CHECK: `(status = 'RETIRED') IMPLIES (retired_by_signature_id IS NOT NULL)`
UNIQUE `(product_id, version)`

### `erp_label_spools`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `artwork_id` | uuid FK → `erp_label_artwork.id` | NOT NULL |
| `spool_number` | text | vendor-assigned; UNIQUE per `(artwork_id, spool_number)` |
| `qty_initial` | integer | labels at receive |
| `qty_on_hand` | integer | decremented on issuance; CHECK `>= 0` |
| `location_id` | varchar FK → `erp_locations.id` | nullable; physical cage location |
| `status` | text | `ACTIVE` \| `DEPLETED` \| `QUARANTINED` \| `DISPOSED` |
| `received_by_signature_id` | uuid FK | NOT NULL — F-04 `LABEL_SPOOL_RECEIVED` |
| `received_at` | timestamp | NOT NULL |
| `disposed_by_signature_id` | uuid FK | nullable |
| `disposed_at` | timestamp | nullable |

CHECK: `qty_on_hand >= 0 AND qty_on_hand <= qty_initial`
CHECK: `(status = 'DISPOSED') IMPLIES (disposed_by_signature_id IS NOT NULL)`
INDEX `(artwork_id, status)` — for "active spools per artwork" lookup

### `erp_label_issuance_log`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `bpr_id` | uuid FK → `erp_batch_production_records.id` | NOT NULL |
| `spool_id` | uuid FK → `erp_label_spools.id` | NOT NULL |
| `artwork_id` | uuid FK | NOT NULL — denormalized for audit invariance |
| `quantity_issued` | integer | CHECK `> 0` |
| `issued_at` | timestamp | NOT NULL |
| `issued_by_user_id` | varchar FK → `erp_users.id` | NOT NULL |

INDEX `(bpr_id)` — sum-by-BPR for reconciliation `issued`
INDEX `(spool_id)` — for spool history

Issuance creates a row AND atomically decrements `erp_label_spools.qty_on_hand` in the same transaction. If `qty_on_hand` would go negative, the operation fails with `INSUFFICIENT_SPOOL_QTY` (HTTP 409).

### `erp_label_print_jobs`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `issuance_log_id` | uuid FK → `erp_label_issuance_log.id` | NOT NULL |
| `lot` | text | NOT NULL |
| `expiry` | date | NOT NULL |
| `qty_printed` | integer | CHECK `> 0` |
| `adapter` | text | `ZPL_TCP` \| `STUB` |
| `status` | text | `SUCCESS` \| `FAILED` \| `PARTIAL` |
| `result_json` | jsonb | adapter response + diagnostics |
| `printed_at` | timestamp | NOT NULL |
| `printed_by_user_id` | varchar FK | NOT NULL |
| `signature_id` | uuid FK | NOT NULL — F-04 `LABEL_PRINT_BATCH` |

A failed/partial job stays in the audit; no automatic rollback of the issuance row (the operator may re-print without checking out a new spool).

### `erp_label_reconciliations`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `bpr_id` | uuid FK | UNIQUE — one reconciliation per BPR |
| `issued` | integer | server-computed sum of issuance_log rows |
| `applied` | integer | operator-entered |
| `destroyed` | integer | operator-entered |
| `returned` | integer | operator-entered |
| `variance` | integer | server-computed: `issued - applied - destroyed - returned` |
| `tolerance_exceeded` | boolean | server-computed: `ABS(variance) > app_settings.labelToleranceAbs` |
| `proof_file_name` | text | original filename of operator-uploaded proof |
| `proof_file_data` | text | base64-encoded proof (image or PDF) |
| `proof_mime_type` | text | `image/jpeg` \| `image/png` \| `application/pdf` |
| `signature_id` | uuid FK | NOT NULL — F-04 `LABEL_RECONCILED` |
| `reconciled_at` | timestamp | NOT NULL |
| `reconciled_by_user_id` | varchar FK | NOT NULL |
| `deviation_id` | uuid FK → `erp_bpr_deviations.id` | nullable; required if `tolerance_exceeded=true` |

CHECK: `applied >= 0 AND destroyed >= 0 AND returned >= 0`
CHECK: `(tolerance_exceeded = false) OR (deviation_id IS NOT NULL)`

### `erp_sops`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `code` | text | e.g. `"SOP-PR-013"` |
| `title` | text | |
| `version` | text | |
| `status` | text | `DRAFT` \| `APPROVED` \| `RETIRED` |
| `approved_by_signature_id` | uuid FK | nullable until APPROVED |
| `approved_at` | timestamp | nullable |
| `retired_at` | timestamp | nullable |

UNIQUE `(code, version)`
CHECK: `(status = 'APPROVED') = (approved_by_signature_id IS NOT NULL AND approved_at IS NOT NULL)`

### `erp_bpr_steps` extension

```sql
ALTER TABLE erp_bpr_steps
  ADD COLUMN sop_code text,
  ADD COLUMN sop_version text;
```

Soft FK (enforced in storage layer, not as DB FK because steps may cite SOPs from before the table existed for grandfathered batches). When set, both must reference an `APPROVED` row in `erp_sops`.

### `erp_app_settings` rows

```sql
INSERT INTO erp_app_settings (key, value) VALUES
  ('labelToleranceAbs',  '5'),       -- ±5 labels global tolerance
  ('labelPrintAdapter',  'STUB'),    -- ZPL_TCP | STUB
  ('labelPrintHost',     ''),
  ('labelPrintPort',     '9100')
ON CONFLICT (key) DO NOTHING;
```

## 6. Print adapter pattern

```ts
// server/printing/adapter.ts
export interface LabelPrintAdapter {
  readonly name: "ZPL_TCP" | "STUB";
  print(input: {
    artwork: LabelArtwork;
    lot: string;
    expiry: Date;
    qty: number;
  }): Promise<PrintResult>;
}

export interface PrintResult {
  status: "SUCCESS" | "FAILED" | "PARTIAL";
  qtyPrinted: number;
  diagnostics: Record<string, unknown>;
}
```

`ZplOverTcpAdapter`:
- Reads `labelPrintHost` + `labelPrintPort` from `app_settings`
- Renders ZPL string from `artwork.variableDataSpec` + the variable values
- Opens a TCP socket, writes ZPL, reads response (Zebra printers respond to `~HS` host status query — adapter checks `OK` before treating as success)
- 5-second connect timeout, 10-second total timeout
- On any error: returns `FAILED` with diagnostics; does NOT throw (the route logs the print job either way)

`StubAdapter`:
- Returns `{ status: "SUCCESS", qtyPrinted: input.qty, diagnostics: { stubbed: true } }`
- Used in CI and dev without a printer attached

`getLabelPrintAdapter()` in `server/printing/registry.ts` returns the configured adapter. The route handler imports a `printAdapter` factory which can be overridden in tests via the existing dependency injection pattern (`server/printing/registry.ts` exports a mutable `setLabelPrintAdapter()` for test setup).

## 7. Workflow walkthrough

### 7.1 Artwork lifecycle
1. QA user (`QA` or `QC_MANAGER` role) creates a draft artwork: `POST /api/label-artwork` with `productId`, `version`, `artworkUrl`, `variableDataSpec`. Status `DRAFT`.
2. QA user approves: `POST /api/label-artwork/:id/approve` triggers F-04 ceremony (`ARTWORK_APPROVED`). Status → `APPROVED`. Artwork is now eligible for spool receipt and BPR issuance.
3. QA user retires: `POST /api/label-artwork/:id/retire` triggers F-04 ceremony (`ARTWORK_RETIRED`). Status → `RETIRED`. Existing spools remain checkout-eligible only if their status is `ACTIVE` (a retired artwork blocks creation of new spools but does not invalidate in-flight inventory — operators finish what they have).

### 7.2 Spool intake
1. Receiving operator records new spool: `POST /api/label-spools` with `artworkId`, `spoolNumber`, `qtyInitial`, optional `locationId`. Triggers F-04 ceremony (`LABEL_SPOOL_RECEIVED`). Status `ACTIVE`. `qtyOnHand = qtyInitial`.
2. Operator may dispose a spool (damage, vendor recall): `POST /api/label-spools/:id/dispose` triggers F-04 ceremony with reason. Status → `DISPOSED`.

### 7.3 BPR labeling phase
1. During BPR `IN_PROGRESS`, packaging operator opens "Issue labels": `POST /api/bpr/:id/issue-labels` with `spoolId`, `quantityIssued`. Server validates: BPR is `IN_PROGRESS`, spool is `ACTIVE`, `qty_on_hand >= quantityIssued`. Atomically inserts `label_issuance_log` row + decrements `qty_on_hand`. Returns the issuance row.
2. Operator triggers a print: `POST /api/bpr/:id/print-labels` with `issuanceLogId`, `lot`, `expiry`, `qtyToPrint`. Triggers F-04 ceremony (`LABEL_PRINT_BATCH`). Server invokes `printAdapter.print(...)` and writes a `label_print_jobs` row with the result. The route returns the job row to the UI which renders success/failure inline.
3. Multiple print events per issuance are allowed (jam recovery, batch split). The reconciliation `applied` is the operator's count of labels physically on bottles, not `sum(qtyPrinted)`.

### 7.4 Reconciliation at BPR close
1. Operator opens "Reconcile labels" at BPR close: `POST /api/bpr/:id/reconcile-labels` with `applied`, `destroyed`, `returned`, `proofFile` (multipart). Server computes `issued` (from `sum(label_issuance_log.quantityIssued WHERE bpr_id = :id)`), computes `variance`, computes `toleranceExceeded` against `app_settings.labelToleranceAbs`. If `toleranceExceeded`, operator must include `deviationId` in the request (else 409 `RECONCILIATION_OUT_OF_TOLERANCE`).
2. F-04 ceremony (`LABEL_RECONCILED`). Row inserted. BPR completion gate now passes.

### 7.5 BPR completion gate
- `PATCH /api/bpr/:id/status` (or whichever endpoint transitions to `COMPLETE`) calls `runBprCompletionGates(bprId)` before mutation.
- Gates checked in order:
  1. `LABEL_RECONCILIATION_MISSING` — no reconciliation row → 409
  2. `LABEL_RECONCILIATION_OUT_OF_TOLERANCE_NO_DEVIATION` — defense-in-depth (DB constraint already prevents this state, but the gate gives a sharper error than a constraint violation)

### 7.6 SOP citation on BPR steps
- BPR templates reference SOPs by code+version. When a step is created/updated, server validates: if `sopCode` set, an `APPROVED` row must exist for `(code, version)`. Reject with 409 `SOP_NOT_APPROVED` otherwise.
- The labeling-step-specific check is integrated into the step UI (a dropdown of currently-approved SOPs).

## 8. API surface

```
POST   /api/label-artwork                              QA, QC_MANAGER
GET    /api/label-artwork                              ALL (read-only)
GET    /api/label-artwork/:id                          ALL
POST   /api/label-artwork/:id/approve                  QA, QC_MANAGER (F-04)
POST   /api/label-artwork/:id/retire                   QA, QC_MANAGER (F-04)

POST   /api/label-spools                               PRODUCTION, QA, ADMIN (F-04)
GET    /api/label-spools                               ALL
GET    /api/label-spools/:id                           ALL
POST   /api/label-spools/:id/dispose                   PRODUCTION, QA, ADMIN (F-04)

POST   /api/bpr/:id/issue-labels                       PRODUCTION (no signature — operational, audited)
POST   /api/bpr/:id/print-labels                       PRODUCTION (F-04 LABEL_PRINT_BATCH)
GET    /api/bpr/:id/labels                             ALL — returns issuance + print history
POST   /api/bpr/:id/reconcile-labels                   PRODUCTION (F-04 LABEL_RECONCILED, multipart)
GET    /api/bpr/:id/reconciliation                     ALL

POST   /api/sops                                       QA (F-04 SOP_APPROVED on later approve)
GET    /api/sops                                       ALL
POST   /api/sops/:id/approve                           QA (F-04)
POST   /api/sops/:id/retire                            QA (F-04)
```

Error contract (extends existing GateError pattern from R-03):

```ts
type LabelGateCode =
  | "ARTWORK_NOT_APPROVED"           // issue-labels from non-APPROVED artwork
  | "SPOOL_NOT_ACTIVE"               // issue-labels from non-ACTIVE spool
  | "INSUFFICIENT_SPOOL_QTY"         // qtyOnHand < quantityIssued
  | "RECONCILIATION_ALREADY_EXISTS"  // POST reconcile-labels twice
  | "RECONCILIATION_OUT_OF_TOLERANCE" // toleranceExceeded but no deviationId
  | "LABEL_RECONCILIATION_MISSING"   // BPR complete gate
  | "SOP_NOT_APPROVED"               // BPR step references non-APPROVED SOP
  | "PRINT_ADAPTER_FAILED";          // print job's adapter returned FAILED
```

All responses use `{ status: 409, code, message, payload }` matching R-03's `GateError`.

## 9. UI surface

### 9.1 Routing scaffold
- New `client/src/pages/quality/index.tsx` with subtab nav (matches Equipment subtab pattern from R-03)
- Subtabs: `Labeling` (default), `SOPs`
- Future R-05/R-06 subtabs reserve `Complaints`, `Returns` slots — visible-but-disabled placeholders ship in this ticket so the IA is committed
- Top-level nav grows to 10 tabs (per scope decision C in brainstorming)

### 9.2 Labeling subtab
The Labeling subtab is itself a tabbed view (3 nested tabs):
- **Artwork** — table of all artworks across products with status badge; row click → detail dialog with Approve/Retire actions; Create button → multipart upload form
- **Spools** — table of spools grouped by artwork; columns: spool#, qty on hand / initial, status, location, age; Receive button; Dispose action per row
- **Reconciliation queue** — table of BPRs in `IN_PROGRESS` showing label issuance status: any spools issued? reconciliation submitted? out-of-tolerance? Click into BPR detail's labeling section.

### 9.3 BPR detail page integration
Three new sections appear on `/production/batches/:id`:
- **Issue labels** (visible during `IN_PROGRESS`): button opens modal — pick artwork → pick active spool → enter qty → submit
- **Print labels** (after issuance): per issuance row, "Print" button → modal collects lot, expiry, qty → F-04 ceremony → result toast
- **Reconcile labels** (visible at close): form with `applied`, `destroyed`, `returned`, file upload, optional deviation picker (shown when variance computes out-of-tolerance)

### 9.4 Dashboard integration
Two new dashboard cards (mirroring R-03 calibration/qualification cards):
- **Label artwork pending QA** — count of `DRAFT` artworks (top 5)
- **Reconciliations out-of-tolerance** — count of BPRs with `toleranceExceeded=true` and no deviation linked (top 5)

### 9.5 SOPs subtab
Plain CRUD table of SOPs with code, title, version, status, approved-at. Approve/Retire actions trigger F-04. Used by R-04 for SOP-PR-012 + SOP-PR-013 and by future tickets for the rest.

## 10. Testing strategy

- Migration test: column existence, FKs, CHECK constraints (`migrations/__tests__/0018-r04.test.ts`)
- Storage tests: per file under `server/storage/`, hitting real DB via `describeIfDb`
- Route integration tests under `server/__tests__/r04-*.test.ts`:
  - `r04-artwork.test.ts` — DRAFT/APPROVED/RETIRED transitions, F-04 ceremony, approval=role gate, status invariant
  - `r04-spools.test.ts` — receive/dispose, qty bounds, status invariant
  - `r04-issuance.test.ts` — atomic decrement, refuses non-APPROVED artwork, refuses non-ACTIVE spool, refuses insufficient qty
  - `r04-print.test.ts` — both adapters via `setLabelPrintAdapter()` injection; FAILED job persists with diagnostics
  - `r04-reconciliation.test.ts` — server-computed variance, tolerance check, requires deviation when out-of-tolerance, UNIQUE per BPR
  - `r04-bpr-completion-gate.test.ts` — gate fires on missing reconciliation
  - `r04-sops.test.ts` — DRAFT→APPROVED→RETIRED, BPR step citation validation
- Adapter unit tests: `server/printing/__tests__/zpl-tcp.test.ts` — uses a mock TCP server (Node `net.createServer`) to assert ZPL bytes sent, host status query, timeout behavior
- Frontend smoke: render each new page, ensure data-testids present (per existing pattern)

## 11. Validation entries (additions to `~/Desktop/NEUROGAN/FDA/validation-scaffold.md`)

URS rows (replace existing R-04 placeholder rows):
```
| URS-R-04-01-01 | Only QA-approved artwork may be issued to the packaging line. | §111.415, Obs 9/10 | DRAFT |
| URS-R-04-01-02 | Artwork is versioned; retiring a version blocks new spool intake against it. | §111.415, Obs 9/10 | DRAFT |
| URS-R-04-02-01 | Label issuance recorded against a specific BPR, artwork version, and spool, with quantity-on-hand decrement. | §111.415(f), Obs 9 | DRAFT |
| URS-R-04-02-02 | Each thermal-print event recorded with adapter result; failed prints persist in audit. | §111.260(g), Obs 9 | DRAFT |
| URS-R-04-03-01 | Reconciliation required at BPR close; |variance| > tolerance blocks closure unless a deviation is linked. | §111.415(f), §111.260(g), Obs 9 | DRAFT |
| URS-R-04-04-01 | BPR steps cite the current APPROVED labeling/packaging SOP version. | §111.415, Obs 10 | DRAFT |
```

Traceability matrix rows: one per URS-R-04-XX-YY, columns FRS/DS=`—`, OQ=`OQ-R-04-XX-YY`, observation=`Obs 9` or `Obs 9/10`.

VSR-R-04 record created at PR-merge time (deferred to UI per `feedback_avoid_manual_workflows` exception — VSR records are inherently QA-signed artifacts created in the UI by the QC Manager).

## 12. Open questions

- **File storage for artwork + proof files**: confirmed pattern — `erp_supplier_documents` stores files as base64-in-DB (`file_data text`). R-04 follows the same pattern: `artwork_url` and `proof_url` are misnomers carried over from the build spec; in implementation they'll be `artwork_file_data` (base64) + `artwork_mime_type`, and similarly `proof_file_data` + `proof_mime_type`. Migration to true object storage is a cross-cutting future ticket.
- **Spool location**: `location_id` is nullable for v1. A future enhancement could enforce that all spools live in a `LABEL_CAGE`-typed location. Out of scope for R-04.
- **Per-print signature ergonomics**: F-04 ceremony per print event might be too heavy if operators print 10+ times per batch (jam recovery). A relaxation to "F-04 once per issuance, then unsigned subsequent prints under the same issuance umbrella" is defensible. **Decision for v1: F-04 every print** — preserves the strongest audit trail, can be relaxed in a follow-up if operator feedback warrants.
