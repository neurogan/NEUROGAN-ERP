# NEUROGAN ERP — Post-Form 483 Roadmap

> Living document. Updated as new items are added or priorities change.
> Last updated: 2026-05-04

---

## Status snapshot

All 13 Form 483 observations closed. Full compliance stack live on `main` as of 2026-05-04.

---

## 1. Validation package replacement

**What:** The existing signed validation documents contain specific person names in the document body and do not cover the full current system (R2 modules missing). Since operations have not yet started and staff has changed significantly, we replace them outright rather than layering amendments on top.

**Approach:** A single migration that UPDATEs the existing validation document rows in place — new content, status reset to `DRAFT`, signature_id cleared. The old orphaned signature records remain in `erp_electronic_signatures` as audit trail entries but are no longer linked to anything. No parallel document sets, no SUPERSEDED status needed.

**Document authoring rules:**
- Reference *roles only* in document body: "Head of Quality Control", "System Administrator", "Site Director" — never specific person names, not even Frederik's
- The electronic signature certificate records the individual at signing time (21 CFR Part 11 §11.50) — that's a separate layer and is correct by design
- Content must cover the full current system: all modules F-00 through R2 (CAPA, Training, Stability, EM)

**Dev work:** One migration — UPDATE all existing validation document rows with new role-based content covering the complete current system; reset status to DRAFT; clear signature_id.

**QC work (Head of QC):** Sign the reset DRAFT documents in Settings → Validation after migration runs.

**Prerequisite (operational):** New Head of QC must be added as a user first (Settings → Users → Invite, QA or ADMIN role). Frederik does this before handing off for signing.

**Priority:** High.

---

## 2. Integrations (each its own ticket per policy)

Policy: every integration is a separate ticket. No bundling into compliance work.

**The bigger picture:** Shopify and Amazon integrations are not just data syncs — they are the mechanism for moving sales orders off Extensiv and onto the ERP. Once these are live, the ERP becomes the system of record for inventory and sales orders, and Extensiv is retired for that function. QuickBooks handles the financial layer alongside. This is a significant operational shift, not just a nice-to-have.

| Integration | Scope | Notes | Priority |
|-------------|-------|-------|----------|
| **Shopify** | Multi-store custom app — pull sales orders into ERP, auto-decrement FG inventory on fulfillment | Largest integration; needs OAuth + webhook; replaces Extensiv for sales order management | High |
| **Amazon** | Same pattern as Shopify — sales orders into ERP, inventory auto-transactions | Can reuse Shopify connector patterns | High |
| **QuickBooks** | PO blocks, COGS posting, scrap write-off | Financial layer alongside ERP inventory | Medium |
| **HelpCore** | Webhook → auto-create complaint on keyword trigger | Replaces Gorgias (system discontinued) | Medium |
| **Lab COA pickup** | SFTP/API automated COA ingest | Lowest priority | Low |

**Extensiv:** Being retired once Shopify + Amazon integrations are live and the ERP is handling sales orders and inventory directly. No sync ticket needed — it's a replacement, not a coexistence.

---

## 3. Operational (no dev required)

- **Extensiv decision:** See section 2.
- **SOPs review:** Periodic QA review of audit trail and SOP workflow — no dev work, just process.

---

## 4. Inventory opening balances (data seeding)

**What:** One-time bulk load of all components, finished goods, and current inventory quantities once the physical count is complete.

**Approach: database migration script — not a UI import feature.**
- Building a CSV import properly for a GMP system (validation, audit trail, rollback) is a real ticket and solves a problem that only exists once — all future component intake goes through the receiving workflow, all future FG lots through production
- Operations haven't started, so there is no prior audit trail to reconcile against — this is opening balances, not a mid-stream adjustment

**What the seeding covers:**
1. Component SKUs in SKU Manager (any not already created)
2. FG SKUs in SKU Manager (any not already created)
3. Lot records with correct quarantine status for each item
4. Opening balance inventory transactions (one per lot to establish quantity)

**Process:**
1. Frederik prepares spreadsheet from physical count (component name, lot #, quantity, unit, location)
2. We convert to a reviewed migration script
3. Frederik reviews the script against the count sheet
4. Run on prod

**Prerequisite:** Physical inventory count must be complete.

**Future note:** If annual physical counts or cycle counts become part of operations, a proper "Physical Inventory Adjustment" module with approval workflow is worth building as a separate ticket.

---

## 5. In-app guided tour (Help feature)

**What:** A "?" help button in the top navbar. When clicked, it starts an interactive step-by-step walkthrough of the page the user is currently on. Each step spotlights a key UI element, shows a concise popover explaining it, with Next/Previous navigation. Standard SaaS onboarding pattern.

**Library:** Driver.js — lightweight, framework-agnostic, clean spotlight effect, no heavy dependencies.

**Architecture:**
- One tour definition file per page/tab (e.g. `client/src/tours/receiving.ts`, `client/src/tours/quality/capa.ts`)
- Each file exports an array of Driver.js step objects: `{ element: '#selector', popover: { title, description } }`
- `HelpButton` component in the top navbar reads the current route and starts the matching tour
- Falls back gracefully if no tour is defined for the current page

**Scope:** Every page in the system needs tour content written. Pages/tabs to cover:
- Inventory (Materials tab, Transactions tab)
- Receiving (list + detail workflow)
- Production (batch list, start batch, complete batch)
- Finished Goods
- Operations: MMR, BPR
- Quality: Labeling, SOPs, Complaints, Returns, OOS, Component Specs, FG Specs, Retained Samples, CAPA, Training, Stability, Environmental Monitoring
- Equipment: list, cleaning, line clearance
- Lab
- Settings: Users, Validation docs

**Content authoring:** Tour step descriptions must be concise (2–3 sentences max per step), role-agnostic (no person names), and workflow-focused ("Click here to submit a QC review and release the lot to inventory" not "This is the submit button").

**Size estimate:** Medium-large ticket. Architecture is ~1 day; content writing for ~20 page contexts is the bulk of the work.

**Priority:** Medium — quality-of-life for onboarding new staff (including new Head of QC).

---

## 6. Open questions (to resolve with Head of QC)

- **Sampling method:** Confirm whether ANSI/ASQ Z1.4, AQL 2.5, Level II Normal is the correct method for Neurogan's materials. Current system auto-calculates this but it may need adjustment.
- **Sampling record (§111.310):** FDA requires documenting who collected the sample, when, how much, and from which lot. The ERP currently captures the plan and the outcome but not the physical collection event. Decision needed: record it in the ERP (small addition to receiving workflow) or maintain a paper/lab log. Either is compliant as long as the record exists and is retrievable.

---

## 7. Additional ideas (TBD)

> Add items here as discussed.

---

## 7. Backlog / deferred

### Dashboard widget customization

The dashboard currently has 13 cards covering every functional area — production, purchasing, supply chain, QC, complaints, returns, equipment. Too much for any single role to use effectively.

**Options:**
- **Role-based defaults** — warehouse sees inventory/production cards; QA sees QC/compliance cards; admin sees everything. Zero config for the user, automatic on login.
- **User-configurable** — each user can toggle cards on/off and reorder. More flexible but more UI work (needs a persistence layer per user preference).
- **Hybrid** — role-based defaults with user override.

**Recommendation when ready to tackle:** Role-based defaults first (no persistence layer needed, high value immediately), then optionally add user override. No drag-and-drop needed to get 80% of the value.

**Blocker:** None technical — needs a decision on which cards belong to which roles before building.

---

### Quality tab reorganization

The Quality tab currently has 12 sub-tabs in a single scrolling row: Labeling, SOPs, Complaints, Returns, OOS, Component Specs, FG Specs, Retained Samples, CAPA, Training, Stability, Environmental Monitoring. Clearly overcrowded.

**Likely groupings (to be confirmed with Head of QC):**
- **Specifications:** Component Specs, FG Specs
- **Investigations:** OOS, Complaints, Returns, CAPA
- **Programs:** Stability, Environmental Monitoring, Training
- **Documents:** Labeling, SOPs, Retained Samples

A two-level nav (category → sub-item) or a grouped sidebar would clean this up significantly.

**Blocker:** Head of QC needs to review the actual workflow in each tab before we reorganize — the groupings should match how QA actually thinks about the work, not just how the features were built. Revisit once Head of QC is onboarded and using the system.

---

### Other deferred
- Records retention auto-archival job
- `docs/whats-built.md` update to reflect current system state
- User-facing release notes / changelog

---

## Ticket sequencing

Suggested order:
1. Validation package replacement (single migration + Head of QC signs; prerequisite: Head of QC added as user)
2. Guided tour / help feature (onboarding new Head of QC and other new hires)
3. Inventory opening balances (waiting on physical count — run migration once count is complete)
4. Shopify + Amazon (future ticket — moves sales orders off Extensiv onto ERP; both can be scoped together since they share the same connector pattern)
5. QuickBooks (financial layer alongside ERP inventory)
6. HelpCore webhook
7. Lab COA pickup
8. UI: dashboard role-based cards + Quality tab reorganization (after Head of QC is familiar with the system)
→ Extensiv retired once Shopify + Amazon are live
