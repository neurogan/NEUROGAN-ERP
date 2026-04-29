# Nav Restructure Design

**Goal:** Reduce the top navigation from 10 items to 6 tabs by consolidating related modules, making the platform usable for staff with varied roles.

**Motivation:** Post-R06 the nav bar has 10 top-level items. Staff must scan the full bar to find their work. Consolidating by workflow domain (procurement, operations, quality) reduces cognitive load and leaves room for Phase 2 additions without the nav becoming unmanageable.

---

## New Navigation Structure

### Top nav (6 tabs)

| Position | Tab | Subtabs | Change from current |
|---|---|---|---|
| 1 | Dashboard | — | No change |
| 2 | Supply Chain | — | Moved from position 3 to 2 |
| 3 | Inventory | — | No change |
| 4 | Procurement | Purchasing · Receiving | New — merges Suppliers tab + Receiving tab |
| 5 | Operations | Production · Equipment | New — merges Production tab + Equipment tab |
| 6 | Quality | Labeling · SOPs · Complaints · Returns · OOS | OOS moved in from top nav |

### Header bar (top-right, alongside Audit Trail and Settings)

Transactions is demoted from the main nav to a small text link in the top-right header bar, same visual style and weight as the existing Audit Trail link. It remains accessible but no longer competes with primary workflow tabs.

Only ADMIN role sees Transactions (same restriction as today — Transactions is an internal reconciliation tool).

---

## Route Changes

| Old route | New route |
|---|---|
| `/suppliers` | `/procurement/purchasing` (default subtab) |
| `/receiving` | `/procurement/receiving` |
| `/production` | `/operations/production` |
| `/equipment` | `/operations/equipment` (default subtab: master) |
| `/equipment/master` | `/operations/equipment/master` |
| `/equipment/calibration` | `/operations/equipment/calibration` |
| `/equipment/cleaning` | `/operations/equipment/cleaning` |
| `/equipment/line-clearance` | `/operations/equipment/line-clearance` |
| `/equipment/:id` | `/operations/equipment/:id` |
| `/oos-investigations` | `/quality/oos` |
| `/transactions` | `/transactions` (unchanged — just removed from main nav) |

Old routes (`/suppliers`, `/receiving`, `/production`, `/equipment/*`, `/oos-investigations`) must have redirect handlers in the router so no existing internal links or bookmarks 404.

---

## New Components

### `client/src/pages/procurement/index.tsx`

A tab wrapper page, modelled after `quality/index.tsx`.

- Subtabs: **Purchase Orders**, **Suppliers**, **Receiving**
- Default: `/procurement/purchase-orders`
- Tab routing: extract subtab from `useLocation().split("/")[2]`
- Renders existing `SuppliersTab` (which already contains the PO + Suppliers view) for the first two subtabs, and the existing `Receiving` page component for the Receiving subtab
- `SuppliersTab` renders the full PO + Suppliers two-tab view as-is; the Procurement wrapper just adds Receiving alongside it

**Note:** `SuppliersTab` already has its own internal Purchase Orders / Suppliers tab strip. Inside the Procurement wrapper, the Purchase Orders and Suppliers top-level subtabs both render `SuppliersTab` — the inner tab strip handles which view is shown. This means the Procurement page's "Purchase Orders" and "Suppliers" tabs are essentially aliases that activate `SuppliersTab` and let it handle internal state.

**Simpler alternative:** Procurement has just two subtabs — **Purchasing** (renders `SuppliersTab` which already has PO + Suppliers tabs inside) and **Receiving**. This avoids the outer/inner tab duplication. Preferred approach.

Final subtabs: **Purchasing** · **Receiving**

### `client/src/pages/operations/index.tsx`

A tab wrapper page.

- Subtabs: **Production**, **Equipment**
- Default: `/operations/production`
- Tab routing: extract subtab from `useLocation().split("/")[2]`
- Renders existing `Production` component for Production subtab
- Renders existing `EquipmentPage` component for Equipment subtab

Equipment's internal subtab routing currently matches `/equipment/:tab`. This must be updated to match `/operations/equipment/:tab`. The Equipment component reads its active tab from the URL — update the path extraction logic to use `location.split("/")[3]` (segment index 3 for `/operations/equipment/:tab`).

---

## Changes to Existing Files

### `client/src/App.tsx`

**`navItems` array** — replace current 10-item list:
```
Dashboard | Supply Chain | Inventory | Procurement | Operations | Quality
```
Remove: Suppliers, Receiving, Production, Equipment, Transactions, OOS from navItems.

**Header bar** — add Transactions link in the top-right alongside Audit Trail. Same style as the Audit Trail button (`text-xs`, `rounded-md px-2.5 py-1.5`). Visible to ADMIN role only.

**Router `<Switch>`** — add new routes:
- `/procurement` → `ProcurementPage`
- `/procurement/purchasing` → `ProcurementPage`
- `/procurement/receiving` → `ProcurementPage`
- `/operations` → `OperationsPage`
- `/operations/production` → `OperationsPage`
- `/operations/equipment` → `OperationsPage`
- `/operations/equipment/master` → `OperationsPage`
- `/operations/equipment/calibration` → `OperationsPage`
- `/operations/equipment/cleaning` → `OperationsPage`
- `/operations/equipment/line-clearance` → `OperationsPage`
- `/operations/equipment/:id` → `EquipmentDetailPage`
- `/quality/oos` → `QualityPage`

Add redirect routes for old paths:
- `/suppliers` → `/procurement/purchasing`
- `/receiving` → `/procurement/receiving`
- `/production` → `/operations/production`
- `/equipment` → `/operations/equipment`
- `/equipment/master` → `/operations/equipment/master`
- `/equipment/calibration` → `/operations/equipment/calibration`
- `/equipment/cleaning` → `/operations/equipment/cleaning`
- `/equipment/line-clearance` → `/operations/equipment/line-clearance`
- `/oos-investigations` → `/quality/oos`

### `client/src/pages/quality/index.tsx`

Add OOS as a 5th subtab:
- `ACTIVE_TABS`: add `{ value: "oos", label: "OOS" }`
- `validTabs`: add `"oos"`
- `activeTab` derivation: add `oos` case
- Render: `{activeTab === "oos" && <OosInvestigations />}`
- Import `OosInvestigations` from `@/pages/OosInvestigations`

### `client/src/pages/equipment/index.tsx`

Update internal tab routing. Equipment uses `useRoute("/equipment/:tab")` — change the path to `useRoute("/operations/equipment/:tab")`. No segment-index change needed since wouter's `:tab` param works at any depth as long as the prefix matches.

Update `setLocation` calls from `/equipment/${v}` to `/operations/equipment/${v}`.

### `client/src/pages/OosInvestigations.tsx`

Check for any internal navigation calls (`navigate("/oos-investigations")` or similar hardcoded paths) and update to `/quality/oos`. The "Back" button (if any) should navigate to `/quality/oos`.

### `client/src/pages/equipment/detail.tsx`

Check for internal navigation to `/equipment/...` paths and update to `/operations/equipment/...`.

---

## Nav Active State

The `TopNav` `isActive` check uses `location.startsWith(item.href)`. New items:
- Procurement: `href="/procurement"` — active for all `/procurement/*` paths ✓
- Operations: `href="/operations"` — active for all `/operations/*` paths ✓
- Quality: already `href="/quality"` — now also active for `/quality/oos` ✓

---

## What Does NOT Change

- All page component logic, API calls, and data models — untouched
- Quality subtab components (Labeling, SOPs, Complaints, Returns) — untouched
- Equipment sub-pages (detail view, calibration forms, etc.) — logic untouched, only path prefix changes
- Settings, Audit Trail, Profile, Login, BPR, COA Library routes — untouched
- Role-based visibility: OOS tab inside Quality inherits Quality's `requiredRoles: ["QA", "ADMIN"]`

---

## Phase 2 Compatibility

- **MMR** (R-07): Becomes a third subtab under Operations — `Production · Equipment · MMR`
- **CAPA/QMS**: Introduced as a new top-level tab when the module is ready
- **Stability / Environmental Monitoring**: Subtabs added to Quality
- **Finished-Goods QC**: Subtab added to Quality
