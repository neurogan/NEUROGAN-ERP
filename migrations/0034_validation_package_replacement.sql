-- 0034: Validation package replacement
--
-- Replaces the original signed validation documents with a complete, current-state
-- validation package covering all modules (Platform foundation through R2 QMS modules).
--
-- Changes:
--   - All existing documents reset to DRAFT, signature_id cleared
--   - Content rewritten: roles only (no specific person names), full current system scope
--   - Four new documents added: IQ/OQ/PQ/VSR for the R2 QMS module set
--
-- The orphaned electronic signature rows remain in erp_electronic_signatures as
-- historical audit trail entries. They are no longer referenced by any validation doc.

-- ─── Reset all existing documents to DRAFT ───────────────────────────────────

UPDATE erp_validation_documents
SET status = 'DRAFT', signature_id = NULL, updated_at = now()
WHERE doc_id IN (
  'IQ-PLATFORM', 'OQ-PLATFORM', 'PQ-PLATFORM', 'VSR-PLATFORM',
  'IQ-R01', 'OQ-R01', 'PQ-R01', 'VSR-R01'
);

-- ─── IQ-PLATFORM — updated content ───────────────────────────────────────────

UPDATE erp_validation_documents SET content = $VAL$
# Installation Qualification — Neurogan ERP Platform (IQ-PLATFORM)

**Protocol ID:** IQ-PLATFORM-001
**Version:** 2.0
**Date:** 2026-05-04
**Engineering Owner:** System Developer
**QA Signatory:** Head of Quality Control
**Regulatory basis:** 21 CFR Part 11; GAMP 5 Category 5

## 1. Scope

Verify that the Neurogan ERP platform is installed correctly in the Railway production environment and that the installation matches the Design Specification. This IQ covers the full system as deployed: platform foundation (F-01 through F-10), all operational modules (R-01 through R-09), and all Release 2 QMS modules (R2-01 through R2-04).

## 2. Pre-conditions

- Design Specification approved
- All feature tickets F-01 through R2-04 merged to main and CI-green
- Migrations 0000–0034 applied to production database

## 3. Installation Checks

### IQ-01 — Application environment

| Item | Expected | Actual | Pass/Fail |
|---|---|---|---|
| Railway project | neurogan-erp | _record at execution_ | |
| Node.js version | >= 20 | _record at execution_ | |
| Commit SHA (from /api/health) | _current deploy_ | _record at execution_ | |
| Environment | production | _record at execution_ | |

### IQ-02 — Database

| Item | Expected | Actual | Pass/Fail |
|---|---|---|---|
| Postgres version | >= 14 | _record at execution_ | |
| Timezone | UTC | _record at execution_ | |
| Applied migrations | 0000–0034 | _record at execution_ | |

### IQ-03 — Environment variables

Confirm the following are set (values not recorded):

- DATABASE_URL
- SESSION_SECRET (>= 64 hex chars)
- ALLOWED_ORIGINS
- NODE_ENV = production

### IQ-04 — Audit trail immutability

Run from a superuser session:

```sql
SELECT has_table_privilege('erp_app', 'erp_audit_trail', 'UPDATE') AS can_update,
       has_table_privilege('erp_app', 'erp_audit_trail', 'DELETE') AS can_delete;
```

Expected: both columns return **false**.

### IQ-05 — Validation document immutability

```sql
SELECT has_table_privilege('erp_app', 'erp_validation_documents', 'DELETE') AS can_delete;
```

Expected: returns **false**.

### IQ-06 — Core tables present

| Table | Pass/Fail |
|---|---|
| erp_users, erp_user_roles, erp_sessions | |
| erp_audit_trail, erp_electronic_signatures | |
| erp_products, erp_lots, erp_transactions, erp_locations | |
| erp_receiving_records, erp_coa_documents, erp_labs, erp_approved_materials | |
| erp_purchase_orders, erp_purchase_order_lines | |
| erp_equipment, erp_equipment_cleaning_logs, erp_line_clearance_records | |
| erp_mmrs, erp_mmr_versions, erp_batch_production_records, erp_bpr_steps | |
| erp_component_specifications, erp_fg_specifications | |
| erp_complaints, erp_oos_investigations, erp_returned_products | |
| erp_retained_samples | |
| erp_capa_records, erp_training_programs, erp_training_records | |
| erp_stability_protocols, erp_stability_enrollments, erp_stability_results | |
| erp_em_sites, erp_em_schedules, erp_em_results | |
| erp_validation_documents | |

### IQ-07 — Backup schedule

| Item | Expected | Actual | Pass/Fail |
|---|---|---|---|
| Backup cadence | Daily | _record at execution_ | |
| Retention | >= 7 days | _record at execution_ | |

## 4. Acceptance

IQ-PLATFORM v2.0 is PASSED when all checks above are recorded and any deviations are raised to change control.

**Disposition:** PASS / FAIL / PASS WITH DEVIATION

Executed by: ___________________ Date: ___________
$VAL$, updated_at = now()
WHERE doc_id = 'IQ-PLATFORM';

-- ─── OQ-PLATFORM — updated content ───────────────────────────────────────────

UPDATE erp_validation_documents SET content = $VAL$
# Operational Qualification — Neurogan ERP Platform (OQ-PLATFORM)

**Protocol ID:** OQ-PLATFORM-001
**Version:** 2.0
**Date:** 2026-05-04
**Engineering Owner:** System Developer
**QA Signatory:** Head of Quality Control
**Regulatory basis:** 21 CFR Part 11; 21 CFR Part 111; GAMP 5 Category 5

## 1. Scope

Verify that the Neurogan ERP operates as specified across all functional modules. OQ is executed by running the full automated integration test suite and reviewing results.

**Run:** `pnpm test:integration`

All tests must pass with zero failures.

## 2. Module coverage

### Platform foundation (F-01 through F-10)

| Area | Tests verify |
|---|---|
| Users & Roles (F-01) | Create/update user; role grant/revoke; last-ADMIN guard; disable user |
| Authentication (F-02) | Login success; password complexity; session expiry; lockout after 5 failures |
| Audit trail (F-03) | Regulated write produces immutable row; UPDATE/DELETE blocked at DB level |
| Electronic signatures (F-04) | Correct password advances state in same transaction; wrong password rejected; manifestation fields present |
| State machines (F-05) | Legal transitions succeed; illegal transitions return 409; locked records return 423 |
| Body identity rejection (F-06) | Identity fields submitted in body are rejected 400; identity from session only |
| Security hardening (F-07) | CORS, rate-limiting, request ID round-trip |
| Validation documents (F-10) | Sign → SIGNED; wrong password stays DRAFT; re-sign returns 409 |

### Operational modules (R-01 through R-09)

| Module | Tests verify |
|---|---|
| Receiving R-01 | PO receipt → QUARANTINED lot; workflow type auto-assignment; state machine gates 1–3; Z1.4 sampling plan; Part-11 QC disposition; approved materials auto-creation |
| Equipment/Cleaning R-03 | Equipment CRUD; calibration due enforcement; cleaning log creation; line clearance workflow; cleaner ≠ verifier gate |
| Labeling R-04 | Artwork version control; QA approval; issuance log; reconciliation at batch close |
| Complaints/SAER R-05 | Complaint creation; QA triage; AE flag; 15-business-day SAER clock; MedWatch draft |
| Returns R-06 | Return intake; quarantine; QA disposition workflow; Part-11 signature |
| MMR R-07 | MMR creation; version approval; batch snapshot to approved version; bidirectional navigation links |
| BPR R-08 | BPR creation; step completion; deviation log; Part-11 deviation review; label reconciliation gate; completion gates |
| FG QC release R-09 | FG spec approval; per-analyte test entry; PASS/FAIL against limits; OOS auto-open; gate before Part-11 release |

### Release 2 QMS modules (R2-01 through R2-04)

| Module | Tests verify |
|---|---|
| Stability R2-01 | Protocol creation; batch enrollment; timepoint scheduling; result entry; Part-11 conclusion |
| Environmental Monitoring R2-02 | Site map; schedule; CFU result vs alert/action limits; CAPA auto-open on action limit breach |
| CAPA R2-03 | CAPA creation from any source; root cause; corrective action; effectiveness check; Part-11 close-out |
| Training gate R2-04 | Training program catalog; training record with Part-11 acknowledgement; gate blocks regulated action on expired training |

## 3. Acceptance

OQ-PLATFORM v2.0 is PASSED when `pnpm test:integration` completes with zero failures.

**Disposition:** PASS / FAIL / PASS WITH DEVIATION

Executed by: ___________________ Date: ___________
$VAL$, updated_at = now()
WHERE doc_id = 'OQ-PLATFORM';

-- ─── PQ-PLATFORM — updated content ───────────────────────────────────────────

UPDATE erp_validation_documents SET content = $VAL$
# Performance Qualification — Neurogan ERP Platform (PQ-PLATFORM)

**Protocol ID:** PQ-PLATFORM-001
**Version:** 2.0
**Date:** 2026-05-04
**Engineering Owner:** System Developer
**QA Signatory:** Head of Quality Control
**Regulatory basis:** 21 CFR Part 111; 21 CFR Part 11; GAMP 5 Category 5

## 1. Scope

Demonstrate that the Neurogan ERP performs its intended regulated functions under real-world conditions. PQ is executed by the Head of Quality Control in the production environment using the shadow-run procedure below.

## 2. Pre-conditions

- IQ-PLATFORM v2.0: PASS
- OQ-PLATFORM v2.0: PASS
- Head of Quality Control has completed system training
- Parallel paper records in place during shadow run

## 3. Shadow-run procedure

Each task is performed by the Head of Quality Control in production. Record outcome and any deviations.

### Platform access controls

| # | Task | Expected | Pass/Fail |
|---|---|---|---|
| P-01 | Log in with correct credentials | Session established; dashboard loads | |
| P-02 | Attempt login with wrong password 5 times | Account locked; 6th attempt blocked | |
| P-03 | Log in from a different browser; verify original session remains valid | Both sessions active | |
| P-04 | Idle for 15 minutes; attempt a protected action | Session expired; redirected to login | |

### Receiving and inventory

| # | Task | Expected | Pass/Fail |
|---|---|---|---|
| P-05 | Create a test receiving record for an active ingredient; confirm lot status = QUARANTINED | Status QUARANTINED; Z1.4 sampling plan displayed | |
| P-06 | Attempt to advance status without completing visual inspection | System blocks with validation error | |
| P-07 | Complete visual inspection; advance to SAMPLING; then PENDING_QC | Transitions succeed in order | |
| P-08 | Submit QC disposition APPROVED with electronic signature | Status APPROVED; signature record visible in audit trail | |
| P-09 | Attempt to modify the APPROVED record | System blocks: record locked | |
| P-10 | Confirm lot appears in Inventory with correct available quantity | Inventory shows lot with APPROVED status | |

### Production and batch records

| # | Task | Expected | Pass/Fail |
|---|---|---|---|
| P-11 | Start a BPR against an approved MMR version | BPR created; steps reflect approved MMR | |
| P-12 | Attempt to start BPR using a QUARANTINED component lot | System blocks: lot not approved | |
| P-13 | Complete all BPR steps; submit for QC review | Status advances to PENDING_QC_REVIEW | |
| P-14 | Submit QC release signature on BPR | Status RELEASED; electronic signature recorded | |

### Quality workflows

| # | Task | Expected | Pass/Fail |
|---|---|---|---|
| P-15 | Create a complaint record with a lot ID | Complaint created; lot linked | |
| P-16 | Flag complaint as adverse event | SAER 15-business-day clock starts | |
| P-17 | Open an OOS investigation; link to a lot | Investigation record created; lot linked | |
| P-18 | Open a CAPA from an OOS investigation | CAPA created; source linked | |
| P-19 | Record an environmental monitoring result above action limit | CAPA auto-created; EM result shows EXCEEDED status | |

### Audit trail verification

| # | Task | Expected | Pass/Fail |
|---|---|---|---|
| P-20 | Export or review audit trail for all above actions | Every action recorded with user identity, timestamp, before/after values | |

## 4. Deviation log

| # | Task ref | Description | Disposition |
|---|---|---|---|

## 5. Acceptance

PQ-PLATFORM v2.0 is PASSED when all 20 tasks above are recorded as PASS and the deviation log has zero unresolved entries.

**Disposition:** PASS / FAIL / PASS WITH DEVIATION

Executed by: ___________________ Date: ___________
$VAL$, updated_at = now()
WHERE doc_id = 'PQ-PLATFORM';

-- ─── VSR-PLATFORM — updated content ──────────────────────────────────────────

UPDATE erp_validation_documents SET content = $VAL$
# Validation Summary Report — Neurogan ERP (VSR-PLATFORM)

**Report ID:** VSR-PLATFORM
**Version:** 2.0
**Date:** 2026-05-04
**Engineering Owner:** System Developer
**QA Signatory:** Head of Quality Control
**Regulatory basis:** 21 CFR Part 111; 21 CFR Part 11; GAMP 5 Category 5

## 1. System description

Neurogan ERP is a custom web application (GAMP 5 Category 5) built to support 21 CFR Part 111 (cGMP for dietary supplements) and 21 CFR Part 11 (electronic records and electronic signatures) compliance at Neurogan's facility in San Diego, CA. The system is hosted on Railway (cloud PaaS) with a managed PostgreSQL database and React/TypeScript frontend.

## 2. Validation scope — complete current system

This VSR covers the full Neurogan ERP as deployed on 2026-05-04. All modules listed below have been subject to IQ, OQ, and PQ validation activities.

### Platform foundation

| Module | Ticket | Regulatory basis | Status |
|---|---|---|---|
| Users, roles, authentication | F-01/F-02 | 21 CFR Part 11 §11.300 | Validated |
| Audit trail | F-03 | 21 CFR Part 11 §11.10(e); §111.180 | Validated |
| Electronic signatures | F-04 | 21 CFR Part 11 §11.50, §11.70, §11.200 | Validated |
| State machines / record lock | F-05 | 21 CFR Part 11 §11.10(d) | Validated |
| Security hardening | F-07 | 21 CFR Part 11 §11.10(a) | Validated |
| Validation documents | F-10 | GAMP 5 Cat 5 | Validated |

### Operational modules

| Module | Ticket | Regulatory basis | Status |
|---|---|---|---|
| Receiving & component QC release | R-01 | §111.75, §111.80 | Validated |
| Equipment, calibration & cleaning | R-03 | §111.27, §111.30 | Validated |
| Label issuance & reconciliation | R-04 | §111.140(b)(3) | Validated |
| Complaints & adverse events (SAER) | R-05 | §111.570(b); 21 CFR 111.560 | Validated |
| Returned product | R-06 | §111.503–535 | Validated |
| Master Manufacturing Records | R-07 | §111.205 | Validated |
| Batch Production Records | R-08 | §111.255 | Validated |
| Finished Goods QC release gate | R-09 | §111.123(a) | Validated |

### Release 2 — QMS modules

| Module | Ticket | Regulatory basis | Status |
|---|---|---|---|
| Stability program | R2-01 | §111.210(f) | Validated |
| Environmental monitoring | R2-02 | §111.15(b)(1) | Validated |
| CAPA | R2-03 | §111.140 | Validated |
| Training gate | R2-04 | §111.12–14 | Validated |

## 3. Validation documents

| Document | ID | Version |
|---|---|---|
| Installation Qualification — Platform | IQ-PLATFORM | 2.0 |
| Operational Qualification — Platform | OQ-PLATFORM | 2.0 |
| Performance Qualification — Platform | PQ-PLATFORM | 2.0 |
| Installation Qualification — Receiving | IQ-R01 | 2.0 |
| Operational Qualification — Receiving | OQ-R01 | 2.0 |
| Performance Qualification — Receiving | PQ-R01 | 2.0 |
| Validation Summary Report — Receiving | VSR-R01 | 2.0 |
| Installation Qualification — R2 QMS Modules | IQ-R2 | 1.0 |
| Operational Qualification — R2 QMS Modules | OQ-R2 | 1.0 |
| Performance Qualification — R2 QMS Modules | PQ-R2 | 1.0 |
| Validation Summary Report — R2 QMS Modules | VSR-R2 | 1.0 |

## 4. Test execution summary

| Protocol | Environment | Outcome |
|---|---|---|
| IQ-PLATFORM v2.0 | Production | Record at execution |
| OQ-PLATFORM v2.0 | Staging | Record at execution |
| PQ-PLATFORM v2.0 | Production | Record at execution |
| IQ-R01 v2.0 | Production | Record at execution |
| OQ-R01 v2.0 | Staging | Record at execution |
| PQ-R01 v2.0 | Production | Record at execution |
| IQ-R2 v1.0 | Production | Record at execution |
| OQ-R2 v1.0 | Staging | Record at execution |
| PQ-R2 v1.0 | Production | Record at execution |

## 5. Residual risks and mitigations

| Risk | Mitigation | Residual risk |
|---|---|---|
| Railway 7-day snapshot gap vs 1-year retention | Weekly pg_dump to off-site storage per DR plan | Low |
| Solo developer — no peer PR review | CI gates + Part-11 signature ceremony as separation-of-duties | Low |
| Sampling record (§111.310) gap | Physical sampling events recorded in lab log pending ERP enhancement | Medium — tracked in backlog |

## 6. Training status

| Role | Training completed |
|---|---|
| System Developer | System builder; validated all modules |
| Head of Quality Control | PQ shadow run; system walkthrough |

## 7. Periodic review plan

- Audit trail review: weekly (first 90 days), monthly thereafter — Head of Quality Control
- Role and access review: quarterly — Head of Quality Control
- DR restore test: monthly — System Developer
- Full validation review: annual — Head of Quality Control

## 8. Conclusion and release authorization

Based on the IQ, OQ, and PQ results documented in this package, the Neurogan ERP system in its current state (all modules through R2-04) is:

**FIT FOR INTENDED USE**

under 21 CFR Part 111 and 21 CFR Part 11.

By signing this document using the Neurogan ERP electronic signature ceremony, the Head of Quality Control confirms review of all validation protocols and results, and authorizes the system for regulated operational use.

This signature is applied in compliance with 21 CFR Part 11 §11.50 and §11.200.
$VAL$, updated_at = now()
WHERE doc_id = 'VSR-PLATFORM';

-- ─── IQ-R01 — updated content ─────────────────────────────────────────────────

UPDATE erp_validation_documents SET content = $VAL$
# Installation Qualification — Receiving Module (IQ-R01)

**Protocol ID:** IQ-R01-001
**Version:** 2.0
**Date:** 2026-05-04
**Engineering Owner:** System Developer
**QA Signatory:** Head of Quality Control
**Regulatory basis:** 21 CFR Part 111 §111.75, §111.80; GAMP 5 Category 5

## 1. Scope

Verify that the R-01 Receiving module database schema and configuration are installed correctly in the production environment and match the Design Specification.

## 2. Pre-conditions

- Platform IQ-PLATFORM v2.0: PASS
- Migrations 0007–0012 applied to production database

## 3. Installation Checks

### IQ-R01-01 — Required tables and columns

| Table | Required columns | Pass/Fail |
|---|---|---|
| erp_labs | id, name, address, type, status, created_at | |
| erp_approved_materials | id, product_id, supplier_id, is_active, approved_at | |
| erp_receiving_records | requires_qualification, qc_workflow_type, visual_exam_by (jsonb), qc_reviewed_by (jsonb), sampling_plan (jsonb) | |
| erp_coa_documents | lab_id (uuid FK → erp_labs) | |
| erp_lots | quarantine_status default 'QUARANTINED' | |

### IQ-R01-02 — Applied migrations

| Migration | Description | Pass/Fail |
|---|---|---|
| 0007_r01_receiving_hardening | Labs, approved materials, workflow type, identity snapshots | |
| 0008_t01_warehouse_role_rename | RECEIVING → WAREHOUSE role rename | |
| 0009_t02_lab_status | labs.status enum (ACTIVE/INACTIVE/DISQUALIFIED) | |
| 0010_t04_sampling_plan | sampling_plan JSONB column | |
| 0011_t06_lab_tech_role | LAB_TECH role | |
| 0012_t06_lab_test_results | Per-analyte lab test result tables | |

### IQ-R01-03 — Reference data

| Item | Expected | Pass/Fail |
|---|---|---|
| WAREHOUSE role | Exists in role enum | |
| LAB_TECH role | Exists in role enum | |

## 4. Acceptance

IQ-R01 v2.0 is PASSED when all checks above are recorded.

**Disposition:** PASS / FAIL / PASS WITH DEVIATION

Executed by: ___________________ Date: ___________
$VAL$, updated_at = now()
WHERE doc_id = 'IQ-R01';

-- ─── OQ-R01 — updated content ─────────────────────────────────────────────────

UPDATE erp_validation_documents SET content = $VAL$
# Operational Qualification — Receiving Module (OQ-R01)

**Protocol ID:** OQ-R01-001
**Version:** 2.0
**Date:** 2026-05-04
**Engineering Owner:** System Developer
**QA Signatory:** Head of Quality Control
**Regulatory basis:** 21 CFR Part 111 §111.75(a)(1), §111.80(b); 21 CFR Part 11 §11.10

## 1. Scope

Verify that each functional requirement of the R-01 Receiving module operates as designed. Tests executed against staging environment via `pnpm test:integration`.

## 2. Test cases

### OQ-R01-01 — PO receipt creates lot in QUARANTINED status

Expected: POST to receive endpoint returns 200; `lot.quarantine_status = QUARANTINED`; receiving record `status = QUARANTINED`.

### OQ-R01-02 — Workflow type auto-assignment

| Scenario | Expected workflow |
|---|---|
| Active ingredient, no approved supplier | FULL_LAB_TEST |
| Active ingredient, approved supplier on file | IDENTITY_CHECK |
| Secondary packaging | EXEMPT |
| Primary packaging | COA_REVIEW |

### OQ-R01-03 — Gate 1: visual inspection required before QUARANTINED → SAMPLING

Without visual inspection: 422 error. After completing all visual inspection fields: transition succeeds; `status = SAMPLING`.

### OQ-R01-04 — Gate 2: visual inspection required before QUARANTINED → PENDING_QC

Same as Gate 1 but for IDENTITY_CHECK / COA_REVIEW workflows that skip SAMPLING.

### OQ-R01-05 — Gate 3: COA required before APPROVED

QC review APPROVED with no COA attached returns 422. After COA attached: succeeds.

### OQ-R01-06 — Gate 3: disqualified lab blocks approval

Attaching a COA from a DISQUALIFIED lab and attempting QC review APPROVED returns 422 with lab status message.

### OQ-R01-07 — Gate 3b: identity confirmation required for FULL_LAB_TEST and IDENTITY_CHECK

COA without `identityConfirmed = true` blocks APPROVED on these workflow types. COA_REVIEW workflows are exempt.

### OQ-R01-08 — Z1.4 sampling plan calculation

FULL_LAB_TEST lot received with quantity 100: `sampling_plan = { code: "F", sampleSize: 20, acceptNumber: 1, rejectNumber: 2 }`. IDENTITY_CHECK lot: `sampling_plan = null`.

### OQ-R01-09 — Part 11 QC disposition

QC review APPROVED with correct password: 200; electronic signature row created; `qc_reviewed_by` JSONB snapshot contains `{userId, fullName, title}`; audit trail row present. Second review on same APPROVED lot: 422 record locked.

### OQ-R01-10 — Approved materials auto-creation

Approving a lot with `requiresQualification = true` creates an `erp_approved_materials` row for the (product, supplier) pair. Subsequent approval of same pairing does not duplicate the row.

## 3. Acceptance

OQ-R01 v2.0 is PASSED when all test cases pass with zero failures.

**Disposition:** PASS / FAIL / PASS WITH DEVIATION

Executed by: ___________________ Date: ___________
$VAL$, updated_at = now()
WHERE doc_id = 'OQ-R01';

-- ─── PQ-R01 — updated content ─────────────────────────────────────────────────

UPDATE erp_validation_documents SET content = $VAL$
# Performance Qualification — Receiving Module (PQ-R01)

**Protocol ID:** PQ-R01-001
**Version:** 2.0
**Date:** 2026-05-04
**Engineering Owner:** System Developer
**QA Signatory:** Head of Quality Control
**Regulatory basis:** 21 CFR Part 111 §111.75, §111.80, §111.180; GAMP 5 Category 5

## 1. Scope

Verify that the R-01 Receiving module performs correctly in the production environment using realistic Neurogan ingredient and packaging data.

## 2. Pre-conditions

- IQ-R01 v2.0: PASS
- OQ-R01 v2.0: PASS

## 3. Scenarios

### PQ-R01-01 — Full FULL_LAB_TEST cycle (active ingredient, new supplier)

| Step | Action | Expected | Pass/Fail |
|---|---|---|---|
| 1 | Create PO for active ingredient from new supplier | PO created | |
| 2 | Receive against PO | Lot QUARANTINED; workflow = FULL_LAB_TEST; sampling plan displayed | |
| 3 | Complete visual inspection | Gate 1 passes; QUARANTINED → SAMPLING | |
| 4 | Mark sampling complete | SAMPLING → PENDING_QC | |
| 5 | Upload COA from accredited lab; set identityConfirmed = true | COA attached | |
| 6 | QC disposition APPROVED with signature | APPROVED; approved_materials created; inventory shows available quantity | |
| 7 | Verify audit trail | All transitions recorded with role and timestamp | |

### PQ-R01-02 — IDENTITY_CHECK cycle (qualified supplier)

| Step | Action | Expected | Pass/Fail |
|---|---|---|---|
| 1 | Receive from approved supplier | Lot QUARANTINED; workflow = IDENTITY_CHECK; no sampling plan | |
| 2 | Complete visual inspection | QUARANTINED → PENDING_QC (no SAMPLING step) | |
| 3 | Upload COA; set identityConfirmed = true | COA attached | |
| 4 | QC disposition APPROVED | APPROVED | |

### PQ-R01-03 — Rejection scenario

| Step | Action | Expected | Pass/Fail |
|---|---|---|---|
| 1 | Receive lot; advance to PENDING_QC | PENDING_QC | |
| 2 | QC disposition REJECTED | REJECTED; lot.quarantine_status = REJECTED | |
| 3 | Attempt to use lot in production | Blocked: lot not approved | |
| 4 | Attempt any status transition | Blocked: record locked | |

### PQ-R01-04 — Disqualified lab scenario

| Step | Action | Expected | Pass/Fail |
|---|---|---|---|
| 1 | Set lab to DISQUALIFIED in Settings | Updated | |
| 2 | Attach COA from that lab to a PENDING_QC lot | COA attached | |
| 3 | Attempt QC review APPROVED | 422: lab DISQUALIFIED | |
| 4 | Restore lab to ACTIVE; retry | Succeeds | |

## 4. Acceptance

PQ-R01 v2.0 is PASSED when all scenarios are recorded as PASS in the production environment.

**Disposition:** PASS / FAIL / PASS WITH DEVIATION

Executed by: ___________________ Date: ___________
$VAL$, updated_at = now()
WHERE doc_id = 'PQ-R01';

-- ─── VSR-R01 — updated content ────────────────────────────────────────────────

UPDATE erp_validation_documents SET content = $VAL$
# Validation Summary Report — Receiving Module (VSR-R01)

**Report ID:** VSR-R01
**Version:** 2.0
**Date:** 2026-05-04
**Engineering Owner:** System Developer
**QA Signatory:** Head of Quality Control
**Regulatory basis:** 21 CFR Part 111 §111.75, §111.80; 21 CFR Part 11; GAMP 5 Category 5

## 1. Purpose

Formal release authorization for the R-01 Receiving module for regulated use under 21 CFR Part 111.

## 2. Module scope

- PO receipt workflow with automatic lot creation and QUARANTINED status
- Workflow type determination: FULL_LAB_TEST / IDENTITY_CHECK / COA_REVIEW / EXEMPT
- Three-stage gate enforcement (visual inspection, COA, lab accreditation, identity confirmation)
- ANSI/ASQ Z1.4 Level II AQL 2.5 sampling plan calculation for FULL_LAB_TEST workflows
- COA intake with lab accreditation registry enforcement
- Part 11-compliant QC disposition with electronic signature and identity snapshot
- Approved materials registry auto-creation on first approval
- Inventory deep-link navigation from QC disposition toast

## 3. Regulatory compliance

| Regulation | Requirement | Implementation |
|---|---|---|
| 21 CFR 111.75(a)(1)(ii) | Identity test each component lot | identityConfirmed gate (Gate 3b) |
| 21 CFR 111.75(a)(1)(i) | Visual examination | Gates 1 and 2 enforce completion |
| 21 CFR 111.80(b) | Quarantine untested components | Default quarantine_status = QUARANTINED |
| 21 CFR 111.75(a)(2) | Qualified suppliers | approved_materials registry + requires_qualification flag |
| 21 CFR Part 11 §11.50 | Electronic signature meaning | QC disposition requires meaning code + password re-entry |
| 21 CFR Part 11 §11.10(e) | Audit trail | All state transitions in erp_audit_trail |
| ANSI/ASQ Z1.4 | Sampling plan | Level II AQL 2.5 computed and stored per lot |

## 4. Validation documents

| Document | ID | Version |
|---|---|---|
| Installation Qualification | IQ-R01 | 2.0 |
| Operational Qualification | OQ-R01 | 2.0 |
| Performance Qualification | PQ-R01 | 2.0 |

## 5. Release authorization

Based on the successful execution of IQ-R01, OQ-R01, and PQ-R01, the R-01 Receiving module is released for regulated use at Neurogan.

By signing this document, the Head of Quality Control confirms review of all validation protocols and results for this module.

This signature is applied in compliance with 21 CFR Part 11 §11.50 and §11.200.
$VAL$, updated_at = now()
WHERE doc_id = 'VSR-R01';

-- ─── New documents: R2 QMS module set ─────────────────────────────────────────

INSERT INTO erp_validation_documents (id, doc_id, title, type, module, content, status, created_at, updated_at)
VALUES

(gen_random_uuid(), 'IQ-R2', 'Installation Qualification — R2 QMS Modules', 'IQ', 'R2-QMS', $VAL$
# Installation Qualification — R2 QMS Modules (IQ-R2)

**Protocol ID:** IQ-R2-001
**Version:** 1.0
**Date:** 2026-05-04
**Engineering Owner:** System Developer
**QA Signatory:** Head of Quality Control
**Regulatory basis:** 21 CFR Part 111 §111.140, §111.12–14, §111.210(f), §111.15(b)(1); GAMP 5 Category 5

## 1. Scope

Verify that the Release 2 QMS modules are installed correctly in the production environment. R2 covers: CAPA (R2-03), Training gate (R2-04), Stability program (R2-01), and Environmental Monitoring (R2-02).

## 2. Pre-conditions

- Platform IQ-PLATFORM v2.0: PASS
- Migrations 0029–0033 applied to production database

## 3. Installation Checks

### IQ-R2-01 — Applied migrations

| Migration | Module | Pass/Fail |
|---|---|---|
| 0029_r2_03_capa | CAPA tables | |
| 0030_r2_04_training_gate | Training program and record tables | |
| 0031_r2_01_stability_program | Stability protocol, enrollment, and result tables | |
| 0032_r2_02_environmental_monitoring | EM site map, schedule, and result tables | |
| 0033_r08_cleanup | BPR cleanup / consolidation | |

### IQ-R2-02 — Required tables present

| Table | Module | Pass/Fail |
|---|---|---|
| erp_capa_records | CAPA | |
| erp_training_programs, erp_training_records | Training | |
| erp_stability_protocols, erp_stability_enrollments, erp_stability_results | Stability | |
| erp_em_sites, erp_em_schedules, erp_em_results | Environmental Monitoring | |

### IQ-R2-03 — Training gate middleware active

Confirm that the training gate middleware is registered in the server and applied to regulated action routes. Verify: a user with an expired training record for a module receives a 403 TRAINING_EXPIRED response when attempting a gated action.

## 4. Acceptance

IQ-R2 is PASSED when all checks above are recorded.

**Disposition:** PASS / FAIL / PASS WITH DEVIATION

Executed by: ___________________ Date: ___________
$VAL$, 'DRAFT', now(), now()),

(gen_random_uuid(), 'OQ-R2', 'Operational Qualification — R2 QMS Modules', 'OQ', 'R2-QMS', $VAL$
# Operational Qualification — R2 QMS Modules (OQ-R2)

**Protocol ID:** OQ-R2-001
**Version:** 1.0
**Date:** 2026-05-04
**Engineering Owner:** System Developer
**QA Signatory:** Head of Quality Control
**Regulatory basis:** 21 CFR Part 111 §111.140, §111.12–14, §111.210(f), §111.15(b)(1); GAMP 5 Category 5

## 1. Scope

Verify that each R2 QMS module operates as designed. Tests executed via `pnpm test:integration`.

## 2. CAPA (R2-03)

| Test | Expected |
|---|---|
| Create CAPA from OOS investigation | CAPA created; source linked |
| Create CAPA from EM action limit breach | CAPA auto-created; EM result linked |
| Add root cause and corrective action | Fields saved; audit row present |
| Part-11 close-out signature | Status CLOSED; signature record created |
| Attempt to close CAPA without effectiveness check | Blocked |

## 3. Training gate (R2-04)

| Test | Expected |
|---|---|
| Create training program with role requirement | Program saved |
| Record training completion with Part-11 acknowledgement | Record created; signature present |
| Expire training record; attempt gated action | 403 TRAINING_EXPIRED |
| Renew training; retry gated action | Succeeds |

## 4. Stability program (R2-01)

| Test | Expected |
|---|---|
| Create stability protocol with timepoints | Protocol saved |
| Enroll a production batch | Enrollment created; draw dates calculated |
| Enter result at T=0 timepoint | Result saved; PASS/FAIL against spec |
| Part-11 shelf-life conclusion | Conclusion record created with signature |

## 5. Environmental Monitoring (R2-02)

| Test | Expected |
|---|---|
| Create EM site | Site saved to site map |
| Schedule sampling for site | Schedule created |
| Enter result below alert limit | Result NORMAL |
| Enter result above alert limit | Result ALERT |
| Enter result above action limit | Result EXCEEDED; CAPA auto-created |
| View 12-month trend | Chart renders with historical data |

## 6. Acceptance

OQ-R2 is PASSED when all tests above pass with zero failures.

**Disposition:** PASS / FAIL / PASS WITH DEVIATION

Executed by: ___________________ Date: ___________
$VAL$, 'DRAFT', now(), now()),

(gen_random_uuid(), 'PQ-R2', 'Performance Qualification — R2 QMS Modules', 'PQ', 'R2-QMS', $VAL$
# Performance Qualification — R2 QMS Modules (PQ-R2)

**Protocol ID:** PQ-R2-001
**Version:** 1.0
**Date:** 2026-05-04
**Engineering Owner:** System Developer
**QA Signatory:** Head of Quality Control
**Regulatory basis:** 21 CFR Part 111 §111.140, §111.12–14, §111.210(f), §111.15(b)(1); GAMP 5 Category 5

## 1. Scope

Verify that the R2 QMS modules perform correctly in the production environment using realistic Neurogan scenarios.

## 2. Pre-conditions

- IQ-R2: PASS
- OQ-R2: PASS

## 3. Scenarios

### PQ-R2-01 — CAPA lifecycle

| Step | Action | Expected | Pass/Fail |
|---|---|---|---|
| 1 | Open OOS investigation; link to a lot | Investigation created | |
| 2 | Open CAPA from investigation | CAPA created; source linked | |
| 3 | Enter root cause and corrective action plan with due date | Saved; visible in CAPA register | |
| 4 | Record effectiveness check | Check recorded | |
| 5 | Close CAPA with Part-11 signature | Status CLOSED; signature on record | |
| 6 | Attempt to reopen or modify closed CAPA | Blocked: record locked | |

### PQ-R2-02 — Training gate enforcement

| Step | Action | Expected | Pass/Fail |
|---|---|---|---|
| 1 | Create training program for QA receiving role | Program visible in catalog | |
| 2 | Assign program to QA role | Role requirement saved | |
| 3 | Record training completion for a test user; sign acknowledgement | Training record created | |
| 4 | Expire the training record (set expiry to past date) | Record shows expired | |
| 5 | Test user attempts a gated QC action | 403 TRAINING_EXPIRED response | |
| 6 | Record new training; retry | Succeeds | |

### PQ-R2-03 — Stability timepoint workflow

| Step | Action | Expected | Pass/Fail |
|---|---|---|---|
| 1 | Create stability protocol for a product | Protocol saved with timepoints | |
| 2 | Enroll a production batch | Enrollment and draw schedule created | |
| 3 | Enter T=0 results for all attributes | Results saved; PASS/FAIL computed | |
| 4 | Sign shelf-life conclusion | Conclusion record with Part-11 signature | |

### PQ-R2-04 — Environmental monitoring exceedance → CAPA

| Step | Action | Expected | Pass/Fail |
|---|---|---|---|
| 1 | Create EM site and schedule | Site and schedule saved | |
| 2 | Enter result above action limit | Result status = EXCEEDED | |
| 3 | Confirm CAPA auto-created | CAPA in register; EM result linked | |
| 4 | View 12-month trend for site | Chart shows exceedance point | |

## 4. Deviation log

| # | Scenario | Description | Disposition |
|---|---|---|---|

## 5. Acceptance

PQ-R2 is PASSED when all scenarios are recorded as PASS in the production environment and the deviation log has zero unresolved entries.

**Disposition:** PASS / FAIL / PASS WITH DEVIATION

Executed by: ___________________ Date: ___________
$VAL$, 'DRAFT', now(), now()),

(gen_random_uuid(), 'VSR-R2', 'Validation Summary Report — R2 QMS Modules', 'VSR', 'R2-QMS', $VAL$
# Validation Summary Report — R2 QMS Modules (VSR-R2)

**Report ID:** VSR-R2
**Version:** 1.0
**Date:** 2026-05-04
**Engineering Owner:** System Developer
**QA Signatory:** Head of Quality Control
**Regulatory basis:** 21 CFR Part 111; 21 CFR Part 11; GAMP 5 Category 5

## 1. Purpose

Formal release authorization for the R2 QMS module set (CAPA, Training gate, Stability program, Environmental Monitoring) for regulated use under 21 CFR Part 111.

## 2. Module scope

### CAPA (R2-03) — §111.140

Central Corrective and Preventive Action register. All investigation types (OOS, complaints, EM exceedances, BPR deviations) feed into the CAPA register. Each CAPA requires a root cause, corrective action plan with due date, effectiveness check, and Part-11 QA sign-off to close.

### Training gate (R2-04) — §111.12–14

Training program catalog with per-role requirements. Training records with Part-11 acknowledgement signature. Gate middleware blocks any regulated action with TRAINING_EXPIRED if the performing user's training for that module has lapsed.

### Stability program (R2-01) — §111.210(f)

Stability protocols per product defining test attributes and timepoints. Production batch enrollment with draw date scheduling. Per-timepoint result entry with PASS/FAIL against specification limits. Part-11 signed shelf-life conclusion record. Supports regulatory defence of all label shelf-life claims.

### Environmental Monitoring (R2-02) — §111.15(b)(1)

Site map of production area sampling locations. Scheduled sampling program. CFU result entry with automatic comparison against alert and action limits. Action limit breach auto-creates a CAPA. 12-month trend analysis by site.

## 3. Regulatory compliance

| Regulation | Requirement | Implementation |
|---|---|---|
| 21 CFR 111.140 | Investigate failures; CAPA | Central CAPA register with Part-11 close-out |
| 21 CFR 111.12–14 | Only qualified persons perform regulated activities | Training gate middleware blocks lapsed users |
| 21 CFR 111.210(f) | Retain samples; evaluate stability | Stability protocol + enrollment + result + conclusion |
| 21 CFR 111.15(b)(1) | Environmental controls documented | EM site map + schedule + result + CAPA auto-link |
| 21 CFR Part 11 §11.50 | Electronic signature meaning | All close-out and conclusion actions require Part-11 ceremony |
| 21 CFR Part 11 §11.10(e) | Audit trail | All R2 actions written to erp_audit_trail |

## 4. Validation documents

| Document | ID | Version |
|---|---|---|
| Installation Qualification | IQ-R2 | 1.0 |
| Operational Qualification | OQ-R2 | 1.0 |
| Performance Qualification | PQ-R2 | 1.0 |

## 5. Release authorization

Based on the successful execution of IQ-R2, OQ-R2, and PQ-R2, the R2 QMS module set is released for regulated use at Neurogan.

By signing this document, the Head of Quality Control confirms review of all validation protocols and results for the R2 module set.

This signature is applied in compliance with 21 CFR Part 11 §11.50 and §11.200.
$VAL$, 'DRAFT', now(), now());
