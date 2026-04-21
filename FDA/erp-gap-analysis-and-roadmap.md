# NEUROGAN-ERP — FDA Gap Analysis & Build Roadmap

**Companion to:** Response Package - FDA Form 483.md (Sections L and M)
**Date:** 2026-04-21
**Author:** Frederik Hejlskov
**Audience:** Internal build team (Frederik + 1 owner + AI assistance)
**Scope:** Full ERP/MRP buildout scoped to FDA cGMP readiness (21 CFR Part 111) with Part 11 compliance for electronic records/signatures.

---

## 1. Executive summary

Neurogan's 483 exposes a systemic gap between paper-based shop-floor practice and cGMP expectations under 21 CFR Part 111. The decision is to close that gap with the custom ERP rather than commercial MRP, retaining paper as the legal fallback during transition.

The ERP repo (https://github.com/neurogan/NEUROGAN-ERP) is further along than "early scaffolding" — ~3,500 lines of server code and working modules for products, lots, receiving with quarantine, purchase orders, suppliers with qualifications, batch production records with steps/deviations, COA library, production inputs, and transactions. However, it is **not fit to serve as a regulated system of record** today. The single blocking issue: **no authentication layer is wired up**. Every endpoint accepts a free-text `reviewedBy` / `performedBy` / `verifiedBy` string from the client, so dual verification, QC review, and audit trail all rely on unsigned identity. This collapses the Part 11 case immediately.

Addressing authentication unblocks the entire roadmap. After that, the build falls into four buckets: (a) hardening what already exists (receiving, BPR, COA, supplier qualifications) to cGMP standards, (b) building missing modules the 483 requires (MMR, stability, complaints/SAER, finished-goods QC, labeling & reconciliation, equipment & cleaning, training, CAPA/QMS), (c) integrations (Shopify finished-goods, QBO posting, Extensiv sync, lab COA ingestion), and (d) validation per GAMP 5 Category 5 (custom software).

Realistic timeline with current team: **180 days to a validated Release 1 covering receiving, BPR, COA, labeling/reconciliation, complaints/SAER, and equipment/cleaning.** Stability, MMR versioning UI, training matrix, and full CAPA land in Release 2 (months 7–9). Rollout is module-by-module with paper running in parallel until each module passes its IQ/OQ/PQ.

**What the FDA clock forces:** Receiving QC/quarantine, complaints/SAER, labeling reconciliation, and basic equipment/cleaning are on the 15-day response path and the 60/90/180-day CAPA path. Those modules must be production-grade first.

---

## 2. Current ERP inventory (as-is, 2026-04-21)

### 2.1 Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Server | Express 5 + TypeScript 5.6 |
| ORM | Drizzle 0.39 |
| Database | Postgres (Railway-hosted) |
| Client | React 18 + Vite 7 |
| Routing | wouter |
| Data fetching | TanStack Query |
| UI | shadcn/ui + Tailwind |
| Validation | Zod (via drizzle-zod) |
| Deploy | Railway |

Auth-adjacent dependencies present but **unused**: `passport`, `passport-local`, `express-session`, `connect-pg-simple`. No middleware is mounted in `server/index.ts`.

### 2.2 Schema inventory

File: `shared/schema.ts` (598 lines).

| Table (prefix `erp_`) | Purpose | Observed state |
|---|---|---|
| `products` | SKU master | `quarantineStatus` defaults to `APPROVED` on insert — wrong default for raw materials |
| `lots` | Lot master | `status` defaults to `QUARANTINED` (correct); carries `qcDisposition`, `coaUrl`, `coaVerified` |
| `receivingRecords` | Receiving events | `status` state machine defined in comments (QUARANTINED → SAMPLING → PENDING_QC → APPROVED/REJECTED/ON_HOLD) but not enforced in code |
| `locations` | Bin/zone master | Present |
| `transactions` | Inventory movements | Present |
| `suppliers` | Supplier master | Present |
| `supplierQualifications` | Qualification records | Present — status enum QUALIFIED/PENDING/DISQUALIFIED |
| `supplierDocuments` | Supplier doc storage refs | Present |
| `purchaseOrders` / `poLineItems` | PO module | Present |
| `productionBatches` | Batch header | `qcStatus`, `qcDisposition` fields present |
| `recipes` / `recipeLines` | BOM / formulas | Present — but no MMR versioning/approval workflow |
| `batchProductionRecords` | BPR header | Yield deviation, cleaning verification, QC review fields present |
| `bprSteps` | BPR step-level | Dual verification fields; schema comment says "verifiedBy MUST differ from performedBy" |
| `bprDeviations` | BPR deviations | Present |
| `productionInputs` | Components consumed per batch | Present |
| `productionNotes` | Free-text notes | Present |
| `coaDocuments` | COA library | Carries `qcAccepted`, `reviewedBy`, `reviewedAt` |
| `productCategories` | Category master | Present |
| `appSettings` | KV settings | Present |

### 2.3 API inventory

File: `server/routes.ts` (1,195 lines) — 90+ endpoints across products, lots, locations, transactions, suppliers, POs, batches, recipes, inventory, receiving, COA, supplier qualifications, BPR (steps + deviations), and dashboard.

QC review endpoints exist at:
- `POST /api/receiving/:id/qc-review` (disposition + reviewedBy)
- `POST /api/coa/:id/qc-review` (accepted + reviewedBy)
- `POST /api/batch-production-records/:id/qc-review` (disposition + reviewedBy)

All three accept `reviewedBy` as a **free-text string from the request body**.

### 2.4 Client inventory

File: `client/src/App.tsx` — wouter routes for Dashboard, Inventory, SupplyChain, Suppliers, Receiving, Production, Transactions, SkuManager, Settings, BatchPrint, CoaLibrary.

No login screen, no user menu, no role gate on any route.

### 2.5 What already works well

- BPR has dual verification enforced in the storage layer (`updateBprStep` throws if `verifiedBy === performedBy` — `db-storage.ts:1620-1660`).
- Receiving has a quarantine state vocabulary and a QC-review action.
- COA library treats QC acceptance as a gated step.
- Supplier qualifications exist as first-class records.
- Drizzle schema uses Zod insert validators, giving us free server-side validation.

---

## 3. Observation-by-observation gap matrix

Legend — Coverage: `NONE` / `PARTIAL` / `SUBSTANTIAL` / `FULL`. Build size: `S` (≤1 wk), `M` (1–3 wk), `L` (1–2 mo), `XL` (2+ mo).

Observation numbers match the FDA Form 483 issued 2026-04-17 and Section B of the Response Package. Adjacent Part 111 subsystems that were not cited on the 483 but are required for a complete QMS are carried in §3.15 for Release 2 planning.

### 3.1 Obs 1 — No written component specifications (§111.70(b), §111.75(a)(1), §111.75(h))

- **Coverage:** NONE. No specifications table exists.
- **Gap:** No master spec per component (identity, purity, strength, contaminants), no spec versioning, no link from QC test results to the spec they were evaluated against, no spec coverage for in-process or finished goods either.
- **Build:** `specifications` (scope COMPONENT / IN_PROCESS / FINISHED, per-attribute limits), `specificationVersions`, `specApprovals`. Test results link to the spec version they were evaluated against; OOS triggers a nonconformance automatically.
- **Size: L.**

### 3.2 Obs 2 — No Master Manufacturing Records (§111.205, §111.210)

- **Coverage:** PARTIAL. `recipes` + `recipeLines` tables exist; no approval/versioning/lock workflow, no MMR record type, no QA approval signature.
- **Gap:** No MMR wrapper with revision history, no approval gate, no snapshot from `productionBatches.recipeId` to a locked MMR version. Edits to a recipe retroactively change the history of any batch that used it.
- **Files:** `shared/schema.ts` lines ~175–210 (recipes) need an MMR wrapper table.
- **Build:** `mmrs` + `mmrVersions` + `mmrApprovals`; `productionBatches` resolves to a specific approved MMR version; edits to approved MMR versions forbidden (new version required).
- **Size: L.**

### 3.3 Obs 3 — BPRs incomplete: equipment ID, cleaning records, yield, signatures missing (§111.255, §111.260)

- **Coverage:** SUBSTANTIAL. `batchProductionRecords`, `bprSteps`, `bprDeviations` exist. BPR has `cleaningVerified` / `cleaningVerifiedBy` / `cleaningRecordReference` fields, yield tracking, dual-verification enforced in the storage layer (`updateBprStep` throws if `verifiedBy === performedBy`). Equipment is a free-text field on BPR.
- **Gap:** No equipment master, no calibration schedule with due-date gate, no cleaning-log table (cleaning references resolve to a free-text string rather than an FK), no line-clearance record, no IQ/OQ/PQ records per asset. Deviation table exists but no investigation workflow, no QA disposition sign-off, no CAPA linkage, no trending.
- **Build:** `equipment`, `equipmentQualifications`, `calibrationSchedules`, `calibrationRecords`, `cleaningLogs`, `lineClearances`; replace BPR's free-text cleaning reference with an FK; block BPR start if equipment calibration is overdue. Extend `bprDeviations` with investigation, rootCause, `qaDispositionBy` (Part 11 signed), link to CAPA (see §3.15).
- **Size: L.**

### 3.4 Obs 4 — QC not reviewing/approving in-house HPLC and 3rd-party COAs; OOS cited (§111.70(e), §111.75, §111.103, §111.123)

- **Coverage:** PARTIAL. `coaDocuments` carries `qcAccepted`, `reviewedBy`, `reviewedAt`. `POST /api/coa/:id/qc-review` and `POST /api/receiving/:id/qc-review` exist but accept `reviewedBy` as a free-text string. Lot has `coaVerified` boolean.
- **Gap:** No component-identity test requirement enforced per material; no "at least one scientifically valid identity test" gate on lot approval; no structured lab-result capture (COAs are PDFs, not data); no OOS investigation workflow; identity strings on QC review are cosmetic, not Part 11 signatures.
- **Build:** `componentTestPlans`, structured `labTestResults` linked to `coaDocuments`, release gate logic. Wrap QC review in a Part 11 signature ceremony (password re-entry + meaning code + manifestation). `oosInvestigations` workflow with retained-sample re-test and decision tree (recall / reject / release-with-justification).
- **Size: L.**

### 3.5 Obs 5 — QC did not approve/release or reject finished batches (§111.123(a)(4))

- **Coverage:** PARTIAL. `productionBatches.qcDisposition` and `batchProductionRecords.qcDisposition` exist; `POST /api/batch-production-records/:id/qc-review` exists.
- **Gap:** Release gate is not enforced at inventory-transfer level — a batch can become sellable finished-goods inventory without an authenticated QC approval. No Part 11 e-signature on release. No authenticated QC user because auth is not wired up (§4.1 is the blocking prerequisite).
- **Build:** `finishedGoodsQcTests`, `releaseSignatures` (Part 11). Block inventory release without both nutrient-content PASS and a QA release signature. Shopify / Extensiv integrations enforce the gate downstream.
- **Size: L.**

### 3.6 Obs 6 — Symbio Labs COA ("Confirm by Input") not scientifically valid (§111.75(h)(1))

- **Coverage:** NONE.
- **Gap:** No Approved-Lab list, no disqualified-lab enforcement on COA acceptance, no method-validation record, no PO-time block on non-accredited labs.
- **Build:** `labs` table (status ACCREDITED / DISQUALIFIED / PENDING, accreditation number, scope), method-validation records, COA acceptance refuses to proceed when the lab is not ACCREDITED. QBO PO block on AP to non-approved labs (via approved-labs registry in §3.14).
- **Size: M.**

### 3.7 Obs 7 — Complaints not reviewed by qualified person; adverse events not investigated (§111.553, §111.560, §111.570, 21 USC 379aa-1)

- **Coverage:** NONE. No complaints module; ops uses Gorgias free-text today.
- **Gap:** No structured complaint intake, no QA review workflow, no AE triage (serious/non-serious), no DSHEA SAER filing path (MedWatch 3500A), no 15-business-day SAER clock, no trend/signal reports.
- **Build:** `complaints`, `complaintReviews`, `adverseEvents` (with serious flag + 15-day SAER clock), `saerSubmissions` (MedWatch 3500A draft). Gorgias webhook auto-creates a complaint record on trigger-keyword match; QA review routing within 24 h.
- **Size: XL.**

### 3.8 Obs 8 — Complaint records lack batch/lot number (§111.570(b)(2)(i)(B))

- **Coverage:** NONE. Complaint module does not exist; Shopify order → lot link does not exist.
- **Gap:** No lot traceability from a Shopify order (or Klaviyo event) back to the fulfilled inventory lot — so even a well-formed complaint cannot be tied to a batch. No Gorgias intake macro that requires a lot code before ticket closure.
- **Build:** Shopify → lot traceability (Cloudflare Worker captures fulfilment inventory lot and writes it back to the order + Klaviyo event properties); complaint record carries a `lotId` FK; Gorgias macro requires lot code before close; backfill tool for 2025–2026 complaints using order date + FIFO.
- **Size: M.**

### 3.9 Obs 9 — No reconciliation of labels/packaging issuance vs use vs return (§111.415(f), §111.260(g))

- **Coverage:** NONE. Thermal-transfer lot/expiry is offline today; no issuance or reconciliation data captured.
- **Gap:** No artwork master, no artwork approval workflow, no label issuance log, no reconciliation (issued − applied − destroyed − returned = 0 within tolerance), no proof retention, no label-cage access model.
- **Build:** `labelArtwork` (with `approvedByQa`, version), `labelIssuanceLog`, `labelReconciliations` (tolerance defined in SOP-PR-012), `labelProofs`. Thermal-transfer print path issues lot+expiry through the ERP so counts are captured.
- **Size: L.**

### 3.10 Obs 10 — No written labeling/packaging SOPs (§111.415)

- **Coverage:** NONE in ERP (belongs primarily in the QMS).
- **Gap:** SOP-PR-013 (Labeling/Packaging Operations) lives in Notion/Dropbox today; the ERP does not link BPR steps to the current approved SOP version. Line clearance, single-label-at-line rule, and pre-run artwork-vs-MMR check are not enforced in software.
- **Build:** `sops` (version-controlled reference), BPR steps cite the current approved SOP version; line-clearance record (see §3.3) required at changeover; artwork-vs-MMR check integrated into BPR gating.
- **Size: S (ERP side).** SOP authoring is QMS work, not ERP code.

### 3.11 Obs 11 — No sampling plans for HPLC components or finished-product testing (§111.75(h)(2), §111.80)

- **Coverage:** NONE. No Z1.4 sampling generator, no QC-sample register.
- **Gap:** No ability to generate a lot-size-aware sample plan (ANSI/ASQ Z1.4 General Inspection Level II) per receipt or per finished batch; no retained-sample register; no skip-lot rule after N compliant lots per supplier.
- **Build:** Sampling-plan generator on receiving and on finished-batch close (inputs: lot size, test class; outputs: n per the tables in Response Package Section H). `qcSamples` register with retention location and retention expiry (shelf life + 1 year per §111.83(b)). Skip-lot rule engine (enabled only after ≥5 consecutive compliant lots per supplier).
- **Size: M.**

### 3.12 Obs 12 — No returned-product SOP (§111.503, §111.510, §111.513)

- **Coverage:** NONE. No returns module. Returns historically went back to inventory or to trash without QC review.
- **Gap:** No quarantine-cage tracking, no QC disposition workflow (destroy / salvage with re-test / reprocess / investigate), no linkage from a return back to the originating lot for trend analysis, no KPI on returns-per-lot.
- **Build:** `returns` (linked to Shopify order and lot), disposition workflow with QA Part 11 signature, quarantine-location model, threshold-based trigger that opens a batch investigation when returns for a single lot exceed limit.
- **Size: S.**

### 3.13 Obs 13 — Non-food-grade contractor trash bags used for components (§111.20(b)(1), §111.27(a); 21 CFR 177)

- **Coverage:** NONE. No Approved Materials list; QBO can issue a PO for any consumable.
- **Gap:** No ERP-side registry of food-grade / 21 CFR 177-compliant consumables (liners, bags, gloves, scoops); no periodic GMP walkthrough log.
- **Build:** `approvedMaterials` registry (item, supplier, 21 CFR 177 citation, SDS, expiration). QBO PO block on non-registered items. Quarterly GMP walkthrough checklist log.
- **Size: S.**

### 3.14 Cross-cutting gaps (not mapped 1:1 to a single observation)

| Gap | Description | Size |
|---|---|---|
| **Part 11 foundation** | Auth, roles, e-signature, audit trail, record lock, session controls, password policy | XL |
| **User & role master** | Employees, roles, responsibilities, training linkage | L |
| **Approved-materials / approved-labs registry** | Enforces components come from qualified suppliers and tests come from accredited (non-disqualified) labs (also directly supports Obs 6 and Obs 13) | M |
| **Integrations — Shopify** | Finished-goods release → Shopify product availability; on-hold propagates to unlisted (also supports Obs 8 lot traceability) | L |
| **Integrations — QBO** | COGS, inventory value, rejected material scrap write-off; PO block on non-approved suppliers, labs, and materials | M |
| **Integrations — Extensiv** | Two-way sync for finished goods; ERP remains authoritative for QC state | L |
| **Integrations — Labs (Eurofins/Alkemist)** | COA PDF intake, parse, attach to lot, mark QC-reviewable | M |
| **Records retention & audit trail** | Append-only audit log on every regulated write; §111.180 and §111.605 retention (≥2 years past product expiration); periodic QA review of audit trail | L |
| **Validation artifacts (GAMP 5 Cat 5)** | URS, FRS, DS, IQ/OQ/PQ protocols, traceability matrix, validation summary report | L |
| **Backup / DR / BCP** | RTO/RPO, restore tests, Railway backup policy documentation | S |

### 3.15 Adjacent Part 111 subsystems not cited on the 483

These were not called out on the 2026-04-17 Form 483 but are required for a complete Part 111 QMS and will be in scope before re-inspection. Released in Release 2 per §6.3.

| Subsystem | Citation | Coverage today | Build | Size |
|---|---|---|---|---|
| Personnel qualification / training matrix | §111.12, §111.13, §111.14 | NONE — no employee or training tables | `users`, `jobRoles`, `trainingRecords`, `trainingRequirements`; gate on regulated actions when training is expired | L |
| Stability program | §111.210(f); FDA 2003 stability guidance | NONE | `stabilityStudies`, `stabilityProtocols`, `stabilityPullSchedule`, `stabilityResults`, `shelfLifeDeterminations` | L |
| Environmental monitoring | §111.15 | NONE | `emPlans`, `emSamplingPoints`, `emSchedule`, `emResults`, `emTrends` | M |
| CAPA / QMS backbone | §111.140, §111.553; QSIT CAPA subsystem | NONE | `nonconformances`, `capa` (5-why/fishbone, owner, due date, effectiveness check), `changeControl`, `managementReviews` | XL |

---

## 4. Risk flags in existing code

These are issues in the current repo that block Part 11 conformance or create cGMP exposure if the system is used as-is.

### 4.1 No authentication (critical)

- `server/index.ts` mounts only `express.json()`, body parser, and a request logger. No `passport.initialize()`, no session middleware, no JWT guard.
- Every `reviewedBy`, `performedBy`, `verifiedBy`, `weighedBy`, `addedBy` value is a free-text string from the request body.
- Impact: dual verification is cosmetic; QC review signatures are cosmetic; audit trail cannot attribute actions to a real identity. **This is the single biggest gap.**
- Fix: implement server-side auth (session-based with `passport-local` + `connect-pg-simple` OR short-lived JWT), replace every body-supplied identity with `req.user.id`, reject requests that try to set identity from the body.

### 4.2 Unsafe default on product quarantine status

- `shared/schema.ts` line 42: `quarantineStatus: text("quarantine_status").default("APPROVED")`.
- New products default to `APPROVED`. Raw materials should default to `QUARANTINED`.
- Fix: change default to `QUARANTINED` for `category IN (RAW, COMPONENT)` and enforce via trigger or application logic.

### 4.3 State transitions not enforced

- `receivingRecords.status` and `lots.status` have documented state machines (QUARANTINED → SAMPLING → PENDING_QC → APPROVED/REJECTED/ON_HOLD) but no code enforces legal transitions.
- Impact: a client can PATCH a lot from QUARANTINED straight to APPROVED with no QC review.
- Fix: server-side transition guard (state diagram encoded in storage layer), plus Part 11 signed-transition requirement for approval moves.

### 4.4 QC review is a single string field

- `qcReviewReceivingRecord`, `qcReviewCoa`, `qcReviewBpr` accept `reviewedBy` as input string, not a Part 11 signature.
- Impact: not a compliant electronic signature.
- Fix: wrap in e-signature ceremony (password re-entry or second factor + meaning code + manifestation on the record).

### 4.5 No audit trail

- No `auditTrail` table, no Drizzle middleware, no database triggers.
- Impact: cannot reconstruct who changed what when — explicit §111.180 and Part 11 violation.
- Fix: append-only `auditTrail` with before/after JSON, written by a Drizzle hook on every regulated table write.

### 4.6 Recipes are editable records, not versioned MMRs

- `recipes` / `recipeLines` are mutable; `productionBatches.recipeId` points to the mutable current state.
- Impact: a change to a recipe retroactively changes the history of batches that used it.
- Fix: snapshot the MMR version at batch creation; forbid edits to an approved MMR version (versioning required).

### 4.7 No rate limiting, no CORS policy visible, no CSP

- `server/index.ts` has no `helmet`, no `express-rate-limit`, no explicit CORS config.
- Impact: hardening gap; not a blocker but needs closure before production regulated use.

### 4.8 No test suite visible

- Repo has `drizzle.config.ts` and Vite but no visible test directory or CI config for tests.
- Impact: OQ cannot rest on unit/integration tests.
- Fix: Vitest + supertest for API, Playwright for critical UI flows, run on CI on every PR; link test artifacts to the validation package.

### 4.9 Drizzle migrations auto-run on boot

- `server/index.ts` calls `runMigrations()` at startup.
- Impact: schema drifts are applied without change control; not acceptable for a validated system.
- Fix: separate migrations from boot, require explicit deploy-time migration step with change-control record.

---

## 5. Per-module go-live criteria

Each ERP module may only replace paper for regulated records once all criteria are met. Paper runs in parallel until that point, and paper remains the legal record for any data written before go-live.

### 5.1 Foundation (must pass before any other module can go live)

1. Authentication mounted; every `/api/*` route requires a session. Unauthenticated requests return 401.
2. User master with roles (ADMIN, QA, PRODUCTION, RECEIVING, VIEWER) and at least the matrix from §6 Release 1.
3. Password policy (≥12 chars, complexity, 90-day rotation), session timeout (15 min idle), lockout after 5 failed attempts.
4. Audit trail table writing before/after JSON on every regulated write; append-only constraint verified.
5. Electronic signature table with meaning codes, signature manifestation visible on the record it attests to.
6. Critical-path endpoints use `req.user.id` instead of request-body identity strings; dual verification validated against real users.
7. GAMP 5 Cat 5 validation package for the foundation: URS, FRS, DS, IQ, OQ, PQ, Traceability Matrix, VSR, signed by QA.
8. Backup + restore tested end-to-end; RTO/RPO documented.

### 5.2 Receiving (Obs 1, 4, 6, 11, 13 + cross-cutting approved-materials/approved-labs)

1. Approved-materials registry active; POs can only be placed for components on the registry and only against qualified suppliers.
2. Receiving creates lot with status QUARANTINED; status transitions enforced server-side.
3. Sampling plan (ANSI/ASQ Z1.4 Level II) generated per receipt.
4. COA intake path working: upload PDF → attach to lot → QC reviewable.
5. Disqualified-lab enforcement (Symbio in, flagged) on COA acceptance.
6. Part 11 e-signature required for QC disposition (APPROVED / REJECTED / APPROVED_WITH_CONDITIONS).
7. Identity test requirement per component enforced — no APPROVED transition without an identity-test result linked.
8. Module IQ/OQ/PQ completed and signed; operator training for RECEIVING role completed.

### 5.3 BPR / production (Obs 2, 3, 4, 5)

1. MMR module live; every `productionBatches` row links to an approved MMR version.
2. Components consumed from lots with status APPROVED only; system blocks consumption of QUARANTINED/REJECTED lots.
3. Dual verification operates against real authenticated users (weighedBy ≠ weightVerifiedBy; addedBy ≠ additionVerifiedBy; performedBy ≠ verifiedBy).
4. Deviations block auto-release; QA disposition required with Part 11 signature.
5. In-process spec checks integrated; OOS blocks progression.
6. Finished-goods QC gate blocks inventory release until nutrient-content test PASS + QA release signature (Part 11).
7. Module IQ/OQ/PQ complete; PRODUCTION and QA role training complete.

### 5.4 COA / lab (Obs 4, 6)

1. Accredited-labs registry; Symbio blocked; Eurofins/Alkemist/equivalent accepted.
2. COA ingestion pipeline (upload + parsed fields captured) working.
3. COA reviewed via Part 11 e-signature.
4. Lot release blocked until relevant COAs are QC-accepted.
5. Module IQ/OQ/PQ complete.

### 5.5 Labeling & reconciliation (Obs 9, 10)

1. Artwork master with QA-approved version; no print from unapproved artwork.
2. Label issuance log: quantity issued per batch tracked.
3. Reconciliation at batch close: issued − applied − destroyed − returned = 0 (tolerance defined in SOP).
4. Lot + expiry printed through the ERP print path (integrated with existing thermal-transfer printer).
5. Proof image/scan retained per batch.
6. Module IQ/OQ/PQ complete.

### 5.6 Complaints / SAER (Obs 7, 8)

1. Complaint intake working: manual + Gorgias webhook.
2. QA review workflow with dispositions; linkage to lot/batch/BPR.
3. AE flagging and 15-day SAER clock with countdown and overdue alerts.
4. MedWatch 3500A draft generated from AE record.
5. Module IQ/OQ/PQ complete; CX and QA trained.

### 5.7 Equipment & cleaning (part of Obs 3; equipment and cleaning records were two of the BPR completeness gaps)

1. Equipment master with every asset used in production.
2. Calibration schedule with due dates; BPR blocks start if calibration overdue.
3. Cleaning log per equipment per run; BPR `cleaningVerified` references a real cleaning-log record, not a free-text string.
4. Line-clearance record required before next product changeover.
5. Module IQ/OQ/PQ complete.

### 5.8 Specifications (Obs 1)

1. Specification master live for all components, in-process, finished.
2. Test results link to the spec version they were evaluated against.
3. OOS triggers nonconformance automatically.
4. Module IQ/OQ/PQ complete.

### 5.9 Environmental monitoring (not cited on the 483 — §111.15; Release 2 per §3.15)

1. EM plan with sampling points and schedule.
2. Results capture; OOL triggers nonconformance.
3. Trending reports (monthly) signed by QA.
4. Module IQ/OQ/PQ complete.

### 5.10 Stability (not cited on the 483 — §111.210(f); Release 2 per §3.15)

1. Stability protocol per SKU with pull schedule.
2. Pull alerts to QA with due-date aging.
3. Result capture tied to protocol and spec.
4. Shelf-life determination record signed by QA.
5. Module IQ/OQ/PQ complete.

### 5.11 CAPA / QMS (not cited on the 483; Release 2 per §3.15. Note: 483 Obs 13 covers approved food-grade materials — see §5.15 and §3.13)

1. Nonconformance log feeding from Receiving, BPR, EM, Stability, Complaints.
2. CAPA workflow with owner, due date, effectiveness verification.
3. Change control gates MMR changes, spec changes, system changes.
4. Management review monthly, signed.
5. Module IQ/OQ/PQ complete.

### 5.12 Training

1. Job-role competency matrix.
2. Training records with expiration dates.
3. Gate: user cannot perform a regulated action if required training is expired.
4. Module IQ/OQ/PQ complete.

### 5.13 Integrations

1. Shopify: finished-goods SKUs set to `inventory=0` or unlisted when any lot is on hold; restored on release.
2. QBO: COGS and inventory-value postings; scrap write-off on REJECTED lots.
3. Extensiv: two-way sync; ERP owns QC state, Extensiv owns physical FG location.
4. Labs: automated COA pickup where the lab supports it (SFTP/API), manual upload fallback.

### 5.14 Returned product (Obs 12)

1. Returns record captures originating Shopify order, lot, condition, and intake date.
2. Quarantine-cage location model; all returns routed to quarantine on intake.
3. QA disposition workflow (destroy / salvage with re-test / reprocess / investigate) with Part 11 signature.
4. Returns-per-lot threshold triggers a batch investigation automatically.
5. Module IQ/OQ/PQ complete; warehouse + QA role training complete.

### 5.15 Approved materials registry (Obs 13)

1. Approved Materials list covers every consumable contacting product (liners, bags, gloves, scoops) with food-grade / 21 CFR 177 citation.
2. QBO AP path blocks POs for items not on the registry.
3. Quarterly GMP walkthrough checklist logged; findings feed nonconformance (§3.15).
4. Module IQ/OQ/PQ complete.

---

## 6. 180-day build sequence (Release 1)

Team: Frederik + 1 owner + AI assistance. Capacity: assume ~1.2 FTE equivalent sustained. This plan is aggressive; scope cuts are called out in §6.3.

### 6.1 Phase 0 — Foundation (Days 1–30)

Goal: ERP becomes a regulated system of record at the platform level. Nothing rolls out to the floor yet.

| Week | Workstream | Deliverable |
|---|---|---|
| 1 | Auth | `passport-local` + `express-session` + `connect-pg-simple` wired; login page; 401 on every `/api/*` without session |
| 1 | Auth | Password policy, session timeout, lockout; password hashing (argon2id) |
| 2 | Users & roles | `users`, `roles`, `userRoles`; seed ADMIN/QA/PRODUCTION/RECEIVING/VIEWER; role-gate middleware |
| 2 | Identity refactor | Replace body-supplied identity with `req.user.id` across all QC/dual-verify endpoints |
| 3 | Audit trail | `auditTrail` table (append-only via DB constraint), Drizzle write hook, UI viewer |
| 3 | E-signatures | `electronicSignatures` table with meaning codes (AUTHORED / REVIEWED / APPROVED / REJECTED); signature ceremony UI |
| 4 | Record lock | Regulated records append-only at ORM layer; rejected edits produce audit entry |
| 4 | State transitions | Encode legal transitions for `lots`, `receivingRecords`, `productionBatches`, `batchProductionRecords`; enforce in storage layer |
| 4 | Platform validation | URS/FRS/DS drafted; IQ executed on Railway; OQ test suite (Vitest + Playwright) for Part 11 controls; PQ dry-run |

Exit gate: Foundation IQ/OQ/PQ signed by QA. Without this, no module rolls out.

### 6.2 Phase 1 — High-clock modules (Days 31–120)

FDA response clocks force Receiving, Complaints/SAER, Labeling/Reconciliation, Equipment/Cleaning first. All four land in Release 1.

| Weeks | Module | Deliverable |
|---|---|---|
| 5–7 | Receiving hardening | Approved-materials registry; state-transition enforcement; sampling-plan generator (Z1.4 L-II); COA upload → lot attachment; disqualified-lab enforcement; Part 11 QC disposition |
| 7–9 | COA / lab | Accredited-labs registry; lab-result structured capture; lot release blocked on COA gate |
| 8–10 | Equipment & cleaning | Equipment master; calibration schedule; cleaning-log table; BPR integration (blocks on overdue calibration; cleaning-log FK replaces free-text) |
| 10–12 | Labeling & reconciliation | Artwork master; issuance log; reconciliation report; proof retention; thermal-printer integration |
| 12–14 | Complaints / SAER | Complaints table; Gorgias webhook; AE flag + 15-day clock; MedWatch 3500A draft |
| 14–16 | Specifications | Spec master; spec linkage on test results; OOS auto-creates nonconformance |
| 16–17 | Module IQ/OQ/PQ | Run validation for each of the six modules above |
| 17 | Controlled rollout | Receiving → pilot week with paper parallel → go-live. Then BPR path (Phase 2), then others staggered |

### 6.3 Phase 2 — BPR + MMR + finished-goods QC (Days 90–180, overlapping Phase 1)

| Weeks | Module | Deliverable |
|---|---|---|
| 9–13 | MMR module | `mmrs` / `mmrVersions` / `mmrApprovals`; QA approval gate; version lock; snapshot-on-batch-create |
| 13–16 | BPR hardening | Real-user dual verification; OOS blocks progression; deviation workflow with QA disposition signed |
| 16–19 | Finished-goods QC | `finishedGoodsQcTests`; release-signature gate; Part 11 signature |
| 19–21 | Shopify integration | FG availability gated by release-signature; hold propagates to "unlisted" |
| 21–22 | Module IQ/OQ/PQ | Validation packages for MMR, BPR, FG-QC, Shopify |
| 23–24 | Rollout | BPR pilot on one SKU → expansion |

### 6.4 Phase 3 — Release 2 (Days 181–270, beyond the 180-day window)

Scope moved here to keep Release 1 deliverable in 180 days:

- Stability program (not on 483; §111.210(f); see §3.15)
- Environmental monitoring (not on 483; §111.15; see §3.15)
- Training matrix with gate on regulated actions (not on 483; §111.12–111.14; see §3.15)
- CAPA / QMS full module (not on 483; §111.140, §111.553; see §3.15)
- QBO integration (COGS, inventory value, scrap write-off)
- Extensiv two-way sync
- Lab automated COA pickup

### 6.5 Scope cuts and risk calls

- **Cut from Release 1:** Stability, EM, CAPA/QMS full module, training gate, QBO sync, Extensiv automation. These continue on paper/spreadsheet with SOPs in the interim; that is acceptable provided the SOPs in the FDA response (SOP-ST-011, SOP-EM, SOP-CA, SOP-TR-015) are followed.
- **Risk if auth is skipped or deferred:** Everything built on top is not Part 11 compliant and cannot serve as the legal record. Paper remains the legal record by default.
- **Risk if validation is skipped:** FDA can reject the ERP as the system of record on next inspection. GAMP 5 Cat 5 validation is non-optional for custom software in a cGMP environment.
- **Risk if rollout is big-bang:** Production disruption is not acceptable. Mandatory module-by-module rollout with paper-parallel through at least one full batch cycle per module.

### 6.6 Rollout gating rule (recap)

No ERP module becomes the legal record until:
1. Module IQ/OQ/PQ signed by QA.
2. Users performing regulated actions are trained and training is recorded.
3. Paper runs in parallel for at least one full operating cycle (one production batch, one receipt, one reconciliation, etc.).
4. A QA periodic review of the audit trail for that module has been executed and is clean.

Paper before that date remains the legal record. Paper after that date is retained for the retention period (≥2 years past product expiration per §111.605).

---

## 7. Resource & cost notes

This is a build-cost envelope, not a budget line. Refine during Phase 0.

- **Headcount:** Frederik + 1 owner + AI (Claude, Cursor, Copilot). Realistic sustained output ~1.2 FTE. No external contractors assumed in Release 1.
- **Infrastructure:** Railway (Postgres + app), ~$200–$500/mo at production scale. Backup + restore tests included.
- **Tools/licenses:** Sentry for error telemetry, Loom/Notion for validation documentation, GitHub Copilot + Claude for dev velocity. ~$150–$300/mo.
- **External validators:** Budget $15–30k for an independent Part 11 / GAMP 5 review before Release 1 goes live. Strongly recommended; FDA treats self-validated custom software skeptically.
- **Lab integration builds:** $0 if manual upload remains; $5–15k if we build SFTP pickup from Eurofins/Alkemist.
- **Total Release 1 envelope (excluding internal time):** ~$25–50k cash.

---

## 8. What to decide this week

1. Name the QA lead who owns validation sign-off (IQ/OQ/PQ signatures) — can be Frederik for now if QA headcount is not yet hired.
2. Confirm auth approach: session-based (`passport-local` + Postgres-backed sessions) is recommended. JWT is viable if we later need a mobile shop-floor app.
3. Approve the module sequence in §6.2 or re-prioritize. Default sequence follows FDA clock risk.
4. Approve scope cuts in §6.5 or add capacity.
5. Commit to paper-parallel rollout rule in §6.6.

---

**End of gap analysis & roadmap.**
