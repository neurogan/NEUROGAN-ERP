# iPad-01: Responsive/Touch Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NEUROGAN-ERP comfortable on iPad A16 (Safari portrait at 820px) by adding a `tablet` Tailwind breakpoint and applying touch-friendly sizing and iOS zoom fixes to global UI components.

**Architecture:** Three global component changes + one page layout fix, all gated behind a new `tablet: '820px'` breakpoint so desktop (1280px+) appearance is completely unchanged. iOS zoom is fixed by restoring ≥16px font size at the tablet breakpoint; touch targets are fixed by setting `min-height: 44px` at the tablet breakpoint.

**Tech Stack:** Tailwind CSS (custom breakpoints via `theme.extend.screens`), React + TypeScript, Radix UI (Button, Select), tailwind-merge (via `cn()`)

---

### Task 1: Add tablet breakpoint

**Goal:** Add `tablet: '820px'` to `tailwind.config.ts` so the `tablet:` responsive prefix works in all subsequent tasks.

**Files:**
- Modify: `tailwind.config.ts`

**Acceptance Criteria:**
- [ ] `theme.extend.screens` has `tablet: '820px'`
- [ ] `npm run build` exits 0

**Verify:** `npm run build` → exits 0 with no Tailwind errors

**Steps:**

- [ ] **Step 1: Add screens to theme.extend**

In `tailwind.config.ts`, the `theme.extend` block starts with `borderRadius`. Add a `screens` key before it:

```ts
theme: {
  extend: {
    screens: {
      tablet: '820px',
    },
    borderRadius: {
      // existing content unchanged
```

The full `theme.extend` opening after the change:

```ts
  theme: {
    extend: {
      screens: {
        tablet: '820px',
      },
      borderRadius: {
        lg: ".5625rem", /* 9px */
        md: ".375rem", /* 6px */
        sm: ".1875rem", /* 3px */
      },
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: exits 0. No "Unknown screen" or Tailwind errors in output.

- [ ] **Step 3: Commit**

```bash
git add tailwind.config.ts
git commit -m "feat(ipad-01): add tablet:820px breakpoint to tailwind config"
```

---

### Task 2: Fix iOS zoom and touch targets on global UI components

**Goal:** Prevent Safari iOS auto-zoom on inputs/selects and ensure all interactive elements meet Apple HIG 44px touch target at the tablet breakpoint.

**Context for implementer:**
- `input.tsx` has `text-base` at mobile but `md:text-sm` (768px+) shrinks it to 14px. iPad portrait is 820px, so `md:text-sm` fires → font below 16px → Safari zooms. Fix: add `tablet:text-base` to override back to 16px.
- `select.tsx` SelectTrigger has `text-sm` (14px) everywhere → always zooms on iPad. Fix: `tablet:text-base`.
- `button.tsx` uses `min-h-*` for heights. `sm` is `min-h-8` (32px), `default` is `min-h-9` (36px) — both below Apple HIG 44px. Fix: `tablet:min-h-11` on all size variants.
- `min-height` and `height` are separate CSS properties. When a page passes `className="h-8 ..."` and the component base has `tablet:min-h-11`, both apply at 820px: `height:32px; min-height:44px` → element renders at 44px. tailwind-merge does NOT strip `min-h-*` when it sees `h-*`.
- The `tablet:` prefix requires Task 1 to be merged first.

**Files:**
- Modify: `client/src/components/ui/button.tsx`
- Modify: `client/src/components/ui/input.tsx`
- Modify: `client/src/components/ui/select.tsx`

**Acceptance Criteria:**
- [ ] All `Button` size variants have `tablet:min-h-11`
- [ ] `Input` base className has `tablet:text-base tablet:min-h-11`
- [ ] `SelectTrigger` base className has `tablet:text-base tablet:min-h-11`
- [ ] Desktop (no tablet breakpoint) appearance is unchanged

**Verify:** `npm run build` → exits 0; open app in DevTools at 820px viewport, inspect any `<Input>` — computed font-size is 16px

**Steps:**

- [ ] **Step 1: Fix button.tsx size variants**

Locate the `size` variants object in `client/src/components/ui/button.tsx` (around line 28). Replace:

```ts
      size: {
        default: "min-h-9 px-4 py-2",
        sm: "min-h-8 rounded-md px-3 text-xs",
        lg: "min-h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
```

With:

```ts
      size: {
        default: "min-h-9 tablet:min-h-11 px-4 py-2",
        sm: "min-h-8 tablet:min-h-11 rounded-md px-3 text-xs",
        lg: "min-h-10 tablet:min-h-11 rounded-md px-8",
        icon: "h-9 w-9 tablet:h-11 tablet:w-11",
      },
```

- [ ] **Step 2: Fix input.tsx**

In `client/src/components/ui/input.tsx`, the `cn(...)` string ends with `... disabled:opacity-50 md:text-sm`. Append `tablet:text-base tablet:min-h-11`:

```ts
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm tablet:text-base tablet:min-h-11",
          className
        )}
```

- [ ] **Step 3: Fix select.tsx SelectTrigger**

In `client/src/components/ui/select.tsx`, the `SelectTrigger` `cn(...)` base string (line 22) ends with `[&>span]:line-clamp-1`. Append `tablet:text-base tablet:min-h-11`:

```ts
    className={cn(
      "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm tablet:text-base ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 tablet:min-h-11",
      className
    )}
```

- [ ] **Step 4: Build and spot-check**

Run: `npm run build`
Expected: exits 0.

Open `npm run dev`, open browser DevTools, set viewport to 820px width. Navigate to Transactions. Inspect the "Log Transaction" button → computed height should be 44px. Inspect a filter `<Select>` trigger → computed height 44px, font-size 16px. Inspect a filter `<Input>` → font-size 16px.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ui/button.tsx client/src/components/ui/input.tsx client/src/components/ui/select.tsx
git commit -m "feat(ipad-01): 44px touch targets and 16px font on inputs/buttons at tablet breakpoint"
```

---

### Task 3: Fix Audit Trail header button overflow

**Goal:** Prevent the Refresh and Export buttons in the Audit Trail header from overflowing or being cut off on iPad portrait.

**Context for implementer:**
The Audit Trail page header has a title on the left and a `<div className="flex items-center gap-2">` on the right containing Refresh and Export buttons. On iPad portrait (820px), if the title area and button area together exceed the container width, the buttons clip. Adding `flex-wrap` lets the button group reflow to a second line instead of overflowing.

**Files:**
- Modify: `client/src/pages/audit.tsx`

**Acceptance Criteria:**
- [ ] Header button group div has `flex-wrap` class
- [ ] At 820px viewport, both Refresh and Export buttons are fully visible
- [ ] At 1280px viewport, buttons remain on a single row

**Verify:** `npm run dev` → open Audit Trail in DevTools at 820px → buttons visible, no horizontal overflow; at 1280px → single row

**Steps:**

- [ ] **Step 1: Add flex-wrap to header button group**

In `client/src/pages/audit.tsx`, locate the header button group (around line 227):

```tsx
        <div className="flex items-center gap-2">
```

Change to:

```tsx
        <div className="flex flex-wrap items-center gap-2">
```

- [ ] **Step 2: Verify in browser**

Run: `npm run dev`

Open the Audit Trail page. In DevTools, set viewport to 820px.
Expected: Refresh and Export NDJSON buttons are both visible. No horizontal scrollbar.

Set viewport to 1280px.
Expected: Both buttons on one row (they fit comfortably at full width).

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/audit.tsx
git commit -m "feat(ipad-01): flex-wrap on audit trail header button group for iPad portrait"
```
