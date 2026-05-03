# What's Built — Neurogan ERP

Plain-language status for the operations team. Updated as each phase completes.

**Last updated:** 2026-04-23
**Questions:** Frederik Hejlskov

---

## The short version

We are building a custom software system to manage Neurogan's manufacturing operations — receiving raw materials, reviewing COAs, tracking lots, reconciling labels, handling complaints, and more. It is being built to meet FDA requirements for dietary supplement manufacturers (21 CFR Part 111) and for electronic records and signatures (21 CFR Part 11).

This document tracks what is live, what is coming next, and what each piece does in plain terms.

---

## Phase 0 — Foundation (COMPLETE ✓)

The foundation is everything the system needs before any operational workflows can run. Think of it as the security and record-keeping infrastructure that sits underneath everything else.

### Accounts and roles

Every person using the system has their own account. Each account has one or more roles that control what they can see and do:

| Role | What they can do |
|---|---|
| Admin | Manage user accounts and roles |
| QA | Approve/reject lots, review COAs, sign off on regulated records |
| Production | Work with batch production records |
| Receiving | Process incoming shipments |
| Viewer | Read-only access |

Accounts are never deleted. If someone leaves, their account is disabled so the history of what they did stays intact.

### Secure login

- You log in with your email and password
- Passwords must be strong (12+ characters, mix of letters, numbers, and symbols) and expire every 90 days
- After 5 wrong password attempts in a row, the account is locked for 30 minutes
- You are automatically logged out after 15 minutes of not doing anything

### Permanent audit trail

Every action in the system is automatically recorded — who did it, when, what the record looked like before, and what it looked like after. This log cannot be edited or deleted. This is the audit trail the FDA expects to see when they inspect.

### Electronic signatures

When a regulated action happens — like approving or rejecting a lot — the system asks you to re-enter your password and confirm the meaning of the action (for example: "I am approving this lot as QC Disposition"). Only then does the action go through. This replaces a wet ink signature and is legally binding under FDA rules.

### Lot workflow (states)

Incoming lots of raw material move through a fixed sequence of stages. You cannot skip stages or go backwards. Once a lot is Approved or Rejected, the record is permanently locked.

```
QUARANTINED → SAMPLING → PENDING QC → APPROVED
                                    → REJECTED
```

### Backups and recovery

The database is backed up daily. There is a written plan for how quickly we can recover if something goes wrong (target: back online within 4 hours, data loss no more than 24 hours). A monthly automated check confirms that a restore actually works.

### Validation documents

The IQ, OQ, PQ, and Validation Summary Report (VSR) for the platform are stored as records inside the ERP itself. Head of QC can open the Quality tab, read each document, and sign it using the same electronic signature used everywhere else in the system — no printing, no email. Once signed, the document is permanently locked.

---

## Phase 1 — Operational modules (NOT STARTED YET)

These are the day-to-day workflows that operations will actually use. They cannot start until Head of QC has signed the VSR-PLATFORM document in the Quality tab.

| Module | What it covers | Status |
|---|---|---|
| Receiving | Incoming shipments, sampling plans, COA review, lot approval/rejection | Not started |
| COA / Lab | Structured lab result entry, disqualified lab checks, method validation | Not started |
| Equipment & Cleaning | Calibration schedules, cleaning logs, line clearance | Not started |
| Labeling | Artwork approval, label issuance, reconciliation at batch close | Not started |
| Complaints & SAER | Complaint intake, adverse event tracking, 15-day SAER clock, MedWatch drafts | Not started |
| Returned product | Return intake, quarantine, signed disposition | Not started |

---

## What Steven needs to sign off on before Phase 1 starts

Head of QC (QC Manager) needs to review and sign the Platform Validation Package — a document that confirms the foundation (Phase 0) works correctly and meets FDA requirements. That sign-off is the formal gate before any Phase 1 module begins.

---

## Phase 2 — Advanced modules (FUTURE)

After Phase 1 is live and running, Phase 2 adds:

- Master Manufacturing Records (MMRs) and Batch Production Records (BPRs)
- Finished-goods QC and Shopify release gate
- Stability testing
- Environmental monitoring
- CAPA / quality management
- Training gates
- QuickBooks and Extensiv integrations
