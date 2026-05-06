# R-11: Receiving QC Flow Redesign

## Goal

Replace the inline COA metadata form (added in R-10) with a proper PDF upload step. Simplify the receiving QC flow to two clearly-separated paths: COA-required materials upload a COA document then sign off; exempt materials sign off directly. Remove all confusion around the Boxes/sampling section.

## Problem with R-10

R-10 removed the hard "no-COA" server gate and added inline fields (source, identity method, analyst, lab name, etc.) to the QC sign-off form. Staff were expected to manually transcribe metadata from a paper/PDF COA into the ERP. This is worse than uploading the document because:

1. The actual COA document isn't retained — only a transcription of it.
2. 21 CFR Part 111 §111.260 requires retaining the COA document as a record, not just metadata about it.
3. The form was confusing — warehouse staff filling in analyst names and identity test methods they don't have.

## Regulatory Basis

- **§111.75(a)(1)(ii)**: Identity testing required for each dietary ingredient received. Satisfied by supplier COA + periodic independent verification, or direct testing.
- **§111.75(c)**: Must periodically verify supplier COA reliability before relying on it. First-time supplier receipt requires independent verification (Internal Lab or Third-party Lab source).
- **§111.260**: Must retain COA documents as records. Uploading the actual PDF satisfies this directly.
- **§111.80**: Statistically valid sampling plan required for lab testing. Not in scope for R-11 — deferred to the lab sampling ticket (see `docs/superpowers/notes/receiving-lab-sampling-context.md`).

## Design

### Two Workflow Paths

**Path A — COA Required** (qcWorkflowType = COA_REVIEW, IDENTITY_CHECK, or FULL_LAB_TEST):

```
Warehouse → Visual Inspection → Submit for QC Review
                                        ↓ (status → PENDING_QC)
QC Staff  → Upload COA (PDF + source + pass/fail)
                                        ↓ (COA attached, status stays PENDING_QC)
QC Staff  → Sign off (disposition + signature ceremony)
                                        ↓ (status → APPROVED / REJECTED)
```

**Path B — No COA Required** (qcWorkflowType = EXEMPT):

```
Warehouse → Visual Inspection → Submit for QC Review
                                        ↓ (status → PENDING_QC)
QC Staff  → Sign off (disposition + signature ceremony)
                                        ↓ (status → APPROVED / REJECTED)
```

### Status Timeline

COA-required records show 5 steps:
1. Received
2. Visual Inspection (completed when `visualExamBy` set)
3. COA Uploaded (completed when ≥1 `erp_coa_documents` row has `receivingRecordId` = this record)
4. QC Sign-off (completed when `qcReviewedBy` set)
5. Released (terminal — APPROVED or REJECTED)

EXEMPT records show 4 steps (same as current, minus the COA step).

### COA Upload Step

Shown in the QC Review panel when: `qcWorkflowType !== "EXEMPT"` AND `record.status === "PENDING_QC"` AND no COA is yet attached.

Fields:
- **PDF file** (required) — converted to base64 client-side before POST
- **Source** (required) — SUPPLIER | INTERNAL_LAB | THIRD_PARTY_LAB
- **Overall Result** (required) — PASS | FAIL | CONDITIONAL
- **Document Number** (optional) — free text, e.g. "COA-2024-001"

After successful upload: show a read-only COA summary card (filename, source, result) with a "Replace" button. Sign-off section unlocks.

**Replace behaviour:** clicking Replace shows the upload form again. Submitting creates a new `erp_coa_documents` row — the previous row is not deleted (audit trail). The gate and timeline check for the presence of any COA row, so the replaced-with row satisfies both.

**Client-side COA detection:** The `GET /api/receiving` and `GET /api/receiving/:id` responses include `coaDocuments: CoaDocument[]` (joined from `erp_coa_documents` where `receivingRecordId` matches). On initial load, `record.coaDocuments.length > 0` determines whether to show the upload form or the summary card. After a successful upload the client appends the returned COA to local record state without re-fetching.

### First-Time Supplier Enforcement

If `record.requiresQualification = true` (applies to FULL_LAB_TEST records for first-time supplier–product pairs), the server rejects `sourceType = "SUPPLIER"` with a 422 error. The client should show this restriction in the source dropdown label (e.g., grey out Supplier with a tooltip: "First-time approval requires independent testing").

### QC Sign-off Gate

Server-side: `qcReviewReceivingRecord()` returns 422 if `qcWorkflowType !== "EXEMPT"` and no `erp_coa_documents` row with `receivingRecordId` = this record exists. This ensures the upload step cannot be bypassed even by API callers.

The identity confirmation gate (`identityConfirmed` check) is removed — the act of uploading a COA with a recorded overall result IS the identity confirmation.

The lab-status gate (INACTIVE/DISQUALIFIED lab → reject) is preserved.

### Boxes / Sampling Section

Hidden: the Boxes section is rendered as `null` in the UI. The data model (`erp_receiving_boxes`) and sampling plan columns are left intact for the future lab sampling ticket.

### Task Queue

Remove the `IDENTITY_CHECK_REQUIRED` task routing to warehouse. Warehouse staff only does visual inspection — they do not handle identity checks. QA continues to receive `PENDING_QC` tasks for all non-EXEMPT records when `status = PENDING_QC`.

## Files Affected

| File | Change |
|---|---|
| `server/db-storage.ts` | Add `uploadCoaForReceivingRecord()`; remove `inlineCoa` param from `qcReviewReceivingRecord()`; add COA-existence gate; join COA docs in `getReceivingRecords()`; remove IDENTITY_CHECK_REQUIRED task routing |
| `server/storage.ts` | Update `IStorage` interface signatures |
| `server/routes.ts` | Add `POST /api/receiving/:id/coa`; remove `inlineCoa` from qc-review route |
| `shared/schema.ts` | Add `coaDocuments: CoaDocument[]` to `ReceivingRecordWithDetails` |
| `client/src/pages/receiving.tsx` | Remove R-10 inline COA form; add COA upload section; update StatusTimeline to 5 steps for COA workflows; hide Boxes section |
| `server/__tests__/r11-receiving-qc-redesign.test.ts` | New test file |

## Out of Scope

- Lab sampling / box sampling — deferred (see notes file)
- COA Library page — unchanged
- File size limits — current base64 inline PostgreSQL storage accepted for this iteration
- Changing who can sign off for EXEMPT records — QC staff sign-off preserved for all workflows
- Sampling workflow (SAMPLING status) — unchanged
