# iPad-04: BPR Step Execution Interface — Design Spec

**Goal:** Give production floor operators a full-screen, iPad-optimised interface for walking through Batch Production Record steps — recording observations, actual measurements, and deviations — so the paper BPR is fully eliminated and 21 CFR Part 111 §111.260 documentation requirements are satisfied in the ERP.

**Architecture:** One new React component (`BprExecutionSheet`) opened as a full-screen bottom Sheet from the existing `BatchDetail` view. All backend infrastructure already exists — BPR steps are pre-populated from the approved MMR when Start Production is clicked, and `PUT /api/batch-production-records/:id/steps/:stepId` and `POST /api/batch-production-records/:id/deviations` are already implemented. No new migrations or API routes are required.

**Tech Stack:** React + TanStack Query, shadcn/ui Sheet, existing BPR API routes, TypeScript

---

## Regulatory Context

Under 21 CFR Part 111 §111.260, the batch production record must document:
- **§111.260(d):** Actual quantity of each component used per batch
- **§111.260(j):** Name of the person who performed each step and the date performed
- **§111.260(i):** Results of any in-process testing or examination
- **§111.260(h):** Documentation of any deviations

Single-operator execution satisfies §111.260(j) — the regulation requires documenting who performed each step, not a second person. QA sign-off on the completed BPR (already implemented) serves as the verification step. Real-time dual verification is a pharmaceutical (21 CFR 211) requirement, not a dietary supplement (21 CFR 111) requirement.

---

## Data Model (existing — no migration needed)

### `erp_bpr_steps`
Steps are pre-populated from the approved MMR when Start Production is clicked in `receivePOLineItem`. Each step is copied with:
- `stepNumber`, `stepDescription` — from MMR step
- `monitoringResults` — pre-filled as `{ "guidance": "<criticalParams>" }` if the MMR step had critical parameters
- `status` defaults to `"PENDING"`

Fields the execution UI writes:
- `performedBy` — full name from logged-in user
- `performedAt` — timestamp at completion
- `actualWeightMeasure`, `uom` — if operator records a measurement
- `notes` — free-text observations
- `status` — `"COMPLETED"` on completion

### `erp_bpr_deviations`
Linked to a BPR and optionally to a specific step via `bprStepId`. Floor operator fills only `deviationDescription` at execution time. Investigation, impact, corrective/preventive actions, and QA sign-off happen later in the BPR review flow (already implemented).

---

## Component: `BprExecutionSheet`

**File:** `client/src/components/bpr/BprExecutionSheet.tsx`

**Props:**
```ts
interface BprExecutionSheetProps {
  bprId: string;
  batchNumber: string;
  productName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

**Data fetching:** Uses `useQuery` on `/api/batch-production-records/:bprId` (already returns `BprWithDetails` including `steps: BprStep[]`). Step updates use `useMutation` on `PUT /api/batch-production-records/:bprId/steps/:stepId`. Deviation creation uses `useMutation` on `POST /api/batch-production-records/:bprId/deviations`.

---

## Sheet Structure

### Shell
Full-screen bottom Sheet: `side="bottom"` with `className="h-[100dvh] flex flex-col"`. Prevents scroll of the page behind it.

### Header (fixed, no-scroll)
- Left: product name + batch number (small, muted)
- Centre: progress indicator — "4 / 12 steps complete" with a thin progress bar below
- Right: Overview button (opens step list overlay) + X close button

Close button dismisses the sheet without any gate — the operator can leave mid-execution and return. Step state is persisted server-side so nothing is lost.

### Step Navigation (fixed, no-scroll)
Two large arrow buttons — ← Previous / Next → — with the current step number between them ("Step 3 of 12"). Operator can move freely between any steps in any order. No sequential lock.

### Step Content (scrollable)
Each step view contains:

1. **Step header** — step number badge + step description in large readable text (`text-lg font-medium`)

2. **SOP reference** — if `sopCode` is set, shown as `SOP-XXX v1.0` in small muted text below the description

3. **Guidance callout** — if `monitoringResults` contains a `guidance` key (pre-populated from MMR critical parameters), shown as an amber info callout: "Guidance: Mix at 45–50°C for 10 minutes." This is read-only reference text, not an input field.

4. **Notes field** — `<Textarea>` labelled "Observations & measurements". Placeholder: "Record what you did, actual values measured, and any observations." This is the primary data capture field — operators record actual weights, temperatures, times, etc. as free text. Auto-saves on blur via the existing PUT route (sets `notes`, leaves `status` unchanged).

5. **Deviation section** — a muted "Note a deviation" button. Tapping it expands an inline form with a single `<Textarea>` ("Describe the deviation") and a "Save Deviation" button. Saves via `POST /api/batch-production-records/:bprId/deviations` with `bprStepId` set to the current step. Multiple deviations per step are allowed. Existing deviations for the step are listed above the button as small read-only cards.

6. **Complete / Uncomplete** — Large primary button "Mark Step Complete" at the bottom of the scrollable content. On tap: saves `performedBy` (user's full name from auth), `performedAt` (now), `status = "COMPLETED"`, and current notes value. Button changes to a muted "Completed ✓ — Tap to undo" state. Tapping undo sets `status = "PENDING"` and clears `performedBy`/`performedAt` (allows correction without a deviation).

### Footer (fixed, no-scroll)
- Left: "X steps remaining" count (0 when all done)
- Right: "Finish" button — **disabled** while any steps are not `COMPLETED`. When disabled, tooltip lists the incomplete step numbers ("Steps 2, 7, 11 not yet complete"). When all complete, the button is enabled — tapping it calls `onOpenChange(false)` and returns to batch detail.

---

## BatchDetail Integration

**File:** `client/src/pages/production.tsx` — `BatchDetail` component

For batches with `status === "IN_PROGRESS"`, add an **"Execute Steps"** button to the existing action button row. The button fetches the BPR (using the existing `BprLink` query by batch ID) and derives the completion count:

```
Execute Steps (N / M)
```

Where N = completed steps, M = total steps. The button opens `BprExecutionSheet` with `bprId`, `batchNumber`, and `productName` props.

The `BprLink` component (already in the file, currently just a "View BPR" link) is repurposed to provide the BPR ID for the execution sheet. The separate "View BPR" link to `/bpr/:id` remains for QA use — the execution sheet is the operator interface, the BPR detail page is the QA review interface.

---

## Step Overview Overlay

A lightweight overlay (absolutely-positioned panel) triggered by the Overview button in the header. Shows all steps as a scrollable list — each row: step number, first 60 chars of description, status icon (pending / complete / has-deviation). Tapping a row navigates to that step and closes the overlay. Provides quick "where am I" orientation for long batches.

---

## Error Handling

- **Save failure on notes autosave:** Silent retry once; if it fails again, show a small inline error "Could not save — tap to retry." Do not block navigation.
- **Mark Complete failure:** Toast error "Failed to mark step complete." Step remains in previous state.
- **Deviation save failure:** Toast error "Failed to save deviation." Form stays open with content so operator doesn't lose their text.
- **BPR not found:** If `/api/batch-production-records/by-batch/:batchId` returns 404, show an inline error in the BatchDetail — "BPR not available. Contact QA."

---

## What Is Out of Scope

- **Per-step component weighing structured fields** — `componentId`/`targetWeightMeasure` fields on `bprSteps` are not populated from the MMR (the MMR recipe is batch-level, not step-level). Actual measurements go in the `notes` field as free text. Structured weighing per step can be added later if the MMR schema gains per-step ingredient assignments.
- **`verifiedBy` field** — the schema comment "MUST differ from performedBy" reflects a pharmaceutical dual-verification standard not required under 21 CFR Part 111. Leave `verifiedBy` null; QA BPR sign-off serves as the verification step.
- **QA step review** — setting steps to `VERIFIED` status is a QA function, done during BPR sign-off (already implemented), not in this UI.
- **Offline support** — the iPad is expected to have WiFi in the production area.
