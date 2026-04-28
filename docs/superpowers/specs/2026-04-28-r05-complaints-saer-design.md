# R-05 Complaints & SAER — Design

**Status:** DRAFT
**Date:** 2026-04-28
**Closes:** FDA Form 483 Observation 7 (complaints not reviewed by qualified person; AEs not investigated) and Observation 8 (complaint records lack lot number).
**SOP reference:** SOP-QA-007 v1.0, 21 CFR 111 Subpart M, 21 USC 379aa-1.

---

## 1. Architecture (overview)

The ERP becomes the regulated record system for customer complaints from triage onward. Customer-service intake stays in HelpCore (a separate Neurogan-built customer-service platform deployed in its own Railway project with its own Postgres). Once a complaint is escalated past customer service, the ERP runs the workflow: QA triage → investigation (with optional lab retest) → Director-of-Quality disposition signature → close+reply, plus an adverse-event branch with a 15-business-day SAER clock and a MedWatch 3500A submission record.

**Boundary with HelpCore.** HelpCore owns Step 1 of the SOP-QA-007 flow (intake, lot capture). The ERP picks up at Step 2 (triage) and owns Steps 2–11. The two services have no shared database; integration is HTTP-only across two endpoints:

- **Inbound** `POST /api/complaints/intake` — accepts an HelpCore-shaped payload (HMAC-signed) OR a manual paste from QA (session-authenticated). Same endpoint, dual auth path.
- **Outbound** `POST $HELPCORE_BASE_URL/api/erp/complaints/closed` — fired when disposition is signed; HMAC-signed; behind a feature flag (off until HelpCore is ready). Failures retry but do not roll back the ERP-side disposition.

**Out of scope (deferred):**
- Cloudflare Worker / Shopify fulfillment webhook for automatic order→lot enrichment
- Klaviyo lot enrichment
- Backfill tool for pre-2026 historical complaints
- Full CAPA module (Release 2). CAPA gets a stub field (`capa_required` boolean + `capa_ref` text) on the complaint record so the disposition decision is captured in the audit trail.
- HelpCore-side build (separate dev; their markdown spec arrives later — this spec defines the contract they build to)
- Email alerts for SAER clock — the dashboard task tile is the warning surface for now

**Stack reuse.** Express + Drizzle + Zod + React + shadcn/ui + TanStack Query, hash routing, F-04 SignatureCeremony, the existing audit_trail / electronic_signatures plumbing. Same patterns as R-03/R-04. Tasks plug into the existing `getUserTasks` synthesizer (`server/db-storage.ts`) — no new tasks table.

---

## 2. Data model

Migration `0019_r05_complaints_saer.sql`. Six new tables; everything append-only at the audit layer.

### `erp_complaints`
```
id                            uuid pk
helpcore_ref                  text unique not null      -- HelpCore complaint ID, surfaced in UI
source                        enum('HELPCORE','MANUAL') not null
customer_name                 text not null
customer_email                text not null
customer_phone                text null
complaint_text                text not null              -- verbatim from intake
lot_code_raw                  text not null              -- as typed at intake, frozen
lot_id                        uuid null fk lots.id      -- resolved by ERP; null until match
status                        enum('TRIAGE','LOT_UNRESOLVED','INVESTIGATION',
                                   'AE_URGENT_REVIEW','AWAITING_DISPOSITION',
                                   'CLOSED','CANCELLED') not null
severity                      enum('LOW','MEDIUM','HIGH') null
defect_category               enum('FOREIGN_MATTER','LABEL','POTENCY','TASTE_SMELL',
                                   'PACKAGE','CUSTOMER_USE_ERROR','OTHER') null
ae_flag                       boolean not null default false
assigned_user_id              uuid null fk users.id
intake_at                     timestamptz not null
triaged_at                    timestamptz null
investigated_at               timestamptz null
dispositioned_at              timestamptz null
closed_at                     timestamptz null
disposition_signature_id      uuid null fk electronic_signatures.id
disposition_summary           text null
capa_required                 boolean null               -- null until disposition; explicit Y/N required
capa_ref                      text null                  -- free-form; FK to future erp_capas later
helpcore_callback_at          timestamptz null
created_at, updated_at        timestamptz not null
created_by_user_id            uuid not null fk users.id
```

### `erp_complaint_triages`
```
id                            uuid pk
complaint_id                  uuid fk erp_complaints.id
triaged_by_user_id            uuid fk users.id
triaged_at                    timestamptz not null
severity                      enum (same)
defect_category               enum (same)
ae_flag                       boolean not null
batch_link_confirmed          boolean not null
notes                         text null
created_at                    timestamptz not null
```

### `erp_complaint_investigations`
```
id                            uuid pk
complaint_id                  uuid fk erp_complaints.id
investigated_by_user_id       uuid fk users.id
investigated_at               timestamptz not null
root_cause                    text not null
scope                         text not null
bpr_id                        uuid null fk erp_batch_production_records.id
coa_id                        uuid null fk erp_coas.id
retest_required               boolean not null
summary_for_review            text not null              -- the "Package investigation" artifact
packaged_at                   timestamptz null
packaged_by_user_id           uuid null fk users.id
created_at, updated_at        timestamptz not null
```

### `erp_complaint_lab_retests`
```
id                            uuid pk
complaint_id                  uuid fk erp_complaints.id
investigation_id              uuid fk erp_complaint_investigations.id
requested_by_user_id          uuid fk users.id
requested_at                  timestamptz not null
lot_id                        uuid fk lots.id
method                        text not null              -- e.g. "HPLC potency"
assigned_lab_user_id          uuid fk users.id
lab_test_result_id            uuid null fk erp_lab_test_results.id  -- ties to T-06 result
completed_at                  timestamptz null
created_at                    timestamptz not null
```

### `erp_adverse_events`
```
id                            uuid pk
complaint_id                  uuid unique fk erp_complaints.id
serious                       boolean not null
serious_criteria              jsonb not null             -- {death,life_threatening,hospitalization,disability,birth_defect,other}
urgent_reviewed_by_user_id    uuid fk users.id
urgent_reviewed_at            timestamptz not null
medwatch_required             boolean not null
clock_started_at              timestamptz not null       -- = urgent_reviewed_at when serious=true
due_at                        timestamptz not null       -- clock_started_at + 15 BD
status                        enum('OPEN','SUBMITTED','CLOSED') not null
created_at, updated_at        timestamptz not null
```

### `erp_saer_submissions`
```
id                            uuid pk
adverse_event_id              uuid unique fk erp_adverse_events.id
draft_json                    jsonb not null             -- MedWatch 3500A field map
submitted_at                  timestamptz not null
submitted_by_user_id          uuid fk users.id
signature_id                  uuid fk electronic_signatures.id  -- meaning = SAER_SUBMIT
acknowledgment_ref            text null                  -- FDA portal receipt number
submission_proof_path         text null                  -- uploaded screenshot/PDF (base64 stored)
created_at, updated_at        timestamptz not null
```

State transitions go through a storage-layer guard (per F-05). Append-only `audit_trail` rows on every transition with before/after JSON.

**App-settings keys added (or default-inserted by migration):**
- `complaintTriageSlaBusinessDays` (default `1`)
- `dispositionSlaBusinessDays` (default `5`)
- `saerClockBusinessDays` (default `15`)
- `usFederalHolidaysJson` (default = current/next year US federal holidays as ISO date list)

---

## 3. State machine + transition rules

```
                  HelpCore POST or manual paste
                            │
                            ▼
               ┌── lot_code resolves? ──┐
               │ no                     │ yes
               ▼                        ▼
         LOT_UNRESOLVED              TRIAGE
               │                        │
        QA links lot                    │
               └────────►───────────────┤
                                        │
                              QA submits triage
                                  ┌─────┴─────┐
                              ae=false     ae=true
                                  │           │
                                  ▼           ▼
                           INVESTIGATION  AE_URGENT_REVIEW
                              │   │              │
                  retest? yes │   │ no    Director signs urgent review
                              ▼   │              │ (if serious → AE row + clock)
                       erp_complaint_lab_retests │
                              │                  │
                              ▼                  ▼
                          INVESTIGATION ──► AWAITING_DISPOSITION
                                                 │
                                       Director signs disposition
                                       (F-04 ceremony, COMPLAINT_REVIEW)
                                                 │
                                                 ▼
                                              CLOSED
                                                 │
                                       async: HelpCore callback POST
```

**Rules (enforced at the storage layer; verified at the integration test layer):**

1. Cannot transition out of `LOT_UNRESOLVED` to anything except `TRIAGE`, and only after `lot_id` is set.
2. Cannot transition to `CLOSED` without a disposition_signature_id row whose meaning = `COMPLAINT_REVIEW`.
3. Cannot transition to `CLOSED` if `ae_flag = true` AND `medwatch_required = true` AND no `erp_saer_submissions` row exists for the linked AE (Obs 7 closure).
4. Cannot sign disposition if `capa_required` is null — must be explicitly Yes or No (audited).
5. AE clock starts the moment urgent review confirms `serious = true` (not at triage, per the SOP-QA-007 flow — AE flag at triage just routes to urgent review).
6. SAER `due_at` is computed using `usFederalHolidaysJson` + weekend exclusion + `saerClockBusinessDays` setting.
7. SLA breaches (triage older than `complaintTriageSlaBusinessDays`, disposition older than `dispositionSlaBusinessDays`) trigger dashboard warnings, never hard blocks — the SLA is operational, not regulatory. The signature path itself never refuses on SLA grounds.

---

## 4. Integration contract (HelpCore)

### Inbound — `POST /api/complaints/intake`

**Auth:** Either path is accepted; the handler picks based on which presents:
- (a) `X-Helpcore-Signature: hmac-sha256=…` header validated against `HELPCORE_INBOUND_SECRET` env var (when set)
- (b) Authenticated session with role `ADMIN` or `QA` (manual paste)

**Request schema (Zod):**
```ts
{
  helpcoreRef: string,           // unique; dedupe key
  customerName: string,
  customerEmail: string,
  customerPhone?: string,
  lotCode: string,               // raw string; ERP resolves to lot_id
  complaintText: string,
  severity?: "LOW" | "MEDIUM" | "HIGH"
}
```

**Behavior:**
1. Validate Zod schema (400 on failure with field details).
2. Check dedupe by `helpcoreRef` → 409 `{ code: "DUPLICATE_HELPCORE_REF" }` if exists.
3. Resolve `lotCode` → `lots.id` via case-insensitive exact match on `lots.lotNumber`.
4. Insert with status `TRIAGE` if matched, else `LOT_UNRESOLVED`.
5. Source = `HELPCORE` if HMAC auth, else `MANUAL`.
6. Audit row: `COMPLAINT_INTAKE`, before=null, after=row JSON, route=`/api/complaints/intake`, user_id = session user (manual auth) OR the seeded system-helpcore service user (HMAC auth). Migration `0019` inserts a `users` row with email `helpcore-system@neurogan.internal`, name `"HelpCore System"`, an unguessable random password hash (login disabled by convention — no UI surface accepts that email), role `[]`, and a fixed UUID stored as `HELPCORE_SYSTEM_USER_ID` for code-side reference. No new column on `users` is required.
7. Tasks synthesizer picks up the new complaint on next dashboard fetch (state-derived, no explicit emission).

**Response:**
- 201 `{ complaintId, status }`
- 409 `{ code: "DUPLICATE_HELPCORE_REF" }`
- 401 if HMAC invalid + no session
- 403 if session present but role not ADMIN/QA
- 400 if Zod fails

### Outbound — `POST $HELPCORE_BASE_URL/api/erp/complaints/closed`

**Trigger:** Background job (BullMQ-style or simple `setImmediate` queue, whichever the codebase already uses) enqueued in the same transaction as disposition signature commit.

**Auth:** `X-Erp-Signature: hmac-sha256=…` header signed with `HELPCORE_OUTBOUND_SECRET`.

**Body:**
```ts
{
  helpcoreRef: string,
  complaintId: string,
  disposition: {
    summary: string,
    signedAt: string,           // ISO
    signedByRole: "DIRECTOR_OF_QUALITY" | "QA",  // role label, not name
    capaOpened: boolean,
    capaRef: string | null
  }
}
```

**Retry policy:** Exponential backoff up to 24h (e.g. 1m, 5m, 30m, 2h, 6h, 24h). Each attempt logged. After 24h, the job moves to a "needs manual nudge" state — stamps `helpcore_callback_at = null` (still null), surfaces a dashboard tile "Closed complaints with HelpCore-callback failures" to ADMIN. Does NOT roll back the ERP disposition (the regulated record is the ERP's, not HelpCore's).

**Disabled when** `HELPCORE_BASE_URL` env is unset → callback is skipped, `helpcore_callback_at` stays null, QA does manual reply outside the system. No errors, no warnings. This is the day-one mode until HelpCore is ready.

---

## 5. Tasks (extends existing `getUserTasks`)

Generalize the existing `UserTask` interface (`client/src/components/DashboardTasks.tsx:8` and `server/db-storage.ts:3066`) so it can carry both receiving and complaint records:

```ts
type UserTask = {
  id: string;
  taskType: ReceivingTaskType | ComplaintTaskType;
  sourceModule: "RECEIVING" | "COMPLAINT";
  sourceRecordId: string;
  sourceIdentifier: string;     // e.g. "RCV-2026-0042" or "CMP-2026-0007"
  primaryLabel: string;         // material name OR complaint headline (truncated complaintText)
  secondaryLabel: string | null;// supplier OR customer email
  isUrgent: boolean;
  dueAt: string | null;         // ISO; drives SAER clock urgency rendering
};
```

Receiving call-sites are updated mechanically: `receivingRecordId → sourceRecordId`, `receivingIdentifier → sourceIdentifier`, `materialName → primaryLabel`, `supplierName → secondaryLabel`, `sourceModule = "RECEIVING"`. No behavior change for receiving; the test suite for receiving tasks (`server/__tests__/r01-tasks.test.ts`) is updated to the new field names.

**New task types and role mapping:**

| Task type | Role(s) | Source query |
|---|---|---|
| `COMPLAINT_TRIAGE_REQUIRED` | QA, ADMIN | complaints.status = TRIAGE |
| `COMPLAINT_LOT_UNRESOLVED` | QA, ADMIN | complaints.status = LOT_UNRESOLVED |
| `COMPLAINT_INVESTIGATION_REQUIRED` | QA, ADMIN | complaints.status = INVESTIGATION AND no investigation row OR investigation.packaged_at is null |
| `COMPLAINT_AE_URGENT_REVIEW` | QA, ADMIN | complaints.status = AE_URGENT_REVIEW |
| `COMPLAINT_LAB_RETEST` | LAB_TECH, ADMIN | erp_complaint_lab_retests.completed_at is null |
| `COMPLAINT_DISPOSITION_REQUIRED` | QA, ADMIN | complaints.status = AWAITING_DISPOSITION |
| `SAER_DUE_SOON` | QA, ADMIN | adverse_events.status = OPEN AND due_at within 2 BD |
| `SAER_OVERDUE` | QA, ADMIN | adverse_events.status = OPEN AND due_at past now |

**Click-target lookup** (frontend route resolution per task type):
- `COMPLAINT_TRIAGE_REQUIRED` / `COMPLAINT_LOT_UNRESOLVED` / `COMPLAINT_INVESTIGATION_REQUIRED` / `COMPLAINT_AE_URGENT_REVIEW` / `COMPLAINT_DISPOSITION_REQUIRED` → `/quality/complaints/:id`
- `SAER_DUE_SOON` / `SAER_OVERDUE` → `/quality/complaints/:id/ae`
- `COMPLAINT_LAB_RETEST` → `/lab?retest=:id`

---

## 6. UI

**Sub-tab structure under Quality** (matches the existing `/quality/sops` and `/quality/labeling` pattern from R-04):

- `/quality/complaints` — list view: status filters, search by helpcoreRef / customer / lot, date-range filter, AE-only toggle.
- `/quality/complaints/:id` — detail page. Single page with one section per state; the action affordance for the *current* status is rendered at the top, history below. Sections: Intake → Triage → Investigation → Lab Retests → Disposition → Audit. AE branch link if `ae_flag=true`.
- `/quality/complaints/:id/ae` — adverse-event panel: serious-criteria checkboxes, MedWatch 3500A draft form (auto-populated from complaint+AE+lot+BPR), countdown clock, submit ceremony, acknowledgment capture, proof-PDF upload.
- `/quality/complaints/trends` — monthly trend report: groupings by SKU / lot / defect category over a configurable date range, bar chart + table, CSV export. No scheduled email.

**SignatureCeremony usage:**
- `COMPLAINT_REVIEW` meaning at disposition signature (Director of Quality, F-04 inline ceremony).
- `SAER_SUBMIT` meaning at MedWatch submission (Director of Quality, F-04 inline ceremony).
- Manual intake (when QA pastes from HelpCore) does NOT require a signature — it's a record creation, not a regulated transition. Audit trail captures user.
- Triage submit, investigation submit, urgent-review submit do NOT require signatures (per current ERP convention — only state transitions that the regulation specifically calls out require ceremonies).

**Dashboard cards added** (mirror R-04 pattern — three new tiles on the main dashboard):
- "Complaints awaiting triage (≤1 BD)" — count of TRIAGE complaints with intake older than `complaintTriageSlaBusinessDays`.
- "AE clocks due ≤2 BD" — count of `erp_adverse_events` with `due_at` within 2 BD AND status=OPEN.
- "Dispositions awaiting signature (≤5 BD)" — count of AWAITING_DISPOSITION complaints with `triaged_at` older than `dispositionSlaBusinessDays`.

The "My Tasks" tile picks up the new task types automatically once `getUserTasks` is extended.

**MedWatch 3500A draft fields (auto-populated):**
- Section A (patient): from complaint.customerName, complaint.customerPhone, complaint.complaintText (free-text narrative)
- Section B (adverse event): from adverse_events.serious_criteria, complaint.complaintText
- Section C (suspect product): from lot.id → product.name + lot.lotNumber + lot.expirationDate + bpr.bprNumber if linked
- Section D (history): manual entry by Director of Quality
- Section E (initial reporter): from system identity. Migration `0019` seeds three new app_settings keys read here: `facilityName` (default "Neurogan, Inc."), `facilityAddress` (default empty string — operator fills before first SAER submission), `facilityContactPhone` (default empty).

**Two-step UI flow:**
1. **Save draft** — operator fills the form; clicking "Save draft" UPSERTs `erp_saer_submissions.draft_json` with `submitted_at = null`. No signature. Idempotent; can be repeated.
2. **Submit for signing** — operator clicks "Submit MedWatch"; SignatureCeremony opens with `SAER_SUBMIT` meaning. On signed commit: `submitted_at = now()`, `submitted_by_user_id`, `signature_id` set; the AE row moves to `status=SUBMITTED`. The printable HTML view (`/quality/complaints/:id/ae/print`) becomes available — operator prints to PDF, uploads to the FDA portal manually, then returns to the ERP to enter the portal `acknowledgment_ref` and upload the proof screenshot/PDF (which is base64-stored at `submission_proof_path`). Capturing the acknowledgment is a separate, smaller transition that does not require a signature ceremony — it's a record annotation, audit-logged.

---

## 7. Validation / OQ

Six new OQ scripts in `~/Desktop/NEUROGAN/FDA/validation-scaffold.md`. The four current DRAFT URS rows for R-05 stay; OQ rows replace the current `—` placeholders.

| URS | OQ | Purpose |
|---|---|---|
| URS-R-05-01-01 | OQ-R-05-01-01 | Complaint cannot CLOSE without QA review signature; verify block + audit row + 409 error. |
| URS-R-05-02-01 | OQ-R-05-02-01 | SAER clock starts on `serious=true` from urgent review; `due_at` = `clock_started_at + 15 BD` excluding US federal holidays + weekends; `SAER_DUE_SOON` task fires at T-2 BD; `SAER_OVERDUE` task fires past T-0. |
| URS-R-05-03-01 | OQ-R-05-03-01 | MedWatch 3500A draft renders deterministically from a fixed (complaint, AE, lot) tuple — same input → same JSON every time. Submit ceremony stores `acknowledgment_ref` and `submission_proof_path`. |
| URS-R-05-04-01 | OQ-R-05-04-01 | Complaint with unresolved lot cannot transition past `LOT_UNRESOLVED` until `lot_id` is set; QA-link action audited. |
| (cross-cutting) | OQ-R-05-INTAKE | `/api/complaints/intake` accepts both HMAC and session auth; rejects unsigned anonymous; dedupes on `helpcoreRef`; resolves `lotCode → lots.id` with case-insensitive exact match. |
| (cross-cutting) | OQ-R-05-CLOSED-CALLBACK | Outbound `/api/erp/complaints/closed` fires once on disposition commit; HMAC-signed; retries with exponential backoff up to 24h on transient failures; failures surface a dashboard tile but do not roll back the ERP disposition. |

URS rows R-05-01-01 through R-05-04-01 also need to be updated from the current placeholder language to:

- URS-R-05-01-01: Every complaint shall be reviewed by a qualified person (role label "Director of Quality"; ERP-side role flag = `QA` until a distinct `DIRECTOR_OF_QUALITY` flag exists) and signed (meaning = COMPLAINT_REVIEW) before the status transitions to CLOSED. The lot reference must be resolved before disposition signature is permitted.
- URS-R-05-02-01: Serious adverse events identified during urgent review shall start a 15-business-day SAER clock with automated dashboard reminders at T-2 business days and overdue indication past T-0 business days.
- URS-R-05-03-01: SAER submissions shall draft MedWatch 3500A field content deterministically from the linked complaint, adverse-event, and lot/batch records. Submission requires an electronic signature (meaning = SAER_SUBMIT) and capture of the FDA portal acknowledgment reference.
- URS-R-05-04-01: Complaints shall not be CLOSED while in `LOT_UNRESOLVED` state; lot linking is a signed-audit operation by QA.

VSR-R-05 row in the traceability matrix gets populated when OQ scripts are signed.

---

## 8. Roles in the spec (no names)

The flowchart shows people; the spec uses roles only. Personnel may change.

| Flowchart actor | Spec role | ERP role flag |
|---|---|---|
| Customer Service | Customer Service | (HelpCore-side actor; no ERP role required) |
| QC / PCQI | QC reviewer | `QA` |
| Director of Quality | Director of Quality | `QA` (signature ceremony enforces separation-of-duties at signing time, not via a separate role flag) |
| Lab | Lab tech | `LAB_TECH` |

If Director of Quality is later split into its own ERP role, that's a future ticket; R-05 stores the user_id and lets role-based queries do their work via the existing `users.roles` array.

---

## 9. What's deferred to later tickets

- **Full CAPA module (Release 2)** — `capa_required` boolean and `capa_ref` text on the complaint record are placeholders; future migration converts `capa_ref` to a UUID FK to `erp_capas`.
- **Cloudflare Worker / Shopify webhook** for automatic order→lot enrichment.
- **HelpCore-side build** — their dev's spec arrives later; R-05 defines the contract HelpCore builds to.
- **Backfill tool** for 2025–2026 historical complaints.
- **Email alerts** for SAER clock — dashboard task tile is the warning surface for now.
- **DIRECTOR_OF_QUALITY as a distinct ERP role** — currently rolled up under `QA`.

---

## 10. Implementation seam summary

- **One migration** (`0019_r05_complaints_saer.sql`) — six tables + three app_settings rows + one system-helpcore-user UUID seeded.
- **One signature meaning** already exists in `shared/schema.ts:975-976` (`COMPLAINT_REVIEW`, `SAER_SUBMIT`) — no schema enum change needed.
- **One refactor** to `UserTask` interface and `getUserTasks` — generalize from receiving-shape to source-shape; receiving tests updated mechanically.
- **One new dual-auth pattern** at `/api/complaints/intake` — HMAC OR session. Useful template if future external integrations land.
- **One outbound HMAC client** — small new module `server/integrations/helpcore.ts` with retry queue. Feature-flagged off until env is set.
- **No changes** to the SignatureCeremony component — already handles the F-04 pattern.
- **No changes** to the `audit_trail` schema — `COMPLAINT_*` and `SAER_*` actions are free-form strings already supported.
