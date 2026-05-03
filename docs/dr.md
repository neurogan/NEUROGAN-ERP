# Disaster Recovery Plan — NEUROGAN ERP

**Document ID:** DR-001  
**Version:** 1.0  
**Effective date:** 2026-04-22  
**Owner:** Frederik Hejlskov (Solo Developer / DBA)  
**QA Reviewer:** Head of QC  
**Regulatory basis:** 21 CFR §111.605 (records retention), 21 CFR Part 11 §11.10(c) (backup and recovery)

---

## 1. Objectives

| Metric | Target |
|--------|--------|
| RTO (Recovery Time Objective) | ≤ 4 hours from incident declaration to restored service |
| RPO (Recovery Point Objective) | ≤ 24 hours of data loss (last successful daily snapshot) |

These targets apply to unplanned outages. Planned maintenance windows are communicated 48 h in advance.

---

## 2. Platform backup cadence

**Platform:** Railway (managed Postgres)  
**Backup type:** Automated daily snapshots  
**Retention:** 7 days on Railway Hobby/Pro plan  

> **Retention gap — action required:**  
> 21 CFR §111.605 requires records to be retained for at least 1 year (2 years for products with a shelf life > 1 year). Railway's 7-day rolling snapshot window does not satisfy this requirement on its own.  
> **Mitigation:** A weekly logical dump (`pg_dump`) is scheduled via the CI workflow below and uploaded to a durable off-site store (see §5). Until this is in place, the responsible party must perform and archive weekly manual dumps.

---

## 3. Backup verification (restore check)

A restore check script (`scripts/restore-check.ts`) runs monthly via CI scheduled job (`.github/workflows/restore-check.yml`). The check:

1. Connects to a database restored from the latest Railway snapshot.
2. Verifies that all regulated tables are present.
3. Verifies that `erp_audit_trail` and `erp_users` are non-empty.
4. Verifies the audit trail immutability constraint is intact.
5. Prints a pass/fail summary.

**Monthly procedure:**
1. Railway dashboard → Postgres service → **Backups** → **Restore to new service**.
2. Copy the new service's `DATABASE_URL`.
3. Run: `RESTORE_CHECK_DATABASE_URL=<url> pnpm restore:check`
4. Archive the output to `FDA/validation/restore-check-YYYY-MM.txt`.
5. QA reviewer signs the archived output (electronic signature via ERP or wet signature on printed copy).
6. Destroy the temporary restored service after sign-off.

---

## 4. Recovery procedure

### 4.1 Full service outage

| Step | Action | Owner |
|------|--------|-------|
| 1 | Declare incident, notify QA | Frederik |
| 2 | Identify last good Railway deployment in dashboard | Frederik |
| 3 | Redeploy last known-good image via Railway dashboard | Frederik |
| 4 | Verify health endpoint: `GET /api/health` → 200 | Frederik |
| 5 | Verify login and audit trail readable | Frederik + Carrie |
| 6 | Close incident, write post-mortem within 48 h | Frederik |

### 4.2 Data loss / corruption

| Step | Action | Owner |
|------|--------|-------|
| 1 | Declare incident, set Railway app to maintenance mode | Frederik |
| 2 | Identify the last clean snapshot (Railway dashboard) | Frederik |
| 3 | Restore snapshot to a new Railway Postgres service | Frederik |
| 4 | Run restore check: `pnpm restore:check` | Frederik |
| 5 | Update `DATABASE_URL` env var to point to restored service | Frederik |
| 6 | Redeploy application | Frederik |
| 7 | QA sign-off on restored data before re-opening to users | Carrie |
| 8 | Document extent of data loss in incident report | Frederik |

### 4.3 Escalation contacts

| Role | Name | Contact |
|------|------|---------|
| Solo Developer / DBA | Frederik Hejlskov | fhv@neurogan.com |
| QA Reviewer | Head of QC | *(see internal contact list)* |
| Railway support | — | https://railway.app/help |

---

## 5. Off-site backup (weekly logical dump)

Until Railway extends retention to ≥ 30 days, a weekly `pg_dump` is required to satisfy 21 CFR §111.605.

**Interim procedure (manual, until automated):**
1. Run: `pg_dump $DATABASE_URL --format=custom --file=neurogan-erp-$(date +%Y-%m-%d).dump`
2. Upload to a durable off-site store (S3, Azure Blob, or equivalent) with versioning enabled.
3. Retain for minimum 2 years.
4. Log the dump date and destination in `FDA/validation/backup-log.csv`.

---

## 6. Change history

| Date | Version | Change | Author |
|------|---------|--------|--------|
| 2026-04-22 | 1.0 | Initial DR plan | Frederik Hejlskov |
