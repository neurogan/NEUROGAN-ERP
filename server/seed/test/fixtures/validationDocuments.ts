import { db } from "../../../db";
import * as schema from "@shared/schema";
import { seedIds } from "../../ids";

const IQ_CONTENT = `# Installation Qualification — Platform (IQ-PLATFORM)

**Protocol ID:** IQ-PLATFORM-001
**Version:** 1.0
**Date:** 2026-04-23
**Engineering Owner:** Frederik Hejlskov
**QA Signatory:** Head of QC

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
| Node.js version | >= 20 | _record at execution_ | |
| Commit SHA (from /api/health) | _current deploy_ | _record at execution_ | |

### IQ-02 — Database

| Item | Expected | Actual | Pass/Fail |
|---|---|---|---|
| Postgres version | >= 14 | _record at execution_ | |
| Timezone | UTC | _record at execution_ | |
| Applied migrations | 0000-0005 | _record at execution_ | |

### IQ-03 — Environment variables

Confirm the following are set (values not recorded):

- DATABASE_URL
- SESSION_SECRET (>= 64 hex chars)
- ALLOWED_ORIGINS
- NODE_ENV = production

### IQ-04 — Audit trail immutability

Run from a superuser session:

SELECT has_table_privilege('erp_app', 'erp_audit_trail', 'UPDATE') AS can_update,
       has_table_privilege('erp_app', 'erp_audit_trail', 'DELETE') AS can_delete;

Expected: both columns return false.

### IQ-05 — Backup schedule

| Item | Expected | Actual | Pass/Fail |
|---|---|---|---|
| Backup cadence | Daily | _record at execution_ | |
| Retention | >= 7 days | _record at execution_ | |

## 4. Acceptance

IQ is PASSED when all steps above are recorded and any deviations are raised to change control.

**Disposition:** PASS / FAIL / PASS WITH DEVIATION

Executed by: Frederik Hejlskov — date: ___________`;

const OQ_CONTENT = `# Operational Qualification — Platform (OQ-PLATFORM)

**Protocol ID:** OQ-PLATFORM-001
**Version:** 1.0
**Date:** 2026-04-23
**Engineering Owner:** Frederik Hejlskov
**QA Signatory:** Head of QC

## 1. Scope

Verify that the platform functions as specified in the FRS under challenge conditions. OQ is executed by running the automated test suite and reviewing results.

## 2. Test execution

Run: pnpm test:integration

All tests must pass with zero failures. The suite covers F-01 through F-10 endpoints.

### Users & Roles (F-01)

| Test ID | URS | Description | Expected |
|---|---|---|---|
| OQ-F-01-01 | URS-F-01-01 | Create user, verify audit row | 201, audit row present |
| OQ-F-01-02 | URS-F-01-02 | Role grant/revoke | 200, delta applied |
| OQ-F-01-03 | URS-F-01-03 | Remove last ADMIN | 409 LAST_ADMIN |
| OQ-F-01-04 | URS-F-01-04 | Disable user account | 200, status DISABLED |

### Authentication (F-02)

| Test ID | URS | Description | Expected |
|---|---|---|---|
| OQ-F-02-01 | URS-F-02-01 | Login success | 200, session cookie set |
| OQ-F-02-02 | URS-F-02-02 | Password complexity enforcement | 422 on weak password |
| OQ-F-02-03 | URS-F-02-03 | Session expiry | Session invalid after timeout |
| OQ-F-02-04 | URS-F-02-04 | Lockout after 5 failures | 423 on 6th attempt |

### Audit Trail (F-03)

| Test ID | URS | Description | Expected |
|---|---|---|---|
| OQ-F-03-01 | URS-F-03-01 | Regulated write produces audit row | Row with before/after |
| OQ-F-03-02 | URS-F-03-02 | UPDATE on audit_trail blocked | Permission denied |

### Electronic Signatures (F-04)

| Test ID | URS | Description | Expected |
|---|---|---|---|
| OQ-F-04-01 | URS-F-04-01 | Sign with correct password | Sig row + state change in same tx |
| OQ-F-04-02 | URS-F-04-03 | Sign with wrong password | 401, no state change |
| OQ-F-04-03 | URS-F-04-02 | Manifestation fields present | name, title, meaning, timestamp |

### State Transitions & Record Lock (F-05)

| Test ID | URS | Description | Expected |
|---|---|---|---|
| OQ-F-05-01 | URS-F-05-02 | Legal transition | State advances |
| OQ-F-05-02 | URS-F-05-02 | Illegal transition | 409 ILLEGAL_TRANSITION |
| OQ-F-05-03 | URS-F-05-01 | Update locked record | 423 RECORD_LOCKED |
| OQ-F-05-04 | URS-F-05-02 | Role mismatch | 403 FORBIDDEN |

### Body Identity Rejection (F-06)

| Test ID | URS | Description | Expected |
|---|---|---|---|
| OQ-F-06-01 | URS-F-06-01 | Submit reviewedBy in body | 400 VALIDATION_FAILED |
| OQ-F-06-02 | URS-F-06-01 | Identity from session | Correct userId in audit row |

### Hardening (F-07)

| Test ID | URS | Description | Expected |
|---|---|---|---|
| OQ-F-07-01 | URS-F-07-01 | Unlisted CORS origin | No CORS headers |
| OQ-F-07-02 | URS-F-07-01 | Rate limit at 6th attempt | 429 |
| OQ-F-07-03 | URS-F-07-01 | Request ID round-trip | X-Request-Id in error response |

### Validation Documents (F-10)

| Test ID | URS | Description | Expected |
|---|---|---|---|
| OQ-F-10-01 | URS-F-10-01 | Sign document | 200, status SIGNED, sig row present |
| OQ-F-10-02 | URS-F-10-01 | Wrong password stays DRAFT | 401, status unchanged |
| OQ-F-10-03 | URS-F-10-01 | Re-sign returns 409 | 409 ALREADY_SIGNED |

## 3. Acceptance

OQ is PASSED when pnpm test:integration completes with zero failures.

**Disposition:** PASS / FAIL / PASS WITH DEVIATION

Executed by: Frederik Hejlskov — date: ___________`;

const PQ_CONTENT = `# Performance Qualification — Platform (PQ-PLATFORM)

**Protocol ID:** PQ-PLATFORM-001
**Version:** 1.0
**Date:** 2026-04-23
**Engineering Owner:** Frederik Hejlskov
**QA Signatory:** Head of QC

## 1. Scope

Demonstrate that the platform performs its intended regulated functions under real-world conditions over a 5-working-day shadow run.

## 2. Pre-conditions

- IQ-PLATFORM: PASS
- OQ-PLATFORM: PASS
- All platform users trained on the system
- Paper parallel in place

## 3. Shadow-run procedure

Each day Head of QC performs the listed tasks in the staging environment and records the outcome.

| Day | Task | Pass/Fail | Notes |
|---|---|---|---|
| 1 | Log in with correct password; verify session expires after 15 min idle | | |
| 1 | Attempt login with wrong password 5 times; confirm account locks | | |
| 2 | Create a test user, assign a role, verify audit row present | | |
| 2 | Revoke the role; verify audit row present | | |
| 3 | Transition a test lot: QUARANTINED -> SAMPLING -> PENDING_QC | | |
| 3 | Attempt illegal transition (QUARANTINED -> APPROVED); confirm 409 | | |
| 4 | Perform QC disposition signature on the test lot; verify signature record | | |
| 4 | Attempt to modify the APPROVED lot; confirm 423 RECORD_LOCKED | | |
| 5 | Export audit trail; verify all above actions appear with correct userId | | |
| 5 | Run restore-check script (pnpm restore:check); verify PASS | | |

### Deviation log

| # | Day | Description | Disposition |
|---|---|---|---|

## 4. Acceptance

PQ is PASSED when all 10 tasks above are PASS and the deviation log has zero unresolved entries.

**Disposition:** PASS / FAIL / PASS WITH DEVIATION

Executed by: Head of QC — date: ___________`;

const VSR_CONTENT = `# Validation Summary Report — Platform (VSR-PLATFORM)

**Report ID:** VSR-PLATFORM
**Version:** 1.0
**Date:** pending signature
**Engineering Owner:** Frederik Hejlskov
**QA Signatory:** Head of QC

## 1. System description

Neurogan ERP is a custom web application (GAMP 5 Category 5) built to support 21 CFR Part 111 (cGMP for dietary supplements) and 21 CFR Part 11 (electronic records and electronic signatures) compliance at Neurogan's facility at 8821 Production Ave, San Diego. The platform provides user identity management, electronic signatures, an append-only audit trail, regulated record state machines, and session-based authentication. It is hosted on Railway (cloud PaaS) with a managed PostgreSQL database.

## 2. Validation approach

Validation follows GAMP 5 Category 5 (custom software). Risk assessment classified the system as high risk given its role as the legal record for regulated manufacturing activities. The validation lifecycle consisted of IQ, OQ, and PQ for the platform foundation (Phase 0, tickets F-01 through F-09).

## 3. Requirements coverage

All 8 platform URS items (URS-F-01-01 through URS-F-08-01) are covered by FRS and DS entries. Traceability matrix in FDA/validation-scaffold.md Section 7. Coverage: 100%.

## 4. Test execution summary

| Protocol | Run date | Pass | Fail | Deviations |
|---|---|---|---|---|
| IQ-PLATFORM-001 | record at execution | | | |
| OQ-PLATFORM-001 | record at execution | | | |
| PQ-PLATFORM-001 | record at execution | | | |

## 5. Deviations and dispositions

| # | Protocol | Description | Disposition | Change-control ref |
|---|---|---|---|---|

## 6. Residual risks and mitigations

| Risk | Mitigation | Residual risk |
|---|---|---|
| Railway 7-day snapshot gap vs 1-year retention requirement | Weekly pg_dump to off-site storage per DR plan | Low |
| Solo developer - no peer PR review | CI gates + F-04 signature ceremony as separation-of-duties | Low |

## 7. Training status

| User | Role | Training completed | Date |
|---|---|---|---|
| Frederik Hejlskov | ADMIN | System builder | 2026-04-23 |
| Head of QC | QA | PQ shadow run + system walkthrough | record at execution |

## 8. Periodic review plan

- Audit trail QA review: weekly (first 90 days), monthly thereafter - Head of QC
- Role review: quarterly - Head of QC
- DR restore test: monthly automated CI - Frederik Hejlskov
- Full validation review: annual - Head of QC

## 9. Conclusion

Based on the IQ, OQ, and PQ results documented above, the Neurogan ERP platform foundation is:

FIT FOR INTENDED USE

The platform is authorised to proceed to Phase 1 module development (R-01 through R-06). No Phase 1 module may begin operational use until its own module VSR is signed.

## 10. Authorization

By signing this document using the electronic signature ceremony, I confirm that I have reviewed the IQ, OQ, and PQ protocols and their results, and that the platform foundation meets the requirements defined in the URS.

This signature was applied using the Neurogan ERP electronic signature system, compliant with 21 CFR Part 11 Section 11.50 and Section 11.200.`;

const IQ_R01_CONTENT = `# Installation Qualification — Receiving Module (IQ-R01)

**Protocol ID:** IQ-R01-001
**Version:** 1.0
**Date:** 2026-04-24
**Engineering Owner:** Frederik Hejlskov
**QA Signatory:** Head of QC
**Regulatory basis:** 21 CFR Part 111 §111.75, §111.80; GAMP 5 Category 5

## 1. Scope

Verify that the R-01 Receiving module database schema and configuration are installed correctly in the production environment and match the Design Specification.

## 2. Pre-conditions

- Platform IQ/OQ/PQ signed
- Migrations 0007–0010 applied to production database
- Seed users (admin, QA, Warehouse roles) present

## 3. Installation Checks

### IQ-R01-01 — Database tables

| Table | Expected | Pass/Fail |
|---|---|---|
| erp_labs | Exists with columns: id, name, address, type, status, created_at | |
| erp_approved_materials | Exists with columns: id, product_id, supplier_id, approved_by_user_id, approved_at, notes, is_active, created_at | |
| erp_receiving_records | Has columns: requires_qualification, qc_workflow_type, visual_exam_by (jsonb), qc_reviewed_by (jsonb), sampling_plan (jsonb) | |
| erp_coa_documents | Has column: lab_id (uuid FK → erp_labs) | |
| erp_lots | quarantine_status default is 'QUARANTINED' | |

### IQ-R01-02 — Applied migrations

| Migration | Description | Pass/Fail |
|---|---|---|
| 0007_r01_receiving_hardening | Labs, approved materials, workflow type, identity snapshots | |
| 0008_t01_warehouse_role_rename | RECEIVING → WAREHOUSE role rename | |
| 0009_t02_lab_status | labs.status enum (ACTIVE/INACTIVE/DISQUALIFIED) | |
| 0010_t04_sampling_plan | sampling_plan JSONB column on receiving records | |

Verify: SELECT tag FROM erp_migrations ORDER BY idx;

### IQ-R01-03 — Seed data

| Item | Expected | Pass/Fail |
|---|---|---|
| erp_labs rows | Neurogan Labs (IN_HOUSE, ACTIVE), Nutri Analytical (THIRD_PARTY, ACTIVE) | |
| WAREHOUSE role | Exists in erp_user_roles for warehouse seed user | |

## 4. Acceptance

IQ-R01 is PASSED when all checks above are recorded.

**Disposition:** PASS / FAIL / PASS WITH DEVIATION

Executed by: ___________  Date: ___________`;

const OQ_R01_CONTENT = `# Operational Qualification — Receiving Module (OQ-R01)

**Protocol ID:** OQ-R01-001
**Version:** 1.0
**Date:** 2026-04-24
**Engineering Owner:** Frederik Hejlskov
**QA Signatory:** Head of QC
**Regulatory basis:** 21 CFR Part 111 §111.75(a)(1), §111.80(b); 21 CFR Part 11 §11.10

## 1. Scope

Verify that each functional requirement of the R-01 Receiving module operates as designed. Tests are executed against the staging environment.

## 2. Test Cases

### OQ-R01-01 — PO receipt creates lot in QUARANTINED status

| Step | Action | Expected result | Pass/Fail |
|---|---|---|---|
| 1 | POST /api/purchase-orders/receive with valid PO line | Response 200; lot.quarantine_status = QUARANTINED | |
| 2 | GET /api/lots/:id | quarantine_status = QUARANTINED | |
| 3 | GET /api/receiving/:id | status = QUARANTINED | |

### OQ-R01-02 — Workflow type auto-assignment

| Step | Action | Expected result | Pass/Fail |
|---|---|---|---|
| 1 | Receive ACTIVE_INGREDIENT from non-qualified supplier | qc_workflow_type = FULL_LAB_TEST | |
| 2 | Receive ACTIVE_INGREDIENT from qualified supplier | qc_workflow_type = IDENTITY_CHECK | |
| 3 | Receive SECONDARY_PACKAGING | qc_workflow_type = COA_REVIEW | |

### OQ-R01-03 — Gate 1: visual inspection required for QUARANTINED → SAMPLING

| Step | Action | Expected result | Pass/Fail |
|---|---|---|---|
| 1 | Attempt QUARANTINED→SAMPLING without visual inspection | 422 error | |
| 2 | Complete visual inspection fields | 200 success | |
| 3 | Attempt QUARANTINED→SAMPLING again | 200; status = SAMPLING | |

### OQ-R01-04 — Gate 2: visual inspection required for QUARANTINED → PENDING_QC

| Step | Action | Expected result | Pass/Fail |
|---|---|---|---|
| 1 | Attempt QUARANTINED→PENDING_QC without visual inspection | 422 error | |
| 2 | Complete visual inspection; attempt again | 200; status = PENDING_QC | |

### OQ-R01-05 — Gate 3: COA required before APPROVED

| Step | Action | Expected result | Pass/Fail |
|---|---|---|---|
| 1 | QC review APPROVED on lot with no COA | 422: "no COA document is linked" | |
| 2 | Attach COA to lot | 200 success | |
| 3 | QC review APPROVED again | 200; status = APPROVED | |

### OQ-R01-06 — Gate 3: lab accreditation enforcement (T-02)

| Step | Action | Expected result | Pass/Fail |
|---|---|---|---|
| 1 | Set a lab status to DISQUALIFIED in Settings → Labs | 200 success | |
| 2 | Attach COA linked to that DISQUALIFIED lab to a PENDING_QC lot | 200 success | |
| 3 | Attempt QC review APPROVED | 422: "lab with status DISQUALIFIED" | |
| 4 | Accept COA (qcReviewCoa) for same COA | 422: "lab with status DISQUALIFIED" | |
| 5 | Restore lab to ACTIVE; retry both | Both succeed | |

### OQ-R01-07 — Gate 3b: identity test enforcement (T-03)

| Step | Action | Expected result | Pass/Fail |
|---|---|---|---|
| 1 | FULL_LAB_TEST lot; COA with identityConfirmed not set | QC review APPROVED → 422: "identity testing" | |
| 2 | Update COA: identityConfirmed = true | 200 success | |
| 3 | Retry QC review APPROVED | 200; status = APPROVED | |
| 4 | IDENTITY_CHECK lot; same flow | Same 422 → fix → pass | |
| 5 | COA_REVIEW lot; COA with no identity confirmed | QC review APPROVED succeeds (gate not applied) | |

### OQ-R01-08 — Z1.4 sampling plan display (T-04)

| Step | Action | Expected result | Pass/Fail |
|---|---|---|---|
| 1 | Receive FULL_LAB_TEST lot; quantity = 100 | sampling_plan = {code: F, sampleSize: 20, ac: 1, re: 2} | |
| 2 | View receiving record in UI | Z1.4 panel shows "Sample size: 20, Accept if ≤1, Reject if ≥2, Code F" | |
| 3 | IDENTITY_CHECK lot; quantity = 500 | sampling_plan = null (not FULL_LAB_TEST) | |

### OQ-R01-09 — Part 11 QC disposition with electronic signature

| Step | Action | Expected result | Pass/Fail |
|---|---|---|---|
| 1 | QC review APPROVED; provide meaning, password, signature | 200; electronic signature record created | |
| 2 | GET /api/receiving/:id | qc_reviewed_by contains {userId, fullName, title} snapshot | |
| 3 | Audit trail | Contains APPROVED disposition event with user identity | |
| 4 | Attempt second QC review on same APPROVED lot | 422: record is locked | |

### OQ-R01-10 — Approved materials auto-creation

| Step | Action | Expected result | Pass/Fail |
|---|---|---|---|
| 1 | Approve a lot with requiresQualification = true | erp_approved_materials row created for (product, supplier) | |
| 2 | Approve again (different lot, same product+supplier) | ON CONFLICT — existing row updated, not duplicated | |

### OQ-R01-11 — Supplier qualification gating

| Step | Action | Expected result | Pass/Fail |
|---|---|---|---|
| 1 | Receive from non-approved supplier for active ingredient | requires_qualification = true; workflow = FULL_LAB_TEST | |
| 2 | Approve the lot | approved_materials entry created | |
| 3 | Receive again from same supplier + product | requires_qualification = false; workflow = IDENTITY_CHECK | |

## 3. Acceptance

OQ-R01 is PASSED when all test cases above are recorded with Pass results. Any Fail must be raised as a deviation.

**Disposition:** PASS / FAIL / PASS WITH DEVIATION

Executed by: ___________  Date: ___________`;

const PQ_R01_CONTENT = `# Performance Qualification — Receiving Module (PQ-R01)

**Protocol ID:** PQ-R01-001
**Version:** 1.0
**Date:** 2026-04-24
**Engineering Owner:** Frederik Hejlskov
**QA Signatory:** Head of QC
**Regulatory basis:** 21 CFR Part 111 §111.75, §111.80, §111.180; GAMP 5 Category 5

## 1. Scope

Verify that the R-01 Receiving module performs correctly in the production environment using realistic data representative of Neurogan's actual ingredient and packaging materials.

## 2. Scenarios

### PQ-R01-01 — Full receiving cycle: Hemp Extract (active ingredient, new supplier)

**Objective:** Verify complete FULL_LAB_TEST workflow for a new supplier

| Step | Action | Expected result | Pass/Fail |
|---|---|---|---|
| 1 | Create PO for Hemp Extract from new supplier | PO created, status OPEN | |
| 2 | Receive 25 units (drums) against PO | Lot created QUARANTINED; workflow = FULL_LAB_TEST; sampling_plan.sampleSize = 8 | |
| 3 | Complete visual inspection (all fields pass) | Transition QUARANTINED → SAMPLING succeeds | |
| 4 | Submit SAMPLING_COMPLETE | Status = PENDING_QC | |
| 5 | Upload COA from Nutri Analytical (ACTIVE lab); set identityConfirmed = true | COA attached; lab ACTIVE | |
| 6 | QC disposition APPROVED with signature | Status = APPROVED; approved_materials created | |
| 7 | Verify audit trail | All transitions recorded with user identity and timestamps | |

### PQ-R01-02 — Receiving cycle: MCT Oil (supporting ingredient, qualified supplier)

**Objective:** Verify IDENTITY_CHECK workflow for a previously qualified supplier

| Step | Action | Expected result | Pass/Fail |
|---|---|---|---|
| 1 | Receive MCT Oil from approved supplier | Lot QUARANTINED; workflow = IDENTITY_CHECK; sampling_plan = null | |
| 2 | Complete visual inspection | Transition to PENDING_QC succeeds (no SAMPLING step needed) | |
| 3 | Upload COA; set identityConfirmed = true | COA attached | |
| 4 | QC disposition APPROVED | Status = APPROVED; no new approved_materials (supplier already qualified) | |

### PQ-R01-03 — Rejection scenario

**Objective:** Verify REJECTED disposition and lot lock

| Step | Action | Expected result | Pass/Fail |
|---|---|---|---|
| 1 | Receive a lot; advance to PENDING_QC | Status = PENDING_QC | |
| 2 | Upload COA with overallResult = FAIL | COA attached | |
| 3 | QC disposition REJECTED with notes | Status = REJECTED; lot.quarantine_status = REJECTED | |
| 4 | Attempt any state transition on rejected lot | 422: record is locked | |
| 5 | Attempt to use this lot in production | 422: lot not approved | |

### PQ-R01-04 — Disqualified lab scenario

**Objective:** Verify system prevents approval when testing lab is disqualified

| Step | Action | Expected result | Pass/Fail |
|---|---|---|---|
| 1 | Set Nutri Analytical to DISQUALIFIED in Settings | Status updated | |
| 2 | Receive new lot; advance to PENDING_QC | PENDING_QC | |
| 3 | Upload COA linked to Nutri Analytical | COA attached | |
| 4 | Attempt QC review APPROVED | 422: lab DISQUALIFIED | |
| 5 | Restore Nutri Analytical to ACTIVE | Status updated | |
| 6 | Retry QC review APPROVED | Success | |

## 3. Acceptance

PQ-R01 is PASSED when all scenarios above are executed and recorded with Pass results in the production environment.

**Disposition:** PASS / FAIL / PASS WITH DEVIATION

Executed by: ___________  Date: ___________`;

const VSR_R01_CONTENT = `# Validation Summary Report — Receiving Module (VSR-R01)

**Protocol ID:** VSR-R01-001
**Version:** 1.0
**Date:** 2026-04-24
**Engineering Owner:** Frederik Hejlskov
**QA Signatory:** Head of QC
**Regulatory basis:** 21 CFR Part 111 §111.75, §111.80; 21 CFR Part 11; GAMP 5 Category 5

## 1. Purpose

This report summarizes the validation activities performed for the R-01 Receiving module of the Neurogan ERP. It serves as the formal release authorization for the Receiving module for regulated use in accordance with 21 CFR Part 111 GMP requirements.

## 2. Validation Scope

The R-01 Receiving module encompasses:

- Purchase order receipt workflow with automatic lot creation and QUARANTINED quarantine status
- Workflow type determination (FULL_LAB_TEST / IDENTITY_CHECK / COA_REVIEW / EXEMPT) based on material category and supplier qualification status
- Three-gate state machine: Gate 1 (visual inspection), Gate 2 (visual inspection skip), Gate 3 (COA + lab accreditation + identity confirmation)
- Z1.4 Level II sampling plan calculation and display for FULL_LAB_TEST workflows
- COA intake with lab registry linkage
- Part 11-compliant QC disposition with electronic signature and identity snapshot
- Approved materials registry auto-creation on first approval
- WAREHOUSE role for receiving/warehouse personnel

## 3. Validation Documents

| Document | ID | Status | Signed By |
|---|---|---|---|
| Installation Qualification | IQ-R01-001 | SIGNED | ___________________ |
| Operational Qualification | OQ-R01-001 | SIGNED | ___________________ |
| Performance Qualification | PQ-R01-001 | SIGNED | ___________________ |

## 4. Deviations and Observations

| # | Description | Resolution | Impact |
|---|---|---|---|
| — | None at time of release | — | — |

(Record any deviations found during IQ/OQ/PQ execution)

## 5. Regulatory Compliance Summary

| Regulation | Requirement | Implementation | Status |
|---|---|---|---|
| 21 CFR 111.75(a)(1)(ii) | Identity test each component lot | identityConfirmed gate in Gate 3b | Compliant |
| 21 CFR 111.75(a)(1)(i) | Visual examination | Gate 1 and Gate 2 enforce visual inspection completion | Compliant |
| 21 CFR 111.80(b) | Quarantine untested components | Default quarantine_status = QUARANTINED | Compliant |
| 21 CFR 111.75(a)(2) | Use qualified suppliers | approved_materials registry + requires_qualification flag | Compliant |
| 21 CFR Part 11 §11.50 | Electronic signature meaning | QC disposition requires meaning code + password re-entry | Compliant |
| 21 CFR Part 11 §11.10(e) | Audit trail | All state transitions written to erp_audit_trail | Compliant |
| ANSI/ASQ Z1.4 | Sampling plan | Level II AQL 2.5 sampling plan computed and stored per lot | Compliant |

## 6. Release Authorization

Based on the successful execution of IQ-R01, OQ-R01, and PQ-R01, the R-01 Receiving module is hereby released for regulated use at Neurogan.

This release does not cover:
- Structured per-analyte lab result capture (planned in T-06)
- Equipment and cleaning records (planned in T-08/T-09)
- Z1.4 sampling plan for non-unit lot sizes requiring manual container count input

**Approved for Use:**

Signature: ___________________ Date: ___________
Name: Head of QC
Title: QC Manager

This signature was applied using the Neurogan ERP electronic signature system, compliant with 21 CFR Part 11 Section 11.50 and Section 11.200.`;

export async function seedValidationDocuments() {
  await db.insert(schema.validationDocuments).values([
    {
      id:      seedIds.validationDocuments.iqPlatform,
      docId:   "IQ-PLATFORM",
      title:   "Installation Qualification — Platform",
      type:    "IQ" as const,
      module:  "PLATFORM",
      content: IQ_CONTENT,
      status:  "DRAFT" as const,
    },
    {
      id:      seedIds.validationDocuments.oqPlatform,
      docId:   "OQ-PLATFORM",
      title:   "Operational Qualification — Platform",
      type:    "OQ" as const,
      module:  "PLATFORM",
      content: OQ_CONTENT,
      status:  "DRAFT" as const,
    },
    {
      id:      seedIds.validationDocuments.pqPlatform,
      docId:   "PQ-PLATFORM",
      title:   "Performance Qualification — Platform",
      type:    "PQ" as const,
      module:  "PLATFORM",
      content: PQ_CONTENT,
      status:  "DRAFT" as const,
    },
    {
      id:      seedIds.validationDocuments.vsrPlatform,
      docId:   "VSR-PLATFORM",
      title:   "Validation Summary Report — Platform",
      type:    "VSR" as const,
      module:  "PLATFORM",
      content: VSR_CONTENT,
      status:  "DRAFT" as const,
    },
    {
      id:      seedIds.validationDocuments.iqReceiving,
      docId:   "IQ-R01",
      title:   "Installation Qualification — Receiving Module",
      type:    "IQ" as const,
      module:  "RECEIVING",
      content: IQ_R01_CONTENT,
      status:  "DRAFT" as const,
    },
    {
      id:      seedIds.validationDocuments.oqReceiving,
      docId:   "OQ-R01",
      title:   "Operational Qualification — Receiving Module",
      type:    "OQ" as const,
      module:  "RECEIVING",
      content: OQ_R01_CONTENT,
      status:  "DRAFT" as const,
    },
    {
      id:      seedIds.validationDocuments.pqReceiving,
      docId:   "PQ-R01",
      title:   "Performance Qualification — Receiving Module",
      type:    "PQ" as const,
      module:  "RECEIVING",
      content: PQ_R01_CONTENT,
      status:  "DRAFT" as const,
    },
    {
      id:      seedIds.validationDocuments.vsrReceiving,
      docId:   "VSR-R01",
      title:   "Validation Summary Report — Receiving Module",
      type:    "VSR" as const,
      module:  "RECEIVING",
      content: VSR_R01_CONTENT,
      status:  "DRAFT" as const,
    },
  ]).onConflictDoNothing();
}
