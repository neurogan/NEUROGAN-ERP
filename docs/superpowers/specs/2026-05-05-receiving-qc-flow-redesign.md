# Receiving QC Flow Redesign

## Goal

Eliminate the two UX dead-ends in the Receiving workflow — the disconnected COA attachment step and the buried identity confirmation — while remaining compliant with 21 CFR Part 111.

## Problem Summary

Three concrete issues with the current flow:

1. **COA gate blocks QC submission** — the server requires a COA document to exist before approving, but there is no way to create one inline in the receiving workflow. Users must navigate to the COA Library separately, which most never discover.

2. **Partial receipts of the same supplier lot create duplicate lots** — when a second shipment arrives with the same supplier lot number, the system either blocks with a duplicate error or creates a confusing second lot. Under 21 CFR Part 111 §111.3, two partial receipts of the same lot number are the same lot and QC approval carries over.

3. **All workflow steps visible for all material types** — packaging (EXEMPT) sees the same COA/identity steps as active ingredients (FULL_LAB_TEST), confusing warehouse staff.

## FDA Regulatory Basis

- **21 CFR Part 111 §111.75**: Identity testing required per lot for dietary ingredients (active/supporting). Can be satisfied via supplier COA + periodic independent verification.
- **21 CFR Part 111 §111.3**: "Lot" is defined by uniform character — same supplier lot number = same lot. Second partial receipt of an already-approved lot does not require re-testing.
- **21 CFR Part 111 §111.260**: Each receipt event must be documented (quantity, date, supplier lot) for traceability, even when QC is inherited.
- **Packaging (primary/secondary)**: No identity testing requirement. Visual inspection + invoice matching is sufficient.

## Design

### 1. Lot Deduplication on Receiving

When a new receiving record is created, the server checks for an existing lot matching `(lotNumber, productId, supplierId)`:

| Existing lot state | Behaviour |
|---|---|
| None found | Create new lot + receiving record, run full QC workflow |
| Found, status APPROVED | Create receiving record linked to existing lot, set status = APPROVED immediately, skip QC workflow entirely |
| Found, status QUARANTINED / PENDING_QC | Create receiving record linked to existing lot, run QC workflow as normal |

No schema changes required. The new receiving record is a traceability/quantity entry; the lot-level QC clearance already covers it.

### 2. Adaptive Workflow Steps in the UI

The receiving detail panel shows only the steps relevant to the material's `qcWorkflowType`. The standalone "Attach COA" step is removed entirely.

| `qcWorkflowType` | Steps shown |
|---|---|
| `EXEMPT` | Visual Inspection → Done |
| `COA_REVIEW` | Visual Inspection → QC Sign-off |
| `IDENTITY_CHECK` | Visual Inspection → QC Sign-off (with identity fields) |
| `FULL_LAB_TEST` | Visual Inspection → Sampling → QC Sign-off (with identity + lab fields) |

For inherited-approval receiving records (partial receipt of approved lot), the panel shows a read-only "QC Inherited" state with a link to the original lot.

### 3. Inline COA Inside QC Sign-off

The COA document is created automatically when the QC review is submitted. Users never navigate to the COA Library as part of the receiving workflow.

**COA_REVIEW** — optional COA accordion in the sign-off form:
- Source type (SUPPLIER / INTERNAL / THIRD_PARTY_LAB)
- COA/document number (optional)
- Overall result (PASS / FAIL / CONDITIONAL)
- PDF file upload (optional)
- Skipping this section entirely is allowed — QC can be submitted without it.

**IDENTITY_CHECK** — required identity block in the sign-off form:
- Source type
- COA/document number (optional)
- Identity test method (FTIR / HPTLC / Organoleptic / Other — free text)
- "Identity confirmed" checkbox — **must be checked to enable Approve**
- PDF file upload (optional)

**FULL_LAB_TEST** — identity block (above) plus:
- Lab name
- Analyst name
- Analysis date
- Overall result (PASS / FAIL / CONDITIONAL) — **required to approve**
- PDF file upload (optional)

On submit, the server creates the `erp_coa_documents` row from the inline form data before running the QC approval logic.

### 4. Server-Side Validation Changes

The two hard blocking errors are replaced with workflow-aware validation:

| Workflow | Old gate | New gate |
|---|---|---|
| `EXEMPT` | None | None |
| `COA_REVIEW` | COA must exist | None — COA is optional documentation |
| `IDENTITY_CHECK` | COA must exist + identityConfirmed | `identityConfirmed` must be true (provided inline) |
| `FULL_LAB_TEST` | COA must exist + identityConfirmed | `identityConfirmed` must be true + `overallResult` provided (both inline) |

The "no COA linked" error is removed. The identity confirmation requirement is preserved but satisfied by the inline form, not by a pre-existing COA Library entry.

## Files Affected

| File | Change |
|---|---|
| `server/db-storage.ts` | `createReceivingRecord()` — lot deduplication logic; `qcReviewReceivingRecord()` — inline COA creation before validation, remove "no COA" gate, update identity gate to read inline data |
| `server/routes.ts` | POST `/api/receiving` — pass inline COA data through to storage; POST `/api/receiving/:id/qc-review` — accept inline COA payload |
| `client/src/pages/receiving.tsx` | Adaptive step rendering by `qcWorkflowType`; remove standalone COA step; add inline COA sub-form inside QC sign-off panel; inherited-approval read-only state |
| `shared/schema.ts` | No schema changes — `erp_coa_documents` already has all needed fields |

## Out of Scope

- COA Library page — unchanged, still accessible for historical record review
- Sampling workflow internals — step is preserved for FULL_LAB_TEST, just not shown for other types
- Electronic signature on QC sign-off — unchanged, still required
- Supplier qualification auto-creation on first approval — unchanged
