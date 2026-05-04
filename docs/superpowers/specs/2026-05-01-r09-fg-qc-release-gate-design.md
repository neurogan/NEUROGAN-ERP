# R-09 — Finished-Goods QC Release Gate (Design Spec)

**Date:** 2026-05-01
**Author:** Frederik Hejlskov
**Closes:** FDA Form 483 Observation 5 (§111.123(a)(4))
**Build spec reservation:** `~/Desktop/NEUROGAN/FDA/neurogan-erp-build-spec.md` §6 (revised 2026-05-01)
**Status:** Approved scope, awaiting implementation plan

---

## Goal

Block the existing BPR `qc-review` endpoint from transitioning to `APPROVED_FOR_DISTRIBUTION` until the finished batch has PASSING test results — for every required spec attribute — from labs whose accreditation covers that test category at the time of testing.

## Why

FDA Form 483 Obs 5 cited Neurogan for not formally approving/rejecting finished batches and specifically not catching the 837mg/cap NMN result against a 900mg/cap label claim. R-08 added the Part-11 release-signature ceremony. R-09 adds the structured prerequisite: the test data that the signature attests to.

## Scope decisions (locked 2026-05-01)

1. **Same act:** BPR `qc-review` *is* the release. No separate `releaseSignatures` table — the existing R-08 Part-11 signature on BPR review is the release signature.
2. **Lab-agnostic:** Uses existing `labs` + `labQualifications` infrastructure (T-02, T-07). Whether in-house (Neurogan Labs) or third-party (Eurofins/Alkemist), the gate checks accreditation status + result, not source.
3. **Spec parallels componentSpecs:** New `finishedGoodsSpecs` family rather than extending `componentSpecs` with a scope field. Component specs are in production for Obs 1; don't refactor a working module.
4. **No Shopify integration in R-09.** The compliance gate lives in the ERP. Shopify channel availability propagation moves to its own integration ticket per the 2026-05-01 integration policy.
5. **Failed test → existing OOS investigation workflow** (T-08).

---

## Architecture

### Data model

**Tables (new):**

```sql
finished_goods_specs
  id uuid pk
  product_id uuid fk → erp_products (must be category=FINISHED_GOOD)
  name text not null
  description text
  status text not null default 'ACTIVE'  -- ACTIVE, RETIRED  (entity-level on/off; approval lifecycle is on versions)
  created_at timestamptz
  created_by_user_id uuid fk → erp_users

finished_goods_spec_versions
  id uuid pk
  spec_id uuid fk → finished_goods_specs
  version int not null
  status text not null default 'PENDING_APPROVAL'  -- PENDING_APPROVAL, APPROVED, SUPERSEDED
  approved_by_user_id uuid fk → erp_users (nullable)
  approved_at timestamptz (nullable)
  signature_id uuid fk → erp_electronic_signatures (nullable)
  notes text
  unique(spec_id, version)

finished_goods_spec_attributes
  id uuid pk
  spec_version_id uuid fk → finished_goods_spec_versions
  analyte text not null         -- "Urolithin A", "Lead", "Total Plate Count"
  category text not null         -- NUTRIENT_CONTENT, CONTAMINANT, MICROBIOLOGICAL
  target_value numeric (nullable)
  min_value numeric (nullable)
  max_value numeric (nullable)
  unit text not null              -- "mg/serving", "ppm", "CFU/g"
  required boolean not null default true
  notes text

finished_goods_qc_tests
  id uuid pk
  bpr_id uuid fk → erp_batch_production_records
  lab_id uuid fk → erp_labs
  sample_reference text          -- Eurofins/Alkemist sample ID
  tested_at date not null
  entered_by_user_id uuid fk → erp_users
  coa_document_id uuid fk → erp_coa_documents (nullable; optional PDF attachment)
  notes text
  created_at timestamptz

finished_goods_qc_test_results
  id uuid pk
  test_id uuid fk → finished_goods_qc_tests on delete cascade
  spec_attribute_id uuid fk → finished_goods_spec_attributes
  reported_value numeric not null
  reported_unit text not null
  pass_fail text not null         -- PASS, FAIL, NOT_EVALUATED
  oos_investigation_id uuid fk → erp_oos_investigations (nullable; auto-created on FAIL)
  created_at timestamptz
```

**Enums to add to `audit_action_enum`:**
- `FG_SPEC_CREATED`
- `FG_SPEC_APPROVED`
- `FG_TEST_ENTERED`
- `FG_TEST_RESULT_FAILED`

**Enum to add to `signature_meaning_enum`:**
- `FG_SPEC_APPROVED`

### Workflow

```
1. Production starts → BPR opens (IN_PROGRESS)
2. Production completes → submit-for-review
   [existing gates: cleaning log, reconciliation, deviations all signed]
3. Manual ops: physical sample sent to accredited lab
4. Lab returns COA → LAB_TECH/QA enters into finished_goods_qc_tests
   - Per-attribute results computed PASS/FAIL against active spec version
   - Any FAIL → auto-create OOS investigation, link via oos_investigation_id
5. QA performs BPR qc-review:
   [NEW R-09 gate]: every required spec attribute has at least one PASSING result
                    from a lab whose qualification covered the category at tested_at
   - Pass → existing Part-11 ceremony → APPROVED_FOR_DISTRIBUTION
   - Fail → 409 with structured FG_TESTS_INCOMPLETE response
```

### Gate failure response

```json
{
  "error": {
    "code": "FG_TESTS_INCOMPLETE",
    "message": "Required finished-goods tests missing or failing.",
    "details": {
      "specVersionId": "...",
      "missingAttributes": [{"analyte": "Lead", "reason": "no result"}],
      "failingAttributes": [
        {
          "analyte": "Urolithin A",
          "reportedValue": 660,
          "spec": "≥1000mg/serving",
          "oosInvestigationId": "..."
        }
      ],
      "expiredLabQualifications": []
    }
  }
}
```

### Spec resolution

`getActiveSpec(productId, atDate)` returns the highest version of `finished_goods_specs` for that product where:
- `status = APPROVED`
- `approved_at <= atDate`

Used by:
- The gate at qc-review time (resolved at qc-review timestamp)
- Test entry UI (resolved at test entry time, to determine what attributes to evaluate against)

This means historical batches stay tied to the spec they were tested against, even after a new spec version is approved.

### Spec approval ceremony

Same Part-11 pattern as R-08 deviation review:
- `POST /api/finished-goods-specs/:specId/versions/:versionId/approve`
- Body: `{ password: string }`
- Server verifies password, creates `electronic_signatures` row with meaning `FG_SPEC_APPROVED`, updates spec version `status=APPROVED + approved_at + approved_by_user_id + signature_id`
- Approved versions are immutable: once `status=APPROVED`, attributes cannot be added, removed, or edited. To change a spec, create a new version (the old one transitions to `SUPERSEDED` when the new one is approved).

---

## API surface

### New endpoints

```
# Spec management
POST   /api/finished-goods-specs                                — create spec header (QA, ADMIN)
GET    /api/finished-goods-specs                                — list specs
GET    /api/finished-goods-specs/:specId                        — spec detail with versions
POST   /api/finished-goods-specs/:specId/versions               — create new version (QA, ADMIN)
PATCH  /api/finished-goods-specs/:specId/versions/:vId          — edit attributes while PENDING_APPROVAL
POST   /api/finished-goods-specs/:specId/versions/:vId/approve  — Part-11 sign (QA only)
POST   /api/finished-goods-specs/:specId/versions/:vId/attributes        — add attribute
DELETE /api/finished-goods-specs/:specId/versions/:vId/attributes/:attrId — remove attribute (only while PENDING_APPROVAL)

# Test result entry
POST   /api/batch-production-records/:bprId/finished-goods-tests   — enter test (LAB_TECH, QA, ADMIN)
GET    /api/batch-production-records/:bprId/finished-goods-tests   — list tests for batch
DELETE /api/finished-goods-tests/:testId                            — only if QC review not yet performed; ADMIN only
```

### Modified endpoint

```
POST /api/batch-production-records/:bprId/qc-review
  - Adds gate logic before existing flow:
    1. Resolve active spec for the batch's product at tested_at
    2. Validate every required attribute has a PASSING result from accredited lab
    3. If gate fails → 409 FG_TESTS_INCOMPLETE
    4. Otherwise → existing Part-11 release signature flow (unchanged)
```

### Roles matrix

| Action | LAB_TECH | QA | ADMIN |
|---|---|---|---|
| Create/edit spec (PENDING_APPROVAL) | — | ✓ | ✓ |
| Approve spec (Part-11) | — | ✓ | — |
| Enter test result | ✓ | ✓ | ✓ |
| Delete test result (pre-review) | — | — | ✓ |
| BPR qc-review (release) | — | ✓ | — |

---

## UI surfaces

### 1. Quality → Specs (subtab) — finished-goods spec management

Modeled on the existing component-specs page.
- List view: `Product | Active Version | Status | Last Approved | Actions`
- Click into spec → version history
- Version detail: header metadata + attributes table + "Add new version" / "Approve" buttons
- Approve action opens Part-11 password ceremony dialog

### 2. BPR detail page — Lab Results section

New section between existing Steps and Reconciliation:
- Header showing the active spec version that applies + warning if no spec exists
- Table of submitted tests for this batch: `Lab | Sample Ref | Tested At | Status | Results`
- "Add Test Result" button → dialog
  - Pick lab (filtered to ACCREDITED for spec's analyte categories)
  - Enter sample ref + tested-at date
  - Per-attribute rows: analyte name, target/range, value input, unit (defaults from spec), computed PASS/FAIL badge after entry
- On any FAIL: visible link to the auto-created OOS investigation

### 3. QC Review screen — Release readiness panels

Existing R-08 implementation already shows Cleaning Log + Deviations gate panels. Add a third panel:
- "Finished-Goods Tests" panel: green if all required attrs have PASS results from accredited labs; red otherwise
- If red: lists missing attributes + failing attributes (with OOS investigation links)
- Submit button stays disabled until all three panels are green

### 4. Quality tab badge

"FG Tests Pending" badge showing count of BPRs in `READY_FOR_REVIEW` status with incomplete test results. Click → list view filtered to those.

---

## Edge cases

| Case | Behavior |
|---|---|
| Re-test after FAIL | New `finished_goods_qc_tests` row added. Gate accepts the latest result per analyte (timestamp wins). FAIL records preserved + tied to OOS investigation. |
| Spec v2 approved while batch is mid-flight | Gate uses spec version active at the **test result date**, not at qc-review date. Batches tested under v1 stay tied to v1. |
| Lab qualification expires between test date and QC review | Test result valid (qualification was in scope at test date). Gate computes accreditation against test date, not current date. |
| Product has no APPROVED spec | Gate fails `FG_SPEC_MISSING`. Forces ops to create + approve a spec before any release. |
| Multiple results for same analyte | Latest by `tested_at` wins for gate. All preserved in audit. |
| Wrong analyte/value entered | Standard audit trail catches it; correction = void original (audit row) + enter new test. No mutation. |
| In-flight batches at deploy time | Batches sitting between `submit-for-review` and `qc-review` need test data entered before release. Operational note: deploy during quiet window; flag in-flight count to Head of QC. |
| Already-released batches | Untouched. APPROVED_FOR_DISTRIBUTION records are locked. R-09 only affects future releases. |

---

## Migration

Single migration `0027_r09_fg_qc_release_gate.sql`:
- 5 new tables (specs, versions, attributes, tests, results)
- New audit action enum values
- New signature meaning enum value
- No destructive changes
- No grandfathering (gate applies to all future releases)

---

## Testing

**Unit:**
- `getActiveSpec(productId, atDate)` resolution (current/historical)
- Per-result PASS/FAIL computation (min/max/range edge cases)
- Lab accreditation check (date-bounded scope)

**Integration (vitest + supertest, against real DB):**
- Spec lifecycle: create → add attributes → approve (Part-11) → reject second approval attempt
- Test entry with all-PASS results
- Test entry with FAIL → OOS auto-created
- BPR qc-review gate: missing attribute → 409 FG_TESTS_INCOMPLETE
- BPR qc-review gate: failing attribute → 409 with OOS link
- BPR qc-review gate: expired lab qualification at test date → 409
- BPR qc-review gate: all PASS, accredited → existing Part-11 ceremony succeeds
- Re-test after FAIL → latest wins
- Spec v2 approved mid-flight → batch tested under v1 stays tied to v1

**Audit:**
- Verify `FG_SPEC_APPROVED` audit row written on approval
- Verify `FG_TEST_ENTERED` audit row written on test entry
- Verify gate failures don't write a release signature

---

## Validation (GAMP 5 Cat 5)

- URS-R-09-01-01: Spec management
- URS-R-09-02-01: Test result entry
- URS-R-09-03-01: Release gate logic
- URS-R-09-04-01: OOS auto-trigger on FAIL
- VSR-R-09 signed by Head of QC

---

## Non-goals (explicit — out of scope)

| Item | Reason | Where it lives |
|---|---|---|
| Shopify channel availability propagation | Integration policy 2026-05-01 | Future Shopify ticket |
| Amazon channel propagation | Same | Future Amazon ticket |
| Automated lab COA pickup (SFTP/API) | Manual upload acceptable | R2-07 |
| Recall workflow | Not 483-cited | New backlog item — track if needed |
| Stability testing program | Not 483-cited | R2-01 |
| In-process testing | Not 483-cited | New backlog item — track if needed |
| Per-bottle / per-unit test data | Industry tests batches, not bottles | Never |
| Automated PDF parsing of COAs | Operational nice-to-have | New backlog item — low priority |
| Shopify→lot complaint traceback (former R-05-04) | Integration policy | Bundled into Shopify ticket |

---

## Definition of done

1. Migration 0027 applied to staging + prod.
2. All new endpoints respond 200/201 on happy path, 409 on gate failure.
3. UI: Quality → Specs subtab live; BPR detail Lab Results section live; QC review third gate panel live.
4. Integration tests passing in CI.
5. At least one finished-goods spec created + approved in prod (e.g. NMN Capsules).
6. Steven signs VSR-R-09 in-system.
7. Memory + gap analysis updated to mark Obs 5 ✅ closed.

---

**End of R-09 design spec.**
