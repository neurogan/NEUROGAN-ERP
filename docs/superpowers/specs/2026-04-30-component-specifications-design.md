# Component Specifications — Design

**FDA Traceability:** 21 CFR Part 111 §111.70(b), §111.75(a)(1), §111.75(h) — Observation 1

**Goal:** Establish written, versioned, QA-approved specifications for every component (incoming material) used in manufacturing. Each specification defines the identity, purity, strength, and contaminant limits that a component must meet. Lab test results are permanently linked to the spec version they were evaluated against, satisfying Part 11 §11.10(e) traceability.

**Architecture:** Spec header + version table pattern (same as MMR). `componentSpecs` is a permanent per-product anchor; `componentSpecVersions` holds versioned content with QA e-signature approval; `componentSpecAttributes` holds the per-analyte limits. Lab test results gain two nullable FKs linking each result to the exact spec version and attribute it was evaluated against.

**Tech Stack:** Drizzle ORM, Express, React/wouter, existing `performSignature` e-signature infrastructure, existing `electronicSignatures` table.

---

## 1. Database

### New tables

**`erp_component_specs`** — permanent one-row-per-product header.

```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
product_id      VARCHAR NOT NULL REFERENCES erp_products(id)
created_by_user_id UUID NOT NULL REFERENCES erp_users(id)
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
notes           TEXT
UNIQUE(product_id)
```

**`erp_component_spec_versions`** — one row per version per spec.

```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
spec_id         UUID NOT NULL REFERENCES erp_component_specs(id)
version_number  INTEGER NOT NULL
status          TEXT NOT NULL DEFAULT 'DRAFT'   -- DRAFT | APPROVED | SUPERSEDED
signature_id    UUID REFERENCES erp_electronic_signatures(id)  -- populated on approval
created_by_user_id UUID NOT NULL REFERENCES erp_users(id)
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
UNIQUE(spec_id, version_number)
```

Application-layer constraint: at most one `APPROVED` version per spec at any time.

**`erp_component_spec_attributes`** — one row per analyte per version.

```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
spec_version_id UUID NOT NULL REFERENCES erp_component_spec_versions(id)
name            TEXT NOT NULL           -- e.g. "Purity by HPLC"
category        TEXT NOT NULL           -- IDENTITY | ASSAY | HEAVY_METAL | MICROBIAL | PHYSICAL | OTHER
spec_min        TEXT                    -- nullable; stored as text to support "<0.1" style entries
spec_max        TEXT                    -- nullable
units           TEXT                    -- nullable; e.g. "%", "ppm", "CFU/g"
test_method     TEXT                    -- nullable; e.g. "USP <621>", "In-house HPLC-001"
sort_order      INTEGER NOT NULL DEFAULT 0
```

### Modified table

**`erp_lab_test_results`** — two new nullable columns:

```sql
spec_version_id  UUID REFERENCES erp_component_spec_versions(id)
spec_attribute_id UUID REFERENCES erp_component_spec_attributes(id)
```

Existing rows stay `NULL` — fully backward compatible. When a new test result is entered and an active spec exists for the lot's product, the analyst links the result to the matching attribute. `spec_min`/`spec_max` on the result are pre-populated from the attribute and `pass` is auto-computed server-side.

### Migration

Single migration `0023_component_specifications.sql`:
- Create the three new tables in dependency order
- Add the two columns to `erp_lab_test_results`

### Schema types (`shared/schema.ts`)

- `specVersionStatusEnum = z.enum(["DRAFT", "APPROVED", "SUPERSEDED"])`
- `specAttributeCategoryEnum = z.enum(["IDENTITY", "ASSAY", "HEAVY_METAL", "MICROBIAL", "PHYSICAL", "OTHER"])`
- Add `"SPEC_APPROVED"` to `signatureMeaningEnum`
- Add `"SPEC_VERSION_CREATED"`, `"SPEC_APPROVED"`, `"SPEC_VERSION_SUPERSEDED"` to `auditActionEnum`
- Drizzle table definitions + inferred types for all three tables
- Updated `LabTestResult` type with the two new nullable fields

---

## 2. Version lifecycle

```
DRAFT → APPROVED → SUPERSEDED
```

**Create spec:** QA creates a new spec for a product. Spec header is written; v1 DRAFT is created automatically with no attributes. QA adds attribute rows one by one. Draft is fully editable.

**Approve:** QA clicks "Approve version". `performSignature` is called with `meaning: "SPEC_APPROVED"`, `entityType: "component_spec_version"`, `entityId: versionId`. On success (in a transaction):
1. The draft version status → `APPROVED`, `signatureId` populated
2. The previous `APPROVED` version (if any) → `SUPERSEDED`
3. Audit rows written for both transitions

**Revise:** QA clicks "Create new version" on an approved spec. Server copies all attributes from the current `APPROVED` version into a new `DRAFT` at `version_number + 1`. The approved version remains active and linked to all existing test results until the new draft is approved.

**Discard draft:** QA can delete a draft version (and its attributes) as long as it has never been approved. Hard delete — draft versions carry no test result history.

**Guards:**
- At most one `DRAFT` per spec at any time — "Create new version" is disabled if a draft already exists
- Approved and superseded versions are fully locked — no attribute edits, no deletion
- A spec cannot be deleted if any version has ever been approved

---

## 3. Server

### New route file: `server/routes/component-spec-routes.ts`

```
GET    /api/component-specs                          QA, ADMIN — list all specs (one row per product, includes active version summary)
POST   /api/component-specs                          QA, ADMIN — create spec + v1 draft for a product
GET    /api/component-specs/:specId                  QA, ADMIN, LAB_TECH — full spec with all versions and attributes
POST   /api/component-specs/:specId/versions         QA, ADMIN — create new draft from current approved version
DELETE /api/component-specs/:specId/versions/:vId    QA, ADMIN — discard draft version (draft only)
POST   /api/component-specs/:specId/versions/:vId/attributes      QA, ADMIN — add attribute to draft
PATCH  /api/component-specs/:specId/versions/:vId/attributes/:aId QA, ADMIN — edit attribute on draft
DELETE /api/component-specs/:specId/versions/:vId/attributes/:aId QA, ADMIN — delete attribute from draft
POST   /api/component-specs/:specId/versions/:vId/approve         QA, ADMIN — approve draft (calls performSignature)
GET    /api/component-specs/by-product/:productId    all auth — get active spec version + attributes for a product (used by COA/lab result entry)
```

All mutations write audit rows. Approval route uses the existing `performSignature` helper.

### Storage layer (`server/storage.ts` + `server/db-storage.ts`)

New methods:
- `listComponentSpecs()` — joins spec + active version summary; includes all component products (`category != 'FINISHED_GOOD'`) whether or not a spec exists yet, so the UI can show "no spec" rows with a create action
- `getComponentSpec(specId)` — full spec with all versions and their attributes
- `createComponentSpec(productId, userId)` — creates header + v1 draft in one transaction
- `createSpecVersion(specId, userId)` — copies attributes from current approved, creates new draft
- `discardSpecVersion(versionId)` — hard deletes draft + its attributes
- `upsertSpecAttribute(versionId, data)` — add or update an attribute (draft only, guards status)
- `deleteSpecAttribute(attributeId)` — delete attribute from draft (guards status)
- `approveSpecVersion(versionId, signatureId, userId)` — transaction: approve version, supersede previous approved, write audit rows
- `getActiveSpecForProduct(productId)` — returns APPROVED version + attributes, or null

---

## 4. Client

### Navigation

Add `"component-specifications"` to `ACTIVE_TABS` in `client/src/pages/quality/index.tsx`:
```typescript
{ value: "component-specifications", label: "Component Specifications" }
```
Route: `/quality/component-specifications`. Detail: `/quality/component-specifications/:specId`.

### New files

**`client/src/pages/quality/ComponentSpecifications.tsx`** — list view.
- Scoped to component products only: `category !== "FINISHED_GOOD"` (i.e. ACTIVE_INGREDIENT, SUPPORTING_INGREDIENT, PRIMARY_PACKAGING, SECONDARY_PACKAGING). Finished goods are out of scope for Obs 1. The existing `isMaterial` helper in `sku-manager.tsx` encodes this rule; the API endpoint applies the same filter server-side.
- Table: Product name, SKU, Category, Active version (v1 / v2 / …), Status badge (DRAFT amber / APPROVED green / — if no spec), Last approved date
- "Create spec" button per product row that has no spec yet (QA/ADMIN only)
- Click row → navigate to detail page

**`client/src/pages/quality/ComponentSpecDetail.tsx`** — detail / edit view.
- Header: product name, current version badge, action buttons
  - If APPROVED: "Create new version" (disabled if draft exists), version history dropdown
  - If DRAFT: "Approve" button + "Discard draft" button
- Attribute table (current version): Category badge | Name | Min | Max | Units | Test Method | (delete icon on draft rows)
- "Add attribute" button (draft only) — appends editable row inline
- Version history panel: list of all versions with status, approved-by, date

**Approval modal:** Reuses existing `SignatureDialog` component with `meaning="SPEC_APPROVED"` and manifestation text: *"I approve this component specification version as meeting regulatory requirements for 21 CFR Part 111 §111.70(b)."*

### COA / lab test result integration

In the existing COA detail page where test results are entered (`client/src/pages/receiving/` or equivalent): if `GET /api/component-specs/by-product/:productId` returns an active spec, render a read-only "Active spec" panel showing the attributes. When the analyst adds a test result row, a dropdown lets them link it to a spec attribute — `specMin`/`specMax` pre-fill from the attribute, `pass` is computed automatically on the server.

---

## 5. Audit trail (21 CFR Part 11 §11.10(e))

| Action | Trigger |
|---|---|
| `SPEC_VERSION_CREATED` | New spec or new draft version created |
| `SPEC_APPROVED` | Draft approved via e-signature |
| `SPEC_VERSION_SUPERSEDED` | Previous approved version superseded on approval of new version |

---

## 6. Out of scope for this ticket

- **Auto-creation of OOS investigations** on `pass=false` results linked to a spec attribute. The FK is in place; auto-creation is a follow-on integration.
- **In-process and finished goods spec scopes.** The `category` field on attributes handles in-process/finished analytes structurally, but the UI and lifecycle are scoped to incoming component specs only.
- **Sampling plan integration.** Obs 11 (sampling plans) is a separate ticket.

---

## 7. Deployment

Migration `0023` runs automatically via `railway.toml` `releaseCommand`. No environment variable changes required.
