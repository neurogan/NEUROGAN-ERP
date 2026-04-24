# R-01 Receiving Hardening — Phase 1 Foundations Design

## Overview

This spec covers the foundational layer of receiving hardening for the Neurogan ERP. It introduces an approved materials registry, a labs registry, automatic QC workflow routing, state machine enforcement gates, an immutable identity snapshot on review actions, and a role-specific dashboard tasks widget.

**Regulatory basis:** 21 CFR Part 111 (Dietary Supplement GMPs) — §111.12(c) separation of duties, §111.70 component specifications, §111.75 lot-level verification before use, §111.80(b) quarantine of untested components.

**Scope:** Foundations only. Sampling plan (Z1.4), specification master, OOS flags, and COA automated result parsing are deferred to R-02.

---

## Data Model

### New Tables

#### `erp_labs`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text UNIQUE NOT NULL | |
| address | text | |
| type | `IN_HOUSE` \| `THIRD_PARTY` | |
| is_active | boolean | default true |
| created_at | timestamp | |

Seed on migration:
- Neurogan Labs — IN_HOUSE
- Nutri Analytical Testing Laboratories — THIRD_PARTY

#### `erp_approved_materials`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| product_id | FK → erp_products NOT NULL | |
| supplier_id | FK → erp_suppliers NOT NULL | |
| approved_by_user_id | FK → erp_users NOT NULL | |
| approved_at | timestamptz NOT NULL | |
| notes | text NULLABLE | |
| created_at | timestamptz | |

UNIQUE constraint: `(product_id, supplier_id)`.

---

### Changes to Existing Tables

#### `erp_receiving_records`

| Change | Detail |
|---|---|
| Add `requires_qualification` | boolean, default false. Set true when product+supplier combo is absent from `erp_approved_materials` at creation time. |
| Add `qc_workflow_type` | enum: `FULL_LAB_TEST` \| `IDENTITY_CHECK` \| `COA_REVIEW` \| `EXEMPT`. Auto-set at creation based on material category + qualification status (see Workflow Determination). |
| Modify `visual_exam_by` | text → jsonb `{ userId: string, fullName: string, title: string \| null }`. Immutable snapshot captured at time of visual inspection. |
| Modify `qc_reviewed_by` | text → jsonb `{ userId: string, fullName: string, title: string \| null }`. Immutable snapshot captured at time of QC disposition. |

#### `erp_coa_documents`

| Change | Detail |
|---|---|
| Add `lab_id` | FK → erp_labs NULLABLE. Nullable for backwards compatibility with existing COA rows. |
| Keep `lab_name` | Retained as display fallback for rows without a lab_id. |

#### `erp_lots`

| Change | Detail |
|---|---|
| Fix `quarantine_status` default | Change from `APPROVED` → `QUARANTINED`. Lots created through the receiving workflow were incorrectly defaulting to APPROVED, bypassing quarantine. |

---

## Workflow Determination

`qc_workflow_type` is set automatically at receiving record creation based on two inputs: the product's inventory category and whether the product+supplier combo exists in `erp_approved_materials`.

| Category | Supplier qualification status | `qc_workflow_type` | Tasks routed to |
|---|---|---|---|
| ACTIVE_INGREDIENT | Not in approved_materials | `FULL_LAB_TEST` | QA role (lab tech) |
| ACTIVE_INGREDIENT | In approved_materials | `IDENTITY_CHECK` | RECEIVING role (warehouse) |
| SUPPORTING_INGREDIENT | Not in approved_materials | `FULL_LAB_TEST` | QA role (lab tech) |
| SUPPORTING_INGREDIENT | In approved_materials | `IDENTITY_CHECK` | RECEIVING role (warehouse) |
| PRIMARY_PACKAGING | Any | `COA_REVIEW` | QA role (QC manager) |
| SECONDARY_PACKAGING | Any | `EXEMPT` | No task |
| FINISHED_GOOD | Any | `COA_REVIEW` | QA role (QC manager) |

When `qc_workflow_type = FULL_LAB_TEST` and no matching `erp_approved_materials` row exists, `requires_qualification` is also set to `true`.

---

## State Machine Gates

The existing state machine (`QUARANTINED → SAMPLING → PENDING_QC → APPROVED / REJECTED / ON_HOLD`) is retained. New validation gates are added at specific transitions.

### Gate 1: QUARANTINED → SAMPLING (FULL_LAB_TEST only)

Applicable when `qc_workflow_type = FULL_LAB_TEST`.

**Required before transition:**
- All four visual inspection fields must be non-null and non-empty: `containerConditionOk`, `sealsIntact`, `labelsMatch`, `invoiceMatchesPo`
- `visualExamBy` snapshot must be populated

IDENTITY_CHECK and COA_REVIEW workflows skip the SAMPLING state entirely — they transition directly QUARANTINED → PENDING_QC.

### Gate 2: QUARANTINED → PENDING_QC (IDENTITY_CHECK and COA_REVIEW)

**Required before transition:**
- All four visual inspection fields must be non-null (same as Gate 1)
- `visualExamBy` snapshot must be populated

### Gate 3: PENDING_QC → APPROVED

**Required before transition:**
- At least one COA document must be linked to the lot (`erp_coa_documents` row with matching `lot_id`)

**Side effect (if `requires_qualification = true`):**
- On successful APPROVED transition, system automatically creates an `erp_approved_materials` row: `{ product_id, supplier_id, approved_by_user_id: reviewerId, approved_at: now() }`
- Future receiving records for the same product+supplier will have `requires_qualification = false` and `qc_workflow_type = IDENTITY_CHECK`

### Gate 4: SECONDARY_PACKAGING — no lot created

Receiving records for SECONDARY_PACKAGING category products are created with `qc_workflow_type = EXEMPT`. No lot number is required and no quarantine workflow is triggered. The receiving record serves as a traceability entry only.

---

## API Changes

### New endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/labs` | ADMIN, QA | List all labs |
| POST | `/api/labs` | ADMIN, QA | Create a lab |
| PATCH | `/api/labs/:id` | ADMIN, QA | Update name/address/active status |
| GET | `/api/approved-materials` | ADMIN, QA | List all approved material+supplier combos |
| DELETE | `/api/approved-materials/:id` | QA | Revoke an approval (marks as inactive, not deleted) |
| GET | `/api/tasks` | authenticated | Returns role-specific task list for the current user |

### Modified endpoints

**`POST /api/receiving`**
- After creating the receiving record, look up the product's category and the product+supplier combo in `erp_approved_materials`
- Set `qc_workflow_type` and `requires_qualification` accordingly (tasks are derived at query time from these fields — no separate task table)

**`PUT /api/receiving/:id`** (status transitions)
- Enforce Gate 1 and Gate 2 before allowing QUARANTINED → SAMPLING or QUARANTINED → PENDING_QC transitions
- Return 422 with field-level error detail if gate fails

**`POST /api/receiving/:id/qc-review`** (QC disposition)
- Enforce Gate 3 (COA linked) before APPROVED disposition
- On APPROVED + `requires_qualification`: auto-create `erp_approved_materials` entry in the same transaction

---

## Dashboard Tasks Widget

### `GET /api/tasks`

Returns tasks for the authenticated user based on their roles. A task is a derived view — not a separate task table — computed from the state of receiving records and lots.

**QA role tasks:**
- Lots with `qc_workflow_type = FULL_LAB_TEST` and status `QUARANTINED` or `SAMPLING` → "Full lab test required"
- Lots with `requires_qualification = true` → "New material — qualification required" (shown with warning indicator)
- Lots with status `PENDING_QC` → "Lot pending QC disposition"

**RECEIVING role tasks:**
- Lots with `qc_workflow_type = IDENTITY_CHECK` and status `QUARANTINED` → "Identity check required — verify against supplier COA"
- Lots with status `REJECTED` assigned to a receiving record they created → "Rejected lot — coordinate return or destruction"

**PRODUCTION role tasks:**
- Empty for now. Widget renders with "No tasks" state. Extensible in future tickets.

### UI component

- Placed below the KPI cards on the dashboard, in a narrow left column
- Badge on widget header shows total task count
- Each task shows: task type label, material name, receiving record ID, and date received
- Clicking a task navigates to the relevant receiving record
- Tasks disappear automatically once the triggering condition is resolved (status advanced or lot approved/rejected)

---

## Settings UI Additions

### Labs tab

- Visible to ADMIN and QA roles
- Lists all labs with name, address, type badge (In-House / Third Party), active status
- Add lab form: name (required), address (required), type (required)
- Deactivate/reactivate toggle (soft delete — existing COA links are preserved)

### Approved Materials tab

- Visible to ADMIN and QA roles
- Lists all approved material+supplier combos: material name, supplier name (or "Any"), approved by, approved date, notes
- Read-only list — entries are created automatically on first QC approval
- QA can revoke an approval (flags combo as inactive; future receipts will trigger qualification again)

---

## F-06 Identity Snapshot

`visual_exam_by` and `qc_reviewed_by` are changed from plain `text` to `jsonb` storing `{ userId, fullName, title }` captured at the moment the action is performed.

**Why:** User names and titles can change. Storing only a name string creates an audit gap — you lose the link back to the specific user account. Storing a snapshot with `userId` preserves the link while also preserving the display name/title as it was at the time of the action.

**Migration:** Existing rows where these fields contain a plain name string are migrated to `{ userId: null, fullName: "<existing string>", title: null }`. No data is lost; the display name is preserved.

---

## Testing

**Unit tests:**
- `qc_workflow_type` derivation logic — all 7 category × qualification combinations
- `requires_qualification` flag set correctly at creation
- Gate 1/2: transition rejected when visual inspection fields are missing
- Gate 3: APPROVED transition rejected when no COA linked
- Gate 3 side effect: `erp_approved_materials` row created on first approval

**Integration tests:**
- Full receiving flow: warehouse creates → lab tests → QC approves → lot available in inventory
- First-receipt qualification: `requires_qualification` lot → QC approves → approved_materials row created → second receipt has no qualification flag
- Secondary packaging: receiving record created, no lot, no tasks generated
- `GET /api/tasks` returns correct tasks per role and dismisses resolved tasks
- Labs CRUD: create, update, deactivate

---

## Out of Scope (R-02)

- Z1.4 AQL sampling plan (calculate sample size from lot size)
- Specification master (per-material spec limits)
- Automated COA result parsing and pass/fail against specs
- OOS (out-of-spec) flags
