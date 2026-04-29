# Nav Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the top nav from 10 items to 6 tabs by adding Procurement and Operations wrapper pages, moving OOS into Quality, and demoting Transactions to the header.

**Architecture:** Two new thin wrapper pages (Procurement, Operations) render existing page components as subtabs. The wrapper pages provide only the tab-strip UI; child pages manage their own layout and padding. App.tsx is updated last to wire all new routes and redirects.

**Tech Stack:** React, wouter (hash routing), shadcn/ui Tabs

---

### Task 0: Create ProcurementPage wrapper

**Goal:** New page at `/procurement` with Purchasing and Receiving subtabs that renders the existing SuppliersTab and Receiving components.

**Files:**
- Create: `client/src/pages/procurement/index.tsx`

**Acceptance Criteria:**
- [ ] Navigating to `/procurement` redirects to `/procurement/purchasing`
- [ ] Navigating to `/procurement/purchasing` renders the existing SuppliersTab content
- [ ] Navigating to `/procurement/receiving` renders the existing Receiving content
- [ ] Tab strip shows "Purchasing" and "Receiving"; correct tab is highlighted
- [ ] `pnpm typecheck` passes with no new errors

**Verify:** `pnpm typecheck` → exit 0

**Steps:**

- [ ] **Step 1: Create the file**

```tsx
import { useEffect } from "react";
import { useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SuppliersTab from "@/pages/suppliers-tab";
import Receiving from "@/pages/receiving";

type ProcurementTab = "purchasing" | "receiving";

const TABS: { value: ProcurementTab; label: string }[] = [
  { value: "purchasing", label: "Purchasing" },
  { value: "receiving", label: "Receiving" },
];

export default function ProcurementPage() {
  const [location, setLocation] = useLocation();
  const tabParam = location.split("/")[2] as string | undefined;

  const validTabs: ProcurementTab[] = ["purchasing", "receiving"];

  useEffect(() => {
    if (!tabParam || !validTabs.includes(tabParam as ProcurementTab)) {
      setLocation("/procurement/purchasing", { replace: true });
    }
  }, [tabParam, setLocation]);

  const activeTab: ProcurementTab =
    tabParam === "receiving" ? "receiving" : "purchasing";

  return (
    <div>
      <div className="px-6 pt-4 pb-0">
        <Tabs value={activeTab} onValueChange={(v) => setLocation(`/procurement/${v}`)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} data-testid={`tab-procurement-${t.value}`}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {activeTab === "purchasing" && <SuppliersTab />}
      {activeTab === "receiving" && <Receiving />}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/procurement/index.tsx
git commit -m "feat: add ProcurementPage wrapper (Purchasing + Receiving subtabs)"
```

---

### Task 1: Create OperationsPage wrapper

**Goal:** New page at `/operations` with Production and Equipment subtabs that renders the existing Production and EquipmentPage components.

**Files:**
- Create: `client/src/pages/operations/index.tsx`

**Acceptance Criteria:**
- [ ] Navigating to `/operations` redirects to `/operations/production`
- [ ] Navigating to `/operations/production` renders the existing Production content
- [ ] Navigating to `/operations/equipment` renders the existing EquipmentPage content
- [ ] Tab strip shows "Production" and "Equipment"; correct tab is highlighted
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → exit 0

**Steps:**

- [ ] **Step 1: Create the file**

```tsx
import { useEffect } from "react";
import { useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Production from "@/pages/production";
import EquipmentPage from "@/pages/equipment";

type OperationsTab = "production" | "equipment";

const TABS: { value: OperationsTab; label: string }[] = [
  { value: "production", label: "Production" },
  { value: "equipment", label: "Equipment" },
];

export default function OperationsPage() {
  const [location, setLocation] = useLocation();
  const tabParam = location.split("/")[2] as string | undefined;

  const validTabs: OperationsTab[] = ["production", "equipment"];

  useEffect(() => {
    if (!tabParam || !validTabs.includes(tabParam as OperationsTab)) {
      setLocation("/operations/production", { replace: true });
    }
  }, [tabParam, setLocation]);

  const activeTab: OperationsTab =
    tabParam === "equipment" ? "equipment" : "production";

  return (
    <div>
      <div className="px-6 pt-4 pb-0">
        <Tabs value={activeTab} onValueChange={(v) => setLocation(`/operations/${v}`)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} data-testid={`tab-operations-${t.value}`}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {activeTab === "production" && <Production />}
      {activeTab === "equipment" && <EquipmentPage />}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/operations/index.tsx
git commit -m "feat: add OperationsPage wrapper (Production + Equipment subtabs)"
```

---

### Task 2: Fix Equipment internal routing for new path prefix

**Goal:** EquipmentPage and its detail page update all hardcoded `/equipment` paths to `/operations/equipment`.

**Files:**
- Modify: `client/src/pages/equipment/index.tsx:93-136`
- Modify: `client/src/pages/equipment/detail.tsx:76,105`

**Acceptance Criteria:**
- [ ] Clicking Equipment subtabs (Calibration, Cleaning, Line Clearance, Master) navigates to `/operations/equipment/:tab`
- [ ] The "View" button on an equipment row links to `/operations/equipment/:id`
- [ ] The "Back" link on the detail page goes to `/operations/equipment`
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → exit 0

**Steps:**

- [ ] **Step 1: Update EquipmentPage — useRoute and setLocation calls**

In `client/src/pages/equipment/index.tsx`, make these three changes:

Change line 93 — update the route pattern:
```tsx
// Before:
const [, params] = useRoute<{ tab?: string }>("/equipment/:tab");
// After:
const [, params] = useRoute<{ tab?: string }>("/operations/equipment/:tab");
```

Change lines 123–125 in `SubTabNav` — update the setLocation calls:
```tsx
// Before:
onValueChange={(v) => {
  if (v === "master") setLocation("/equipment");
  else setLocation(`/equipment/${v}`);
}}
// After:
onValueChange={(v) => {
  if (v === "master") setLocation("/operations/equipment");
  else setLocation(`/operations/equipment/${v}`);
}}
```

Change line 243 in `MasterTab` — update the View button link:
```tsx
// Before:
<Link href={`/equipment/${e.id}`}>
// After:
<Link href={`/operations/equipment/${e.id}`}>
```

- [ ] **Step 2: Update EquipmentDetailPage — useRoute and back link**

In `client/src/pages/equipment/detail.tsx`, make two changes:

Change the useRoute call (line 76):
```tsx
// Before:
const [, params] = useRoute<{ id: string }>("/equipment/:id");
// After:
const [, params] = useRoute<{ id: string }>("/operations/equipment/:id");
```

Change the back link (line 105):
```tsx
// Before:
<Link href="/equipment">
// After:
<Link href="/operations/equipment">
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/equipment/index.tsx client/src/pages/equipment/detail.tsx
git commit -m "fix: update equipment page paths to /operations/equipment prefix"
```

---

### Task 3: Add OOS subtab to QualityPage

**Goal:** QualityPage gains a 5th subtab "OOS" that renders the existing OosInvestigations component.

**Files:**
- Modify: `client/src/pages/quality/index.tsx`

**Acceptance Criteria:**
- [ ] Quality tab strip shows: Labeling · SOPs · Complaints · Returns · OOS
- [ ] Clicking OOS renders the OosInvestigations page content
- [ ] Navigating to `/quality/oos` activates the OOS tab
- [ ] Other Quality subtabs still work unchanged
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → exit 0

**Steps:**

- [ ] **Step 1: Update quality/index.tsx**

Add the import at the top of the file (after existing imports):
```tsx
import OosInvestigations from "@/pages/OosInvestigations";
```

Update the `QualityTab` type (line 10):
```tsx
// Before:
type QualityTab = "labeling" | "sops" | "complaints" | "returns";
// After:
type QualityTab = "labeling" | "sops" | "complaints" | "returns" | "oos";
```

Update `ACTIVE_TABS` array (after the `returns` entry):
```tsx
const ACTIVE_TABS: { value: QualityTab; label: string }[] = [
  { value: "labeling", label: "Labeling" },
  { value: "sops", label: "SOPs" },
  { value: "complaints", label: "Complaints" },
  { value: "returns", label: "Returns" },
  { value: "oos", label: "OOS" },
];
```

Update `validTabs` array (line 29):
```tsx
// Before:
const validTabs: QualityTab[] = ["labeling", "sops", "complaints", "returns"];
// After:
const validTabs: QualityTab[] = ["labeling", "sops", "complaints", "returns", "oos"];
```

Update `activeTab` derivation (lines 37-41):
```tsx
const activeTab: QualityTab =
  tabParam === "sops" ? "sops"
  : tabParam === "complaints" ? "complaints"
  : tabParam === "returns" ? "returns"
  : tabParam === "oos" ? "oos"
  : "labeling";
```

Add the render condition (after the returns line, line 74):
```tsx
{activeTab === "oos" && <OosInvestigations />}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/quality/index.tsx
git commit -m "feat: add OOS as Quality subtab at /quality/oos"
```

---

### Task 4: Wire App.tsx — new nav, routes, redirects, Transactions header link

**Goal:** App.tsx updated with the new 6-tab navItems, new routes for /procurement and /operations, redirect handlers for all old paths, and Transactions demoted to a header link.

**Files:**
- Modify: `client/src/App.tsx`

**Acceptance Criteria:**
- [ ] Top nav shows exactly: Dashboard · Supply Chain · Inventory · Procurement · Operations · Quality
- [ ] Transactions link appears in the top-right header alongside Audit Trail, visible to ADMIN only
- [ ] `/suppliers` redirects to `/procurement/purchasing`
- [ ] `/receiving` redirects to `/procurement/receiving`
- [ ] `/production` redirects to `/operations/production`
- [ ] `/equipment` and `/equipment/*` redirect to `/operations/equipment` and `/operations/equipment/*`
- [ ] `/oos-investigations` redirects to `/quality/oos`
- [ ] All new routes render their components correctly
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → exit 0

**Steps:**

- [ ] **Step 1: Add new imports**

In the imports section of `client/src/App.tsx`, add after the existing page imports:
```tsx
import ProcurementPage from "@/pages/procurement";
import OperationsPage from "@/pages/operations";
```

- [ ] **Step 2: Replace navItems array**

Replace the existing `navItems` array (lines 45-56):
```tsx
const navItems: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/supply-chain", label: "Supply Chain" },
  { href: "/inventory", label: "Inventory" },
  { href: "/procurement", label: "Procurement" },
  { href: "/operations", label: "Operations" },
  { href: "/quality", label: "Quality", requiredRoles: ["QA", "ADMIN"] },
];
```

- [ ] **Step 3: Add Transactions to header**

In the `TopNav` function, add a `canManageTransactions` variable after `canViewAudit` (line 76):
```tsx
const canManageTransactions = user?.roles?.some((r) => r === "ADMIN") ?? false;
```

Then add the Transactions link in the header `<div className="flex items-center gap-2">` block, directly before the Audit Trail link:
```tsx
{canManageTransactions && (
  <Link href="/transactions">
    <button
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors hover:bg-muted ${
        location.startsWith("/transactions")
          ? "bg-muted text-foreground"
          : "text-muted-foreground"
      }`}
      data-testid="nav-transactions"
    >
      <span>Transactions</span>
    </button>
  </Link>
)}
```

- [ ] **Step 4: Add new routes and redirect handlers to the Switch**

In the `<Switch>` inside `AppLayout`, add the following. Place new routes after the existing `/supply-chain` route and before the Settings routes. Place redirect routes at the end of the Switch, just before the `<Route component={NotFound} />` catch-all.

New routes (add after `<Route path="/supply-chain" component={SupplyChain} />`):
```tsx
<Route path="/procurement" component={ProcurementPage} />
<Route path="/procurement/purchasing" component={ProcurementPage} />
<Route path="/procurement/receiving" component={ProcurementPage} />
<Route path="/operations" component={OperationsPage} />
<Route path="/operations/production" component={OperationsPage} />
<Route path="/operations/equipment" component={OperationsPage} />
<Route path="/operations/equipment/master" component={OperationsPage} />
<Route path="/operations/equipment/calibration" component={OperationsPage} />
<Route path="/operations/equipment/cleaning" component={OperationsPage} />
<Route path="/operations/equipment/line-clearance" component={OperationsPage} />
<Route path="/operations/equipment/:id" component={EquipmentDetailPage} />
<Route path="/quality/oos" component={QualityPage} />
```

Redirect routes (add before `<Route component={NotFound} />`):
```tsx
<Route path="/suppliers"><Redirect to="/procurement/purchasing" /></Route>
<Route path="/receiving"><Redirect to="/procurement/receiving" /></Route>
<Route path="/production"><Redirect to="/operations/production" /></Route>
<Route path="/equipment"><Redirect to="/operations/equipment" /></Route>
<Route path="/equipment/master"><Redirect to="/operations/equipment/master" /></Route>
<Route path="/equipment/calibration"><Redirect to="/operations/equipment/calibration" /></Route>
<Route path="/equipment/cleaning"><Redirect to="/operations/equipment/cleaning" /></Route>
<Route path="/equipment/line-clearance"><Redirect to="/operations/equipment/line-clearance" /></Route>
<Route path="/oos-investigations"><Redirect to="/quality/oos" /></Route>
```

- [ ] **Step 5: Keep the `/production/print/:id` route**

`batch-print.tsx` uses `useRoute("/production/print/:id")` and is accessed directly from BPR flows — it is NOT a nav item and should NOT be redirected. Make sure this route is still present in the Switch:
```tsx
<Route path="/production/print/:id" component={BatchPrint} />
```
This route coexists with the `/production` redirect because wouter matches routes in order: the specific `/production/print/:id` route runs before the catch-all `/production` redirect.

**Note on other internal links:** `dashboard.tsx`, `bpr.tsx`, `supply-chain.tsx`, `coa-library.tsx`, and `bpr/start-modal.tsx` all contain links to old routes (`/production`, `/equipment/:id`, `/suppliers`, `/receiving`). These will work correctly via the redirect handlers — no changes needed in those files. Dashboard cleanup is a separate ticket.

- [ ] **Step 7: Remove now-unused imports**

Remove the imports that are no longer referenced directly in App.tsx routes (they're now used only inside ProcurementPage/OperationsPage):
- Remove `import SuppliersTab from "@/pages/suppliers-tab";`
- Remove `import Production from "@/pages/production";`
- Remove `import Receiving from "@/pages/receiving";`
- Remove `import OosInvestigations from "@/pages/OosInvestigations";`
- Remove `import EquipmentPage from "@/pages/equipment";` (still keep `EquipmentDetailPage`)

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0

If errors, fix them. Most common issue: forgotten import or wrong component name.

- [ ] **Step 8: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0

- [ ] **Step 9: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: nav restructure — 6-tab nav, Procurement/Operations wrappers, Transactions to header"
```
