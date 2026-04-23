import { db } from "../../../db";
import * as schema from "@shared/schema";
import { seedIds } from "../../ids";

const IQ_CONTENT = `# Installation Qualification — Platform (IQ-PLATFORM)

**Protocol ID:** IQ-PLATFORM-001
**Version:** 1.0
**Date:** 2026-04-23
**Engineering Owner:** Frederik Hejlskov
**QA Signatory:** Steven Burgueno, QC Manager

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
**QA Signatory:** Steven Burgueno, QC Manager

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
**QA Signatory:** Steven Burgueno, QC Manager

## 1. Scope

Demonstrate that the platform performs its intended regulated functions under real-world conditions over a 5-working-day shadow run.

## 2. Pre-conditions

- IQ-PLATFORM: PASS
- OQ-PLATFORM: PASS
- All platform users trained on the system
- Paper parallel in place

## 3. Shadow-run procedure

Each day Steven Burgueno performs the listed tasks in the staging environment and records the outcome.

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

Executed by: Steven Burgueno, QC Manager — date: ___________`;

const VSR_CONTENT = `# Validation Summary Report — Platform (VSR-PLATFORM)

**Report ID:** VSR-PLATFORM
**Version:** 1.0
**Date:** pending signature
**Engineering Owner:** Frederik Hejlskov
**QA Signatory:** Steven Burgueno, QC Manager

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
| Steven Burgueno | QA | PQ shadow run + system walkthrough | record at execution |

## 8. Periodic review plan

- Audit trail QA review: weekly (first 90 days), monthly thereafter - Steven Burgueno
- Role review: quarterly - Steven Burgueno
- DR restore test: monthly automated CI - Frederik Hejlskov
- Full validation review: annual - Steven Burgueno

## 9. Conclusion

Based on the IQ, OQ, and PQ results documented above, the Neurogan ERP platform foundation is:

FIT FOR INTENDED USE

The platform is authorised to proceed to Phase 1 module development (R-01 through R-06). No Phase 1 module may begin operational use until its own module VSR is signed.

## 10. Authorization

By signing this document using the electronic signature ceremony, I confirm that I have reviewed the IQ, OQ, and PQ protocols and their results, and that the platform foundation meets the requirements defined in the URS.

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
  ]).onConflictDoNothing();
}
