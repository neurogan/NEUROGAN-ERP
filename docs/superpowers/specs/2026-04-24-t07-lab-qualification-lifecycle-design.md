# T-07 Lab Qualification Lifecycle — Design Spec

**Goal:** Enforce formal qualification of third-party testing labs before their COAs can be accepted, with full audit trail and electronic signature per 21 CFR Part 11 and §111.75(h)(2).

**Architecture:** A new `erp_lab_qualifications` event-log table records each qualification and disqualification event. Gate 3c in `qcReviewCoa()` is extended to reject COAs from third-party labs that are unqualified or overdue. Two new POST routes drive the qualification workflow with e-signature capture. The existing `LabsSettings.tsx` is extended — no new page.

**Tech Stack:** PostgreSQL + Drizzle ORM, Express/TypeScript routes, React 18 + shadcn/ui, existing `withAudit` + `verifyPassword` patterns.

**Regulatory basis:** 21 CFR §111.75(h)(2) — you must not rely on a third-party COA unless you have confirmed the reliability of that laboratory. 21 CFR Part 11 §11.10(e) — audit trail of all qualification events.

---

## Data Model

### New table: `erp_lab_qualifications`

Mirrors the shape of the existing `erp_supplier_qualifications` table.

| column | type | constraints |
|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() |
| `lab_id` | uuid | FK → erp_labs NOT NULL |
| `event_type` | text | NOT NULL — `QUALIFIED` \| `DISQUALIFIED` |
| `performed_by_user_id` | uuid | FK → erp_users NOT NULL |
| `performed_at` | timestamptz | NOT NULL, default now() |
| `qualification_method` | text | nullable — QUALIFIED events only |
| `requalification_frequency_months` | integer | nullable — QUALIFIED events only |
| `next_requalification_due` | date | nullable — QUALIFIED events only |
| `notes` | text | nullable |
| `signature_id` | uuid | FK → erp_electronic_signatures nullable |

`qualification_method` values: `ACCREDITATION_REVIEW` | `SPLIT_SAMPLE_COMPARISON` | `ON_SITE_AUDIT` | `OTHER`

### Schema additions (shared/schema.ts)

- `auditActionEnum`: add `"LAB_QUALIFIED"` and `"LAB_DISQUALIFIED"`
- `signatureMeaningEnum`: add `"LAB_DISQUALIFICATION"` (the existing `"LAB_APPROVAL"` is used for qualification sign-off)

### No changes to `erp_labs`

Lab status (`ACTIVE` | `INACTIVE` | `DISQUALIFIED`) stays on the labs table. Qualification state is derived from the most recent event in `erp_lab_qualifications`. Disqualification sets `lab.status = DISQUALIFIED` as it does today.

---

## Business Logic

### `recordLabQualification(labId, userId, method, frequencyMonths, notes, signaturePassword)`

1. Verify lab exists and `lab.type = THIRD_PARTY` — 400 otherwise
2. Verify `signaturePassword` against user record — 401 otherwise
3. In a single transaction:
   - Insert e-signature row with `meaning = LAB_APPROVAL`
   - Insert `erp_lab_qualifications` row: `event_type = QUALIFIED`, compute `next_requalification_due = CURRENT_DATE + (frequencyMonths months)`
   - Set `lab.status = ACTIVE` (re-activates if it was INACTIVE)
   - Insert audit trail row: `action = LAB_QUALIFIED`, `entity_type = lab`, `entity_id = labId`
4. Return updated lab

### `recordLabDisqualification(labId, userId, notes, signaturePassword)`

1. Verify lab exists and `lab.type = THIRD_PARTY` — 400 otherwise
2. Verify `signaturePassword` against user record — 401 otherwise
3. In a single transaction:
   - Insert e-signature row with `meaning = LAB_DISQUALIFICATION`
   - Insert `erp_lab_qualifications` row: `event_type = DISQUALIFIED`
   - Set `lab.status = DISQUALIFIED`
   - Insert audit trail row: `action = LAB_DISQUALIFIED`, `entity_type = lab`, `entity_id = labId`
4. Return updated lab

### `getLabQualificationHistory(labId)`

Returns all rows from `erp_lab_qualifications` for the given lab, ordered by `performed_at DESC`, joined to `erp_users` for performer name.

### Gate 3c extension in `qcReviewCoa()`

Current Gate 3c checks `lab.status !== DISQUALIFIED`. T-07 adds — for `THIRD_PARTY` labs only:

1. Fetch most recent `QUALIFIED` event for the lab from `erp_lab_qualifications`
2. If none exists → 422 `"Lab '[name]' has not been qualified. Qualify the lab before accepting COAs."`
3. If `next_requalification_due < CURRENT_DATE` → 422 `"Lab '[name]' requalification is overdue (was due [date]). Requalify the lab before accepting COAs."`

These checks are skipped for:
- `IN_HOUSE` labs (always trusted)
- COAs with no `labId` (supplier COAs)

---

## API

### `POST /api/labs/:id/qualify`

- **Roles:** QA, ADMIN
- **Body:** `{ qualificationMethod: string, requalificationFrequencyMonths: number, notes?: string, signaturePassword: string }`
- **Response:** `200` — updated lab object
- **Errors:** `400` lab not found or not THIRD_PARTY; `401` bad password; `422` validation failure

### `POST /api/labs/:id/disqualify`

- **Roles:** QA, ADMIN
- **Body:** `{ notes?: string, signaturePassword: string }`
- **Response:** `200` — updated lab object
- **Errors:** `400` lab not found or not THIRD_PARTY; `401` bad password

### `GET /api/labs/:id/qualifications`

- **Roles:** any authenticated
- **Response:** `200` — array of qualification events, newest first, each with `{ id, eventType, performedAt, performedByName, qualificationMethod, requalificationFrequencyMonths, nextRequalificationDue, notes }`

Both POST routes run inside `withAudit`.

---

## UI (LabsSettings.tsx)

No new page. All changes are within the existing Settings → Labs tab.

### Third-party lab rows

Each THIRD_PARTY lab row gains:

- **Qualification status badge** (alongside existing status badge):
  - `Qualified · due MM/YYYY` — green, when qualified and not overdue
  - `Not Qualified` — yellow, when no qualification record exists
  - `Overdue · since MM/YYYY` — red, when `next_requalification_due` has passed
- **Qualify button** → modal:
  - Qualification method dropdown (`ACCREDITATION_REVIEW` | `SPLIT_SAMPLE_COMPARISON` | `ON_SITE_AUDIT` | `OTHER`)
  - Requalification frequency in months (number input, default 24)
  - Notes textarea (optional)
  - Password field for e-signature
  - Submit → `POST /api/labs/:id/qualify`
- **Disqualify button** (shown only when lab is ACTIVE/qualified) → modal:
  - Notes textarea (optional)
  - Password field for e-signature
  - Submit → `POST /api/labs/:id/disqualify`

### Qualification history

A collapsible history row beneath each THIRD_PARTY lab (expand chevron). Fetches `GET /api/labs/:id/qualifications` on first expand. Shows a compact timeline: date, event type pill, performer name, method (QUALIFIED events), next due date.

### IN_HOUSE labs

No changes — no qualification controls shown.

---

## Migration

**0015_t07_lab_qualifications.sql** — creates `erp_lab_qualifications` table with all columns and FK constraints.

---

## Testing

### Integration tests (`server/__tests__/t07-lab-qualification.test.ts`)

1. `POST /api/labs/:id/qualify` with valid payload → 200, lab status ACTIVE, qualification record created, audit trail LAB_QUALIFIED
2. `POST /api/labs/:id/qualify` for IN_HOUSE lab → 400
3. `POST /api/labs/:id/qualify` with wrong password → 401
4. `POST /api/labs/:id/disqualify` → 200, lab status DISQUALIFIED, audit trail LAB_DISQUALIFIED
5. `GET /api/labs/:id/qualifications` → returns history array in reverse chronological order
6. Gate 3c: QC review of COA from unqualified THIRD_PARTY lab → 422 "not qualified"
7. Gate 3c: QC review of COA from THIRD_PARTY lab with overdue requalification → 422 "overdue"
8. Gate 3c: QC review of COA from qualified, current THIRD_PARTY lab → 200 (passes)
9. Gate 3c: QC review of COA from IN_HOUSE lab (no qualification record) → 200 (passes — IN_HOUSE exempt)
10. Requalify a disqualified lab → status returns to ACTIVE, new QUALIFIED record is most recent
