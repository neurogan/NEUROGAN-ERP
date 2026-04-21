# NEUROGAN-ERP — Seed & Fixtures Plan

**Purpose:** Define a deterministic starting dataset that developers, CI, OQ, and a visiting auditor can all reproduce. Referenced by ticket **F-09** in `neurogan-erp-build-spec.md`.

**Invariant:** `pnpm seed:test` is idempotent from an empty schema. Running it twice yields the same state. Tests execute inside a transaction-per-test wrapper that rolls back; no test data leaks between runs.

**Location:** `server/seed/test/index.ts` (orchestrator) + `server/seed/test/fixtures/*.ts` (data modules).

---

## 1. Loading order

Seed modules must run in this order because of FK dependencies.

1. `users.ts` — identities first (everything references a user)
2. `roles.ts` — role grants
3. `locations.ts` — bins / zones (including Quarantine)
4. `suppliers.ts` + `supplier_qualifications.ts`
5. `labs.ts` (Phase 1 R-01-02)
6. `approved_materials.ts` (Phase 1 R-01-01)
7. `product_categories.ts`
8. `products.ts`
9. `specifications.ts` (Phase 1 R-01-03)
10. `equipment.ts` + `equipment_qualifications.ts` + `calibration_schedules.ts` (Phase 1 R-03)
11. `lots.ts` (sample QUARANTINED and sample APPROVED)
12. `receiving_records.ts`
13. `coa_documents.ts` (linked to lots + labs)
14. `lab_test_results.ts` (linked to COAs + specs)
15. `recipes.ts` (BOM seed; MMR comes in Phase 2)
16. `complaints.ts` (3 samples: non-AE, AE non-serious, AE serious)
17. `adverse_events.ts` (for the AE complaints)
18. `returns.ts` (1 sample)
19. `label_artwork.ts` (one APPROVED artwork per sample product)

Every row in these modules includes an `id` that is a **stable UUID constant** (defined in `server/seed/ids.ts`), so tests can reference fixtures by name:

```ts
import { seedIds } from "@/seed/ids";
// …
expect(row.userId).toBe(seedIds.users.carrieTreat);
```

---

## 2. Users (seed-users)

| Const key | Email | Full name | Title | Roles | Initial status |
|---|---|---|---|---|---|
| `users.admin` | `admin@neurogan.com` | Admin Seed | Platform Admin | ADMIN | ACTIVE |
| `users.carrieTreat` | `carrie.treat@neurogan.com` | Carrie Treat | QC / PCQI | QA, ADMIN | ACTIVE |
| `users.prod` | `prod@neurogan.com` | Production Lead | Production Lead | PRODUCTION | ACTIVE |
| `users.prod2` | `prod2@neurogan.com` | Production Op 2 | Production Operator | PRODUCTION | ACTIVE |
| `users.recv` | `recv@neurogan.com` | Receiving Clerk | Receiving | RECEIVING | ACTIVE |
| `users.viewer` | `viewer@neurogan.com` | Read-Only Viewer | Viewer | VIEWER | ACTIVE |
| `users.disabled` | `disabled@neurogan.com` | Disabled User | Former Op | PRODUCTION | DISABLED |

Passwords (development only — rotated in any environment accessible externally):

- `users.admin`: `AdminSeed!2026`
- `users.carrieTreat`: `CarrieSeed!2026`
- `users.prod`: `ProdSeed!2026`
- `users.prod2`: `Prod2Seed!2026`
- `users.recv`: `RecvSeed!2026`
- `users.viewer`: `ViewSeed!2026`

`users.disabled` has a hash it cannot know (random) — it should be untouchable even with a password-guess attack.

**Dual-verification coverage:** having `users.prod` + `users.prod2` lets tests verify the `IDENTITY_SAME` rule without hacking session state.

---

## 3. Locations

| Const key | Name | Type | Notes |
|---|---|---|---|
| `locations.quarantine` | "Quarantine Cage 1" | QUARANTINE | Default landing for new lots and returns |
| `locations.bulk` | "Raw Bulk A" | RAW_STORAGE | After QC release |
| `locations.fg` | "FG Staging" | FINISHED_GOODS | Post-release FG |
| `locations.retain` | "Retain Samples" | RETAIN | QC retained-sample shelf |
| `locations.destroy` | "Destroy Bin" | DESTRUCTION_PENDING | Holds REJECTED lots pending disposal |

---

## 4. Suppliers and labs

**Suppliers:**

| Const key | Name | Country | Qualification |
|---|---|---|---|
| `suppliers.primaryUA` | "Primary Urolithin A Supplier" | IN | QUALIFIED |
| `suppliers.primaryNMN` | "Primary NMN Supplier" | CN | QUALIFIED |
| `suppliers.pending` | "Pending Qualification Supplier" | US | PENDING |
| `suppliers.disqualified` | "Disqualified Supplier" | US | DISQUALIFIED |

**Labs:**

| Const key | Name | Status | Reason / notes |
|---|---|---|---|
| `labs.eurofins` | "Eurofins Scientific" | ACCREDITED | ISO/IEC 17025 |
| `labs.alkemist` | "Alkemist Labs" | ACCREDITED | ISO/IEC 17025 |
| `labs.symbio` | "Symbio Labs" | DISQUALIFIED | Cited in 483 Obs 6 — "Confirm by Input" not scientifically valid |
| `labs.pending` | "Pending Lab" | PENDING | — |

---

## 5. Approved materials (R-01-01 fixtures)

| Const key | Item | Supplier | CFR citation | Expires |
|---|---|---|---|---|
| `approvedMaterials.ldpeLiner` | "LDPE food-grade liner 55-gal" | `suppliers.primaryUA` | 21 CFR 177.1520 | +2y |
| `approvedMaterials.vinylGloves` | "Food-grade vinyl gloves M" | `suppliers.primaryNMN` | 21 CFR 177.1950 | +1y |
| `approvedMaterials.stainlessScoop` | "304SS scoop, 8 oz" | `suppliers.primaryUA` | 21 CFR 175 (general) | +5y |

One **non-approved** item (`"Contractor trash bag 55-gal"`) is intentionally *absent* so a test can attempt a PO and assert `NOT_ON_APPROVED_REGISTRY`.

---

## 6. Products

| Const key | SKU | Name | Category | Quarantine default |
|---|---|---|---|---|
| `products.urolithinRaw` | `RM-UA-001` | "Urolithin A — Raw" | COMPONENT | QUARANTINED |
| `products.nmnRaw` | `RM-NMN-001` | "NMN — Raw" | COMPONENT | QUARANTINED |
| `products.gelcaps` | `PKG-GC-001` | "Gelatin capsules size 00" | PACKAGING | QUARANTINED |
| `products.proUroFinished` | `FG-UA-1000` | "Pro+ Urolithin A 1000 mg — 30 ct" | FINISHED | APPROVED (FG only approved after QC pass; seed state is post-QC) |
| `products.nmnFinished` | `FG-NMN-900` | "NMN 900 mg — 60 ct" | FINISHED | APPROVED |

---

## 7. Specifications (R-01-03 fixtures)

| Const key | Target | Version | Attribute | Method | Min | Max | Unit |
|---|---|---|---|---|---|---|---|
| `specs.urolithinIdentity_v1` | `products.urolithinRaw` | v1 APPROVED | Identity | HPLC (USP method) | — | — | pass/fail |
| `specs.urolithinPurity_v1` | `products.urolithinRaw` | v1 APPROVED | Purity | HPLC | 98.0 | — | % |
| `specs.urolithinHeavy_v1` | `products.urolithinRaw` | v1 APPROVED | Lead | ICP-MS | — | 0.5 | µg/g |
| `specs.nmnIdentity_v1` | `products.nmnRaw` | v1 APPROVED | Identity | HPLC | — | — | pass/fail |
| `specs.nmnPurity_v1` | `products.nmnRaw` | v1 APPROVED | Purity | HPLC | 99.0 | — | % |

Each `APPROVED` spec has a matching `electronic_signatures` row with meaning `SPEC_APPROVAL` signed by `users.carrieTreat` on the seed date.

---

## 8. Equipment and calibration (R-03 fixtures)

| Const key | Asset tag | Name | IQ/OQ/PQ status | Calibration due |
|---|---|---|---|---|
| `equipment.blender1` | `EQ-BL-001` | "V-Blender 5 cu ft" | QUALIFIED | +60d (current) |
| `equipment.encapsulator1` | `EQ-EC-001` | "Encapsulator 100k/hr" | QUALIFIED | **-5d (overdue — intentional for tests)** |
| `equipment.hplc1` | `EQ-HPLC-001` | "HPLC #1" | QUALIFIED | +30d |
| `equipment.scale1` | `EQ-SC-001` | "Balance 5 kg x 0.1 g" | QUALIFIED | +15d |

The intentionally-overdue encapsulator exists so the `CALIBRATION_OVERDUE` test case has real data to hit.

---

## 9. Lots and receiving (R-01 fixtures)

| Const key | Product | Status | Notes |
|---|---|---|---|
| `lots.uaQuarantined` | `products.urolithinRaw` | QUARANTINED | Fresh receipt; sampling plan not yet generated |
| `lots.uaSampling` | `products.urolithinRaw` | SAMPLING | Sampling plan generated; pulls in progress |
| `lots.uaPendingQC` | `products.urolithinRaw` | PENDING_QC | COA attached and QC-reviewable |
| `lots.uaApproved` | `products.urolithinRaw` | APPROVED | All COAs accepted, disposition signed. Locked. |
| `lots.uaRejected` | `products.urolithinRaw` | REJECTED | Heavy metals OOS; signed rejection. Locked. |
| `lots.nmnPendingQC` | `products.nmnRaw` | PENDING_QC | COA from disqualified lab (Symbio) — intentional for R-01-02 test |
| `lots.fgProUro` | `products.proUroFinished` | APPROVED | Finished goods — links into complaints seed |
| `lots.fgNmn` | `products.nmnFinished` | APPROVED | Finished goods — link into Shopify traceback test |

Every lot has a matching `receiving_records` row.

---

## 10. COAs and lab results (R-02 fixtures)

- `coas.uaApproved_identity` — on `lots.uaApproved` from `labs.eurofins`; `lab_test_results` rows show PASS against `specs.urolithinIdentity_v1`.
- `coas.uaApproved_purity` — PASS against purity spec.
- `coas.uaApproved_lead` — PASS.
- `coas.uaRejected_lead` — FAIL (lead = 1.2 µg/g) — this is why `lots.uaRejected` is REJECTED.
- `coas.nmnDisqualified` — on `lots.nmnPendingQC` from `labs.symbio` — acceptance attempt hits `DISQUALIFIED_LAB`.

---

## 11. Complaints and adverse events (R-05 fixtures)

| Const key | Kind | Source | Lot | Status | Notes |
|---|---|---|---|---|---|
| `complaints.nonAE` | Non-AE (labeling) | GORGIAS | `lots.fgProUro` | UNDER_REVIEW | "Wrong expiry printed" |
| `complaints.aeNonSerious` | AE, non-serious | GORGIAS | `lots.fgNmn` | UNDER_REVIEW | "Upset stomach, resolved in a day" |
| `complaints.aeSerious` | AE, serious | GORGIAS | `lots.fgProUro` | UNDER_REVIEW | "Emergency room visit reported" — starts SAER clock in the seed's `occurredAt` so one test covers "imminent deadline" |
| `complaints.aeSeriousClosed` | AE, serious, closed | MANUAL | `lots.fgNmn` | CLOSED | Has a signed SAER submission to exercise the happy path |

`adverse_events` rows exist for the three AE complaints; `saer_submissions` exists only for `complaints.aeSeriousClosed`.

---

## 12. Returns (R-06 fixtures)

| Const key | Lot | Condition | Status |
|---|---|---|---|
| `returns.damagedShipping` | `lots.fgProUro` | "Bottle damaged in transit" | INTAKE (no disposition) |
| `returns.salvageCandidate` | `lots.fgNmn` | "Customer refused delivery, unopened" | TRIAGE |
| `returns.destroyed` | `lots.fgProUro` | "Opened, partial use" | DISPOSITIONED (decision: DESTROY, signed) |

---

## 13. Label artwork (R-04 fixtures)

One APPROVED artwork per finished SKU (`products.proUroFinished`, `products.nmnFinished`). Each has a matching `electronic_signatures` row with meaning `APPROVED` signed by `users.carrieTreat`.

One DRAFT artwork (`artwork.proUroDraft_v2`) exists to exercise the "cannot issue from unapproved artwork" test.

---

## 14. Transactions the seed does NOT make

Seed data is **static** — it does not run any state transitions. That's the point: tests start from a known-state.

Things that are intentionally *not* seeded and must be created within the test:

- New signatures (every test that signs writes its own signature rows)
- New audit rows (driven by the test's actions)
- New BPRs (Phase 2)
- New label issuance rows
- New sampling plans (generated by the test calling the generator)

---

## 15. Test wrapper

```ts
// server/__tests__/helpers/tx.ts
import { db } from "@/db";
import { seedOnce } from "@/seed/test";

let seeded = false;

beforeAll(async () => {
  if (!seeded) {
    await seedOnce();            // idempotent
    seeded = true;
  }
});

// Each test runs inside an explicit transaction that always rolls back.
export function withRollback<T>(fn: (tx: DrizzleTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    try { return await fn(tx); }
    finally { throw new RollbackAtEnd(); }
  }).catch(e => { if (e instanceof RollbackAtEnd) return undefined as T; throw e; });
}
```

Integration tests use `withRollback` so no test mutates seed state permanently.

---

## 16. Maintaining the seed

- A PR that changes a seed ID's *meaning* (e.g., flips `labs.symbio` from DISQUALIFIED to ACCREDITED) is a material change and requires QA review.
- A PR that adds a new fixture also adds at least one test that references it; otherwise the fixture is dead weight.
- Seed passwords are rotated if the seed dataset ever runs against an externally-accessible environment. In CI and local-dev, the published values are acceptable.
- An annual review confirms seed data still reflects current regulatory expectations (e.g., if Symbio returns to accreditation, update this doc and the seed).

---

**End of seed & fixtures plan.**
