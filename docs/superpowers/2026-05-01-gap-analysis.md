# NEUROGAN-ERP — Full Gap Analysis (2026-05-01)

**Compares:** FDA regulatory requirements (`~/Desktop/NEUROGAN/FDA/`) vs. shipped codebase (60+ tables, 8,650 LOC across schema/routes/storage) vs. specs/plans in `docs/superpowers/`.

**Source-of-truth docs reviewed:**
- `FDA/erp-gap-analysis-and-roadmap.md` (the 2026-04-21 master roadmap)
- `FDA/FDA_Form_483_Observations.md` (the 13 observations from 2026-04-17 inspection)
- `FDA/whats-built.md`
- All 13 specs + 24 plans in `docs/superpowers/`
- Schema (60 tables), routes (3.4 KLOC), storage (3.5 KLOC), migrations 0000–0026

---

## TL;DR

**Phase 1 (FDA-clock modules) is essentially complete.** All 13 observations from the 483 are addressed at the schema + workflow level. The remaining work breaks into three buckets:

1. **One critical regulatory gap that's unspecced:** **FG-QC release gate (Obs 5)** — `finishedGoodsQcTests` table doesn't exist; nutrient-content PASS prerequisite not enforced on the existing BPR `qc-review` endpoint. **Shopify integration is no longer part of R-09** — see policy note below.
2. **Adjacent Part 111 subsystems (not on 483, not yet built):** Stability, Environmental Monitoring, Training matrix, CAPA/QMS backbone. These were correctly deferred to Release 2 per the roadmap.
3. **Integrations (deferred — each gets its own ticket):** Shopify, QBO, Amazon, Extensiv, automated lab COA pickup, Gorgias webhook. **Policy decision 2026-05-01: no integration work begins until QMS modules are complete and validated. Each channel gets its own dedicated ticket.**

### Integration policy (locked 2026-05-01)

Any external system integration — Shopify (multi-store), Amazon, QuickBooks, Extensiv, Gorgias, lab SFTP/API — is now a standalone ticket. Reasons:
- Compliance work (the QMS + 483 closure) is the regulatory priority; integrations are operational nice-to-haves
- Each integration is non-trivial (Shopify alone = custom app + multi-store install)
- Coupling regulatory closure to integration availability creates fragility (if Shopify API changes, does our 483 defense break?)
- **Open question — Extensiv:** with ERP fully running we may not need Extensiv at all. Decision deferred until ERP is in production use; if ERP replaces Extensiv, R2-06 is cancelled, not built.

**Bottom line:** The ERP is in good shape for re-inspection on the 483 observations. The biggest remaining regulatory gap is the FG release gate. Phase 2 modules (CAPA, training, stability, EM) are needed for a "complete Part 111 QMS" but were not 483-cited.

---

## 1. Foundation (Phase 0) — COMPLETE

| Capability | Required | Built? | Evidence |
|---|---|---|---|
| Authentication (passport-local + sessions) | YES | ✅ | `server/auth/passport.ts`, F-02 |
| Users & roles (ADMIN/QA/PRODUCTION/RECEIVING/LAB_TECH/VIEWER) | YES | ✅ | `users`, `userRoles`; F-01 |
| Password policy (12+ chars, 90-day rotation, lockout) | YES | ✅ | `password-policy.ts`, `passwordHistory` table |
| Session timeout (15 min idle) | YES | ✅ | `server/index.ts` session config |
| Audit trail (append-only) | YES | ✅ | `auditTrail` table, `withAudit` wrapper; F-03 |
| Electronic signatures (Part 11 §11.50/§11.70/§11.200) | YES | ✅ | `electronicSignatures` + ceremony; F-04 |
| Record lock (state-transition guard) | YES | ✅ | F-05 |
| Identity-from-session refactor (no body-supplied identity) | YES | ✅ | F-06 |
| Helmet/CSP/CORS/rate limiting | YES | ✅ | `hardening.ts`; F-07 |
| Backup/restore + monthly CI restore-check | YES | ✅ | F-08 |
| Test seed + withRollback | YES | ✅ | F-09 |
| Platform validation (IQ/OQ/PQ/VSR in-system signing) | YES | ✅ | `validationDocuments`, F-10 |
| Email invite flow (Resend) | YES | ✅ | T-09 (live; not yet end-to-end tested in prod) |
| Self-service password reset | YES | ✅ | T-10 (live + tested) |

**Gap:** None at the platform level. Phase 0 fully delivered.

---

## 2. FDA Form 483 — observation-by-observation status

Legend: ✅ shipped to prod / 🟡 partial / ❌ gap / 🔍 verify

| Obs | Topic | Citation | Tables built | Status | Remaining gap |
|---|---|---|---|---|---|
| **1** | Component specifications | §111.70(b), §111.75(a)(1), §111.75(h) | `componentSpecs`, `componentSpecVersions`, `componentSpecAttributes` | ✅ | 🔍 Verify OOS auto-creates a nonconformance — but `nonconformances` table doesn't exist (see §3) |
| **2** | Master Manufacturing Records | §111.205, §111.210 | `mmrs`, `mmrSteps` | ✅ | 🔍 Verify edits to APPROVED MMR versions are forbidden (need new version) |
| **3** | BPR completeness (equipment, cleaning, yield, signatures) | §111.255, §111.260 | `bprDeviations`, `cleaningLogs`, `equipment`, `equipmentQualifications`, `calibrationSchedules`, `calibrationRecords`, `lineClearances`, `productionBatchEquipmentUsed`, `productEquipment` | ✅ | 🟡 R-08 hardened cleaning + deviation sign-off; **R-08 memory notes 3 minor unbuilt items — reviewable** |
| **4** | QC review of HPLC/3rd-party COAs; OOS | §111.70(e), §111.75, §111.103, §111.123 | `coaDocuments`, `labTestResults`, `oosInvestigations`, `oosInvestigationTestResults`, `electronicSignatures` | ✅ | 🔍 Verify identity-test enforcement on lot APPROVE transition (T-03) |
| **5** | QC release/reject finished batches | §111.123(a)(4) | `productionBatches.qcDisposition`, `batchProductionRecords.qcDisposition`, Part-11 signature on BPR review (R-08) | 🟡 | ❌ **`finishedGoodsQcTests` table NOT built; nutrient-content PASS prerequisite not enforced on BPR `qc-review` → R-09. Shopify gate is a SEPARATE downstream ticket and not required to close Obs 5.** |
| **6** | Symbio "Confirm by Input" / scientifically valid methods | §111.75(h)(1) | `labs`, `labQualifications` | ✅ | 🔍 Verify Symbio is set to DISQUALIFIED in seed/prod data |
| **7** | Complaints + AE / SAER | §111.553, §111.560, §111.570, 21 USC 379aa-1 | `complaints`, `complaintTriages`, `complaintInvestigations`, `complaintLabRetests`, `adverseEvents`, `saerSubmissions` | ✅ | 🔍 Verify 15-day SAER clock, MedWatch 3500A draft generation; ❌ Gorgias webhook intake NOT built |
| **8** | Lot traceability on complaints | §111.570(b)(2)(i)(B) | `complaints.lotId` (per R-05) | ✅ (DB) | ❌ Shopify→lot Cloudflare Worker NOT built; backfill tool for 2025–26 complaints NOT built |
| **9** | Label/packaging reconciliation | §111.415(f), §111.260(g) | `labelArtwork`, `labelIssuanceLog`, `labelReconciliations`, `labelSpools`, `labelPrintJobs` | ✅ | 🔍 Verify thermal-printer integration prints lot+expiry through ERP; verify proof-image retention |
| **10** | Labeling/packaging SOPs | §111.415 | `sops` | ✅ | 🔍 Verify BPR steps cite the current approved SOP version |
| **11** | Sampling plans | §111.75(h)(2), §111.80 | `receivingRecords.samplingPlan` (JSONB), Z1.4 generator (T-04) | 🟡 | ❌ No `qcSamples` / retained-sample register table; no skip-lot rule engine |
| **12** | Returned-product SOP | §111.503, §111.510, §111.513 | `returnedProducts`, `returnInvestigations` | ✅ | 🔍 Verify threshold-based investigation auto-trigger when returns/lot exceed limit |
| **13** | Approved materials (food-grade) | §111.20(b)(1), §111.27(a); 21 CFR 177 | `approvedMaterials` | ✅ (DB) | ❌ QBO PO block on non-approved items NOT enforced (no QBO integration); ❌ quarterly GMP walkthrough log NOT built |

### Critical 483 gap

**Obs 5 — FG QC release gate (R-09).** Today, a BPR can transition to `APPROVED_FOR_DISTRIBUTION` (Part-11 signed) without any structured nutrient-content test record. R-09 closes the gap by:
- Adding structured per-analyte test result capture (`finishedGoodsQcTests`)
- Adding finished-goods specs versioned + QA-approved (`finishedGoodsSpecs` parallel to existing `componentSpecs`)
- Gating the existing BPR `qc-review` endpoint: cannot reach `APPROVED_FOR_DISTRIBUTION` without all required attributes PASSING from accredited labs

**The Shopify "unlist on hold" piece is NOT part of R-09.** The regulatory gate lives in the ERP — that's what closes Obs 5. The Shopify channel-availability propagation is separate operational hygiene and gets its own integration ticket on its own timeline.

**Recommendation:** R-09 is the next ticket. Brainstorm scope confirmed 2026-05-01.

---

## 3. Adjacent Part 111 subsystems (not on 483, Release 2 per roadmap §3.15)

These are required for a complete Part 111 QMS but were not cited on the 483. The roadmap deferred them to Release 2 (Days 181–270).

| Subsystem | Citation | Tables in schema? | Status | Roadmap size |
|---|---|---|---|---|
| Personnel qualification / training matrix | §111.12, §111.13, §111.14 | ❌ none | NOT BUILT | L |
| Stability program | §111.210(f); FDA 2003 stability guidance | ❌ none | NOT BUILT | L |
| Environmental monitoring | §111.15 | ❌ none | NOT BUILT | M |
| **CAPA / QMS backbone** (nonconformances, CAPA, change control, management review) | §111.140, §111.553; QSIT CAPA subsystem | ❌ none (was dropped — `qms_*` legacy tables removed in migration 0014) | NOT BUILT | XL |

**Observation:** The roadmap says these were deferred — but Obs 1, Obs 4, and Obs 8 all say "OOS triggers a nonconformance automatically" and "complaint review opens an investigation." Today there is no `nonconformances` table — investigations live in module-specific tables (`oosInvestigations`, `complaintInvestigations`, `returnInvestigations`). That's likely fine for the 483 closure case but **leaves no central CAPA register**, which the FDA looks for in Part 111 §111.140.

**Recommendation:** Even before a full QMS module, a thin `nonconformances` table that other investigations FK into would close the connective tissue gap. ~M-sized work.

---

## 4. Cross-cutting items

| Item | Required | Built? | Notes |
|---|---|---|---|
| Approved-materials registry | YES | ✅ | `approvedMaterials` table; QBO block NOT enforced (deferred — separate ticket) |
| Approved-labs registry | YES | ✅ | `labs` + `labQualifications` |
| Audit trail with periodic QA review | YES | 🟡 | Audit trail ✅; periodic QA-review workflow (sign that audit trail was reviewed) NOT built |
| Records retention (≥2 years past expiry per §111.605) | YES | 🟡 | Append-only audit ✅; explicit retention policy job NOT documented |
| Validation artifacts (URS/FRS/DS/IQ/OQ/PQ/VSR/Trace Matrix) | YES | ✅ | F-10 in-system signing |
| Backup/DR/BCP | YES | ✅ | F-08 monthly restore CI |

### Integrations (separately ticketed — not part of any compliance ticket)

Per the **2026-05-01 integration policy**: each external system integration is its own ticket, sequenced after QMS modules are complete and validated.

| Integration | Status | Notes |
|---|---|---|
| Shopify (multi-store custom app) | NOT BUILT | Custom app on Shopify Dev dashboard, install on each of 4–5 stores; sales orders + FG inventory sync. Substantial own-ticket project. |
| Amazon | NOT BUILT | Same pattern — own ticket later. |
| QuickBooks (QBO) | NOT BUILT | COGS, AP block on non-approved materials/labs/suppliers, scrap write-off. Own ticket later. |
| Extensiv | TBD | **Open question: with ERP in production, may not be needed at all. Decision deferred until ERP is in operational use; may be cancelled rather than built.** |
| Gorgias webhook (auto-create complaint on trigger keyword) | NOT BUILT | Own ticket later. Manual complaint entry works today. |
| Labs SFTP/API automated COA pickup (Eurofins/Alkemist) | NOT BUILT | Manual upload acceptable per FDA. Lowest priority. |
| Cloudflare Worker for Shopify→lot complaint traceability (Obs 8 leftover) | NOT BUILT | Bundled into the Shopify integration ticket when that runs. |

**None of these block 483 closure.** All compliance gates live in the ERP itself.

---

## 5. Net regulatory gaps before re-inspection

Ranked by FDA risk:

### Critical (483-cited, not closed in code)

1. **R-09 — FG-QC release gate (Obs 5)** — `finishedGoodsSpecs` + `finishedGoodsQcTests` + gate on existing BPR `qc-review` endpoint. **Shopify integration is separately ticketed and not part of R-09.** Spec next.

### High (483-cited, partial — needs verification or small fix)

2. **Sampling plan retained-sample register (Obs 11)** — `qcSamples` register with retention location + retention expiry per §111.83(b). Schema doesn't have it; T-04 only added the plan generator.

### High (cited but enforcement requires deferred integrations)

3. **QBO PO block on non-approved materials/labs (Obs 6, 13)** — registry exists in ERP; PO-time enforcement requires QBO integration which is its own ticket. ERP-side defense: registry exists and is auditable.
4. **Gorgias webhook complaint intake (Obs 7)** — manual complaint entry works (closes Obs 7 from a record-keeping standpoint); webhook automation is operational improvement and its own ticket.
5. **Shopify→lot complaint traceability (Obs 8)** — DB schema supports `lotId` on complaints; the order→lot capture path is part of the Shopify integration ticket later.

### Medium (verification items — likely already done, just needs confirming)

6. Confirm OOS auto-creates a nonconformance record (Obs 1, 4)
7. Confirm MMR APPROVED versions are immutable (Obs 2)
8. Confirm BPR blocks consumption from QUARANTINED/REJECTED lots (Obs 3, 5)
9. Confirm Symbio is in DISQUALIFIED state in prod (Obs 6)
10. Confirm BPR steps cite current SOP version (Obs 10)
11. Confirm returns/lot threshold auto-creates investigation (Obs 12)
12. Confirm thermal-printer prints lot+expiry through ERP (Obs 9)

### Low (Phase 2 / not on 483 but should land before next inspection cycle)

13. Stability program (§111.210(f))
14. Environmental monitoring (§111.15)
15. Training matrix with action gating (§111.12–14)
16. Central `nonconformances` + CAPA register (§111.140)
17. Periodic-QA-review-of-audit-trail workflow

---

## 6. Recommended priority order for next sessions

1. **R-09 — FG-QC release gate (Obs 5)** — brainstorm → spec → plan → build. Reserved in `FDA/neurogan-erp-build-spec.md` §6 but scope revised 2026-05-01: Shopify integration is no longer part of R-09. R-09 = ERP-side gate only (specs + structured test results + precondition on existing BPR `qc-review`). Closes the last open 483 observation. Estimated M (1–3 wk now that Shopify is pulled out).
2. **`nonconformances` + CAPA central register** — connective-tissue work; lets §111.140 audit hold even before full QMS module. Estimated M.
3. **Verification sweep** — go through items 6–12 above; either confirm working in prod or open thin tickets for small fixes.
4. **Training matrix + action-gating** — needed before next inspection cycle. Estimated L.
5. **Stability program** — Estimated L.
6. **Environmental monitoring** — Estimated M.
7. **Integrations (Shopify, Amazon, QBO, Gorgias, Extensiv evaluation, lab COA pickup)** — each its own ticket. Sequence after QMS modules complete and validated. Extensiv may be cancelled if ERP fully replaces it in operational use.

---

## 7. What changed since the 2026-04-21 roadmap

The original roadmap projected **180 days to a validated Release 1**. Today (2026-05-01, day ~10 since the 2026-04-21 roadmap) we have shipped:

- All of Phase 0 (Foundation)
- All of Phase 1 modules from §6.2: Receiving (R-01), Equipment+Cleaning (R-03), Labeling+Reconciliation (R-04), Complaints+SAER (R-05), Returned product (R-06), MMR (R-07), BPR hardening (R-08), Component Specifications (Obs 1)
- Most of Phase 2 from §6.3: MMR ✅, BPR hardening ✅; **R-09 FG-QC gate pending (Shopify pulled out per 2026-05-01 policy)**
- Plus T-tickets that close the lab/sampling/OOS surface: T-01 (warehouse rename), T-02 (lab accreditation gate), T-03 (identity test enforcement), T-04 (Z1.4 sampling plan), T-05 (R-01 IQ/OQ/PQ), T-06 (LAB_TECH role + lot routing + per-analyte results), T-07 (lab qualification lifecycle), T-08 (OOS investigation), T-09 (email invite), T-10 (password reset)

**Velocity has been ahead of the original roadmap.** The remaining work is well-scoped.

---

**End of gap analysis.**
