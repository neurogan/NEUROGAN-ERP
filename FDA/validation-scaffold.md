# NEUROGAN-ERP — GAMP 5 Category 5 Validation Scaffold

**System:** Neurogan-ERP (custom software; GAMP 5 Category 5).
**Signatory (all documents below):** Carrie Treat, QC / PCQI.
**Engineering owner:** Frederik Hejlskov.
**Target compliance:** 21 CFR Part 111 (cGMP for dietary supplements), 21 CFR Part 11 (electronic records / e-signatures).
**Version:** 0.1 (scaffold). Populated as tickets from `neurogan-erp-build-spec.md` are completed.

---

## How to use this scaffold

Every ticket in the build spec writes or updates at least one row in §2 (URS), §3 (FRS), §4 (DS), and §7 (Traceability). The ticket's PR must include those appends. At module close, the PQ protocol is executed and the VSR (§9) is signed by Carrie Treat.

Convention for traceability ids:
- URS: `URS-<TICKET>-<NN>` e.g. `URS-F-02-01`
- FRS: `FRS-<TICKET>-<NN>`
- DS:  `DS-<TICKET>-<NN>`
- OQ Test Case: `OQ-<TICKET>-<NN>`

---

## 1. Validation Plan (summary)

| Item | Decision |
|---|---|
| Software classification | GAMP 5 Category 5 (custom) |
| Risk assessment | Complete before Phase 1; high risk drives full IQ/OQ/PQ |
| Supplier assessment | N/A (in-house) |
| Validation deliverables per module | URS, FRS, DS, IQ, OQ, PQ, Traceability Matrix, VSR |
| Electronic records scope | All regulated tables listed in §5 of this document |
| Electronic signatures scope | `electronic_signatures` table (F-04), applied at meanings listed in §6 |
| Change control | Every PR to a regulated path triggers a change-control entry in §10 |
| Periodic review cadence | Audit-trail QA review: weekly for first 90 days, monthly thereafter. Full validation review annually. |
| Retention | ≥2 years past product expiration (§111.605). Audit trail exported monthly to cold storage. |

---

## 2. User Requirements Specification (URS) — index

Populate one table row per URS item. Copy the template when adding.

| ID | Requirement | Source | Status |
|---|---|---|---|
| URS-F-01-01 | System shall maintain unique identification of every user who performs regulated actions. | Part 11 §11.10(d) | DRAFT |
| URS-F-01-02 | System shall allow role assignment (ADMIN / QA / PRODUCTION / RECEIVING / VIEWER) and prevent privilege escalation without ADMIN action. | §111.8, Part 11 §11.10(g) | DRAFT |
| URS-F-02-01 | System shall authenticate users before any regulated action. | Part 11 §11.10(d) | DRAFT |
| URS-F-02-02 | System shall apply a password policy consistent with NIST 800-63B guidance. | Part 11 §11.300 | DRAFT |
| URS-F-02-03 | System shall automatically log users out after 15 minutes of inactivity. | Part 11 §11.10(d) | DRAFT |
| URS-F-02-04 | System shall lock a user account after five consecutive failed login attempts. | Part 11 §11.300(d) | DRAFT |
| URS-F-03-01 | System shall maintain a tamper-resistant, computer-generated audit trail of all regulated writes. | §111.180, Part 11 §11.10(e) | DRAFT |
| URS-F-03-02 | Audit trail entries shall capture time, user, action, entity, before, and after values. | Part 11 §11.10(e) | DRAFT |
| URS-F-04-01 | Regulated state transitions shall require an electronic signature. | Part 11 §11.100 | DRAFT |
| URS-F-04-02 | Electronic signatures shall contain printed name, title, meaning, and time of signing. | Part 11 §11.50 | DRAFT |
| URS-F-04-03 | Electronic signatures shall require re-entry of the signer's password at signing time. | Part 11 §11.200 | DRAFT |
| URS-F-05-01 | Regulated records shall be locked from modification after APPROVED/RELEASED/SUBMITTED status. | §111.180 | DRAFT |
| URS-F-05-02 | State transitions shall be restricted to authorized roles and require applicable e-signatures. | Part 11 §11.10(g) | DRAFT |
| URS-F-06-01 | Identity fields on regulated endpoints shall derive only from the authenticated session, never from the request body. | Part 11 §11.10(d) | DRAFT |
| URS-F-07-01 | Platform shall apply defense-in-depth controls at the transport and request layers. | QMS-SYS-001 | DRAFT |
| URS-F-08-01 | Records shall be recoverable within documented RTO/RPO per the DR plan. | §111.605, Part 11 §11.10(c) | DRAFT |
| URS-R-01-01-01 | System shall restrict purchase orders for components, packaging, and consumables to items on the Approved Materials registry. | §111.20(b)(1), Obs 13 | DRAFT |
| URS-R-01-02-01 | System shall refuse COA acceptance from a lab whose accreditation status is not ACCREDITED. | §111.75(h)(1), Obs 6 | DRAFT |
| URS-R-01-03-01 | System shall maintain component specifications linked to the spec version against which each test result was evaluated. | §111.70(b), Obs 1 | DRAFT |
| URS-R-01-04-01 | Incoming lots of raw materials shall default to QUARANTINED and transition only via authorized, signed actions. | §111.75, Obs 4 | DRAFT |
| URS-R-01-05-01 | System shall generate a statistically justified sampling plan per receipt using ANSI/ASQ Z1.4 General Inspection Level II. | §111.80, Obs 11 | DRAFT |
| URS-R-01-06-01 | System shall require a COA from an accredited laboratory before a lot can transition to APPROVED. | §111.75, Obs 4 | DRAFT |
| URS-R-01-07-01 | QC disposition shall require a Part 11 e-signature carrying meaning `QC_DISPOSITION`. | Part 11 §11.100, Obs 4 | DRAFT |
| URS-R-02-01-01 | Lab test results shall be structured data linked to a specification version. | §111.75, Obs 4 | DRAFT |
| URS-R-02-02-01 | Methods used on COAs shall carry a current method-validation record. | §111.75(h), Obs 6 | DRAFT |
| URS-R-03-01-01 | Production equipment shall carry an IQ/OQ/PQ qualification record. | §111.27, §111.35 | DRAFT |
| URS-R-03-02-01 | A BPR shall not start if any in-use equipment is past its calibration due date. | §111.27(a), Obs 3 | DRAFT |
| URS-R-03-03-01 | Cleaning verification on a BPR shall reference a specific cleaning-log record, not a free-text field. | §111.25, Obs 3 | DRAFT |
| URS-R-03-04-01 | Line clearance shall be recorded before a product changeover. | §111.35, Obs 3 | DRAFT |
| URS-R-04-01-01 | Only QA-approved artwork may be issued to the packaging line. | §111.415, Obs 9/10 | DRAFT |
| URS-R-04-02-01 | Label issuance shall be recorded against a specific BPR and artwork version. | §111.415(f), Obs 9 | DRAFT |
| URS-R-04-03-01 | Every BPR close shall have a label reconciliation (issued − applied − destroyed − returned = 0 within tolerance). | §111.415(f), Obs 9 | DRAFT |
| URS-R-05-01-01 | Every complaint shall be reviewed by a qualified person and linked to a lot before close. | §111.553, §111.570, Obs 7/8 | DRAFT |
| URS-R-05-02-01 | Serious adverse events shall start a 15-business-day SAER clock with automated reminders. | 21 USC 379aa-1, Obs 7 | DRAFT |
| URS-R-05-03-01 | SAER submissions shall draft MedWatch 3500A content from the linked complaint and AE record. | 21 USC 379aa-1 | DRAFT |
| URS-R-05-04-01 | Complaints shall be traceable to the fulfilled lot via the originating Shopify order. | §111.570, Obs 8 | DRAFT |
| URS-R-06-01-01 | Returned product shall default to quarantine and cannot re-stock without a signed disposition. | §111.503, §111.510, Obs 12 | DRAFT |
| URS-R-06-02-01 | A return disposition shall require a Part 11 e-signature carrying meaning `RETURN_DISPOSITION`. | §111.510, Obs 12 | DRAFT |
| URS-R-06-03-01 | Returns for a single lot exceeding threshold shall automatically open a batch investigation and HOLD the lot. | §111.553 | DRAFT |

Statuses: DRAFT → REVIEWED → APPROVED (signature in §9). New URS items are added by the owning ticket's PR.

---

## 3. Functional Requirements Specification (FRS) — index

FRS items describe *what the software does* to meet a URS. One FRS may serve multiple URS ids; an FRS may have multiple DS items underneath.

| ID | Function | Satisfies URS | Status |
|---|---|---|---|
| FRS-F-01-01 | `POST /api/users` creates a user with at least one role; email unique. | URS-F-01-01, 01-02 | DRAFT |
| FRS-F-02-01 | `POST /api/auth/login` authenticates via `passport-local`; sets session cookie; increments failure count on wrong password; locks after 5. | URS-F-02-01, 02-04 | DRAFT |
| FRS-F-02-02 | `POST /api/auth/rotate-password` validates policy, writes new argon2 hash, updates `passwordChangedAt`. | URS-F-02-02 | DRAFT |
| FRS-F-02-03 | Session middleware sets 15-minute rolling idle timeout; server destroys on timeout. | URS-F-02-03 | DRAFT |
| FRS-F-03-01 | `withAudit(entityType, id, action, before, fn)` wraps every regulated write in a transaction that inserts an `audit_trail` row. | URS-F-03-01, 03-02 | DRAFT |
| FRS-F-04-01 | Shared `<SignatureCeremony>` dialog requires password re-entry + meaning code before submitting a signing action. | URS-F-04-01, 04-02, 04-03 | DRAFT |
| FRS-F-05-01 | `transition(entity, action, context)` validates `from → to` + role + signature; throws `ILLEGAL_TRANSITION`, `FORBIDDEN`, or `SIGNATURE_REQUIRED`. | URS-F-05-01, 05-02 | DRAFT |
| FRS-F-06-01 | `rejectIdentityInBody` middleware returns 400 if the request body contains any of `reviewedBy`, `performedBy`, `verifiedBy`, `weighedBy`, `addedBy`, `qcReviewedBy`, `approvedBy`. | URS-F-06-01 | DRAFT |

(Add one row per ticket on merge.)

---

## 4. Design Specification (DS) — index

DS items describe *how the software is implemented*. Types, tables, columns, middleware, routes.

| ID | Design element | Satisfies FRS | Status |
|---|---|---|---|
| DS-F-01-01 | `erp_users` table shape (per F-01 in build spec); `erp_user_roles` composite PK. | FRS-F-01-01 | DRAFT |
| DS-F-02-01 | `passport-local` strategy in `server/auth/strategies.ts` verifies argon2 hash; `serializeUser` stores `user.id` only. | FRS-F-02-01 | DRAFT |
| DS-F-02-02 | `express-session` with `connect-pg-simple`; cookie `secure`, `httpOnly`, `sameSite=lax`, `maxAge=15m` rolling. | FRS-F-02-01, 02-03 | DRAFT |
| DS-F-03-01 | `erp_audit_trail` table owned by schema owner; `INSERT`-only grant to app role; `CHECK (occurred_at <= now() + '1 minute')`. | FRS-F-03-01 | DRAFT |
| DS-F-04-01 | `erp_electronic_signatures` table with `fullNameAtSigning`, `titleAtSigning` snapshots; signature creation always in same transaction as the state change. | FRS-F-04-01 | DRAFT |
| DS-F-05-01 | `server/state/transitions.ts` defines a `Transition<T>[]` per entity; `transition()` looks up the row, validates, and returns the new state. | FRS-F-05-01 | DRAFT |

---

## 5. Regulated-records catalog (electronic records in scope)

Every row in the tables below is an electronic record under Part 11.

| Table | Data purpose | Retention (§111.605) | Signature meanings that touch it |
|---|---|---|---|
| `erp_users` | Identity | Indefinite | AUTHORED (create), REVIEWED (role change) |
| `erp_user_roles` | Authorization | Indefinite | AUTHORED |
| `erp_audit_trail` | Evidence | ≥6 years | none (append-only) |
| `erp_electronic_signatures` | Signatures | ≥6 years | — |
| `erp_lots` | Lot master | ≥2y past expiration | QC_DISPOSITION |
| `erp_receiving_records` | Receipts | ≥2y past expiration | QC_DISPOSITION |
| `erp_coa_documents` | COA references | ≥2y past expiration | REVIEWED, APPROVED |
| `erp_lab_test_results` | Structured results | ≥2y past expiration | — |
| `erp_specifications` / `erp_specification_versions` | Specs | ≥2y past expiration | SPEC_APPROVAL |
| `erp_labs` | Approved labs | Indefinite | APPROVED |
| `erp_approved_materials` | Approved materials | Indefinite | APPROVED |
| `erp_equipment` / `erp_equipment_qualifications` / `erp_calibration_*` | Equipment + calibration | ≥2y past retirement | APPROVED |
| `erp_cleaning_logs` / `erp_line_clearances` | Shop-floor records | ≥2y past expiration | — |
| `erp_label_artwork` / `erp_label_issuance_log` / `erp_label_reconciliations` | Labeling | ≥2y past expiration | APPROVED (artwork) |
| `erp_complaints` / `erp_complaint_reviews` / `erp_adverse_events` / `erp_saer_submissions` | Complaints + AE | ≥6y | COMPLAINT_REVIEW, SAER_SUBMIT |
| `erp_returns` / `erp_return_dispositions` | Returns | ≥2y past expiration | RETURN_DISPOSITION |
| `erp_mmrs` / `erp_mmr_versions` | MMRs (Phase 2) | ≥2y past expiration of every batch that used the version | MMR_APPROVAL |
| `erp_batch_production_records` / `erp_bpr_*` | BPRs (Phase 2) | ≥2y past expiration | QA_RELEASE, DEVIATION_DISPOSITION |
| `erp_finished_goods_qc_tests` | Release tests (Phase 2) | ≥2y past expiration | QA_RELEASE |

---

## 6. Electronic signature meanings

| Meaning code | Used at | Who (typical role) | Part 11 manifestation |
|---|---|---|---|
| `AUTHORED` | User/spec/artwork creation | ADMIN/QA | "Authored by C. Treat, QC/PCQI, 2026-05-01 10:00 PT" |
| `REVIEWED` | COA review, complaint review | QA | "Reviewed by …" |
| `APPROVED` | Spec/artwork/MMR approval, lab approval | QA | "Approved by …" |
| `REJECTED` | Spec/artwork rejection, QC reject | QA | "Rejected by …" |
| `QC_DISPOSITION` | Receiving / lot QC decision | QA | "Disposition APPROVED by …" |
| `QA_RELEASE` | Finished-goods release | QA | "Released by …" |
| `DEVIATION_DISPOSITION` | Deviation close | QA | "Deviation dispositioned by …" |
| `RETURN_DISPOSITION` | Return decision | QA | "Return dispositioned by …" |
| `COMPLAINT_REVIEW` | Complaint close | QA | "Reviewed and closed by …" |
| `SAER_SUBMIT` | MedWatch submission | QA | "Submitted by …" |
| `MMR_APPROVAL` | MMR version approval | QA | "MMR approved by …" |
| `SPEC_APPROVAL` | Spec version approval | QA | "Specification approved by …" |
| `LAB_APPROVAL` | Lab accreditation record | QA | "Lab approved by …" |

---

## 7. Traceability Matrix (template)

One row per URS. Fill as tickets close. Row is complete when all five columns reference valid ids.

| URS | FRS | DS | Test (OQ) | 483 Observation |
|---|---|---|---|---|
| URS-F-01-01 | FRS-F-01-01 | DS-F-01-01 | OQ-F-01-01 | Cross-cutting |
| URS-F-02-01 | FRS-F-02-01 | DS-F-02-01 | OQ-F-02-01 | Cross-cutting |
| URS-F-02-02 | FRS-F-02-02 | DS-F-02-02 | OQ-F-02-02 | Cross-cutting |
| URS-F-03-01 | FRS-F-03-01 | DS-F-03-01 | OQ-F-03-01 | Cross-cutting (§111.180) |
| URS-F-04-01 | FRS-F-04-01 | DS-F-04-01 | OQ-F-04-01 | Obs 4, 5 |
| URS-F-05-01 | FRS-F-05-01 | DS-F-05-01 | OQ-F-05-01 | Obs 2, 3 |
| URS-F-06-01 | FRS-F-06-01 | — | OQ-F-06-01 | Cross-cutting |
| URS-R-01-01-01 | — | — | OQ-R-01-01-01 | Obs 13 |
| URS-R-01-02-01 | — | — | OQ-R-01-02-01 | Obs 6 |
| URS-R-01-03-01 | — | — | OQ-R-01-03-01 | Obs 1 |
| URS-R-01-04-01 | — | — | OQ-R-01-04-01 | Obs 4 |
| URS-R-01-05-01 | — | — | OQ-R-01-05-01 | Obs 11 |
| URS-R-01-06-01 | — | — | OQ-R-01-06-01 | Obs 4 |
| URS-R-01-07-01 | — | — | OQ-R-01-07-01 | Obs 4 |
| URS-R-02-01-01 | — | — | OQ-R-02-01-01 | Obs 4 |
| URS-R-02-02-01 | — | — | OQ-R-02-02-01 | Obs 6 |
| URS-R-03-01-01 | — | — | OQ-R-03-01-01 | Obs 3 |
| URS-R-03-02-01 | — | — | OQ-R-03-02-01 | Obs 3 |
| URS-R-03-03-01 | — | — | OQ-R-03-03-01 | Obs 3 |
| URS-R-03-04-01 | — | — | OQ-R-03-04-01 | Obs 3 |
| URS-R-04-01-01 | — | — | OQ-R-04-01-01 | Obs 9/10 |
| URS-R-04-02-01 | — | — | OQ-R-04-02-01 | Obs 9 |
| URS-R-04-03-01 | — | — | OQ-R-04-03-01 | Obs 9 |
| URS-R-05-01-01 | — | — | OQ-R-05-01-01 | Obs 7/8 |
| URS-R-05-02-01 | — | — | OQ-R-05-02-01 | Obs 7 |
| URS-R-05-03-01 | — | — | OQ-R-05-03-01 | Obs 7 |
| URS-R-05-04-01 | — | — | OQ-R-05-04-01 | Obs 8 |
| URS-R-06-01-01 | — | — | OQ-R-06-01-01 | Obs 12 |
| URS-R-06-02-01 | — | — | OQ-R-06-02-01 | Obs 12 |
| URS-R-06-03-01 | — | — | OQ-R-06-03-01 | Obs 12 |

---

## 8. Protocol templates

### 8.1 IQ Protocol (template)

```
Title: Installation Qualification — <Module / Platform>
Protocol ID: IQ-<MODULE>-001
Approved by: Carrie Treat, QC/PCQI — date, signature
Executed by: <name> — date
Reviewed by: <name> — date

Scope: Verify the system is installed in the production environment per DS.
Pre-conditions:
  - DS approved
  - URS approved
  - Change-control ticket: <id>

Steps:
  IQ-01  Record Railway project, environment, image digest, commit SHA.
  IQ-02  Record Postgres version, extensions, locale, timezone.
  IQ-03  Record env var inventory (names only, not values).
  IQ-04  Record applied migrations (drizzle-kit status output).
  IQ-05  Record session store existence and row count at install.
  IQ-06  Record `erp_app` role grants on `erp_audit_trail` (assert INSERT only).
  IQ-07  Record backup schedule configuration screenshot.

Acceptance criteria: each step recorded with evidence; any deviation raised to change control.

Executed result: <attach evidence bundle>
Disposition: <PASS / FAIL / PASS WITH DEVIATION>
QA sign-off: Carrie Treat — date, signature
```

### 8.2 OQ Protocol (template)

```
Title: Operational Qualification — <Module / Platform>
Protocol ID: OQ-<MODULE>-001
Approved by: Carrie Treat, QC/PCQI — date, signature

Scope: Verify the system's functions perform as specified in the FRS under
       challenge.

Environment: OQ environment (mirror of prod; sanitized data).
Test dataset: pnpm seed:test + module fixtures per seed-fixtures-plan.md.

Test cases: (one row per URS)
  OQ-<id>  URS ref  Procedure   Expected    Actual    Pass/Fail   Deviation

Sign-off: Carrie Treat — date, signature
```

### 8.3 PQ Protocol (template)

```
Title: Performance Qualification — <Module / Platform>
Protocol ID: PQ-<MODULE>-001
Approved by: Carrie Treat, QC/PCQI — date, signature

Scope: Demonstrate the system performs its intended regulated role under
       real production load for a defined shadow-run period.

Duration: 5 working days minimum for platform; one full operating cycle per
          module (one receipt, one batch, one reconciliation, etc.).

Pre-conditions:
  - IQ + OQ signed
  - Operators for the module trained; training records exist
  - Paper parallel in place

Procedure:
  PQ-01  Execute the module's primary flow N times across the shadow run.
  PQ-02  QA reviews the audit trail each business day; findings logged.
  PQ-03  Any deviation opens a change-control entry (§10).
  PQ-04  At close, QA samples 10% of the module's records and re-performs the
         primary action on paper to confirm the electronic record matches.

Acceptance criteria: zero unresolved deviations; audit-trail review clean;
  paper-vs-electronic reconciliation clean.

Sign-off: Carrie Treat — date, signature
```

### 8.4 Validation Summary Report (VSR) (template)

```
Title: Validation Summary Report — <Module / Platform>
Report ID: VSR-<MODULE>
Signatory: Carrie Treat, QC/PCQI — date, signature

1. System description (1 paragraph)
2. Validation approach (GAMP 5 Cat 5, IQ/OQ/PQ, risk-based rationale)
3. Requirements coverage (reference traceability matrix §7; 100% coverage required)
4. Test execution summary (pass/fail counts per URS)
5. Deviations and dispositions (change-control refs)
6. Residual risks and mitigations
7. Training status of all users performing regulated actions in this module
8. Periodic review plan
9. Conclusion: FIT FOR INTENDED USE / NOT FIT / FIT WITH CONSTRAINTS
10. Authorization to replace paper as legal record (explicit statement; date of cutover)

QA signature:    Carrie Treat, QC/PCQI
Engineering:     Frederik Hejlskov
```

---

## 9. Signatures log (this document)

| Section | Revision | Approver | Date | Signature |
|---|---|---|---|---|
| Scaffold v0.1 | Initial | Carrie Treat | _pending_ | _pending_ |
| Scaffold v1.0 (post-Phase 0) | — | — | — | — |
| VSR-PLATFORM | — | — | — | — |
| VSR-R-01 (Receiving) | — | — | — | — |
| VSR-R-02 (COA/Lab) | — | — | — | — |
| VSR-R-03 (Equipment/Cleaning) | — | — | — | — |
| VSR-R-04 (Labeling) | — | — | — | — |
| VSR-R-05 (Complaints/SAER) | — | — | — | — |
| VSR-R-06 (Returns) | — | — | — | — |

---

## 10. Change-control log (this document)

| CC # | Date | Requested by | Scope | Risk class | Disposition | Approver |
|---|---|---|---|---|---|---|
| CC-001 | 2026-04-21 | Frederik | Initial scaffold and URS/FRS/DS set for Phase 0 and Phase 1 | Low | APPROVED | Carrie Treat (pending) |

Additional change-control entries created by every PR that modifies §2–§6 of this document.

---

## 11. Periodic review schedule

| Review | Frequency | Owner | Evidence |
|---|---|---|---|
| Audit trail review | Weekly (first 90 days), monthly thereafter | Carrie Treat | Signed audit-review log |
| Role review | Quarterly | Carrie Treat | Current `erp_user_roles` export vs. org chart |
| Password policy review | Annual | Frederik | Policy diff vs. NIST 800-63B current edition |
| DR restore test | Monthly | Frederik | `restore-check.ts` run log |
| Validation package review | Annual | Carrie Treat | VSR revisions |

---

**End of validation scaffold.**
