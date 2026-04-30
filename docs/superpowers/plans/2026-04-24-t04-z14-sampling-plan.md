# T-04: Z1.4 Sampling Plan Generator

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement ANSI/ASQ Z1.4 Level II sampling plan calculation. When a FULL_LAB_TEST receiving record is created, compute and store the recommended sample size (number of containers to test), accept number, and reject number based on lot quantity and a configurable AQL. Display the recommendation on the receiving UI.

**Architecture:** A pure `server/lib/z14-sampling.ts` utility holds the lookup table and computation function. `receivingRecords` gets a `samplingPlan` jsonb column populated at record creation. AQL is read from `appSettings` (default 2.5). The receiving page displays the sampling plan when workflow = FULL_LAB_TEST. No client-side computation — the plan is stored with the record for audit trail purposes.

**Tech Stack:** TypeScript, Drizzle ORM + PostgreSQL, Vitest, React + TanStack Query.

---

## Z1.4 Reference (embed in code — do NOT look this up at runtime)

### Level II lot-size → code letter

| Lot size range | Code |
|---|---|
| 2–8 | A |
| 9–15 | B |
| 16–25 | C |
| 26–50 | D |
| 51–90 | E |
| 91–150 | F |
| 151–280 | G |
| 281–500 | H |
| 501–1200 | J |
| 1201–3200 | K |
| 3201–10000 | L |
| 10001–35000 | M |
| 35001–150000 | N |
| 150001–500000 | P |
| 500001+ | Q |

### Normal inspection — code letter → sample size + Ac/Re at AQL 2.5

Codes A–C have ↑ arrows at AQL 2.5 (plan not defined for those sample sizes). Use code D's plan (n=8) as the minimum. Cap sample size at lot size.

| Code | Sample size (n) | Ac | Re |
|------|----------------|----|----|
| A–C  | 8 (use D)      | 0  | 1  |
| D    | 8              | 0  | 1  |
| E    | 13             | 0  | 1  |
| F    | 20             | 1  | 2  |
| G    | 32             | 2  | 3  |
| H    | 50             | 3  | 4  |
| J    | 80             | 5  | 6  |
| K    | 125            | 7  | 8  |
| L    | 200            | 10 | 11 |
| M    | 315            | 14 | 15 |
| N    | 500            | 21 | 22 |
| P    | 800            | 21 | 22 |
| Q    | 1250           | 21 | 22 |

---

### Task 0: Utility function + unit tests

**Goal:** Create a pure, well-tested Z1.4 computation function.

**Files:**
- Create: `server/lib/z14-sampling.ts`
- Create: `server/lib/z14-sampling.test.ts`

**Acceptance Criteria:**
- [ ] `computeZ14Plan(lotSize, aql)` returns `{ codeLetterLevel2, sampleSize, acceptNumber, rejectNumber }`
- [ ] Handles lot sizes across the full range (1 through 1 000 000+)
- [ ] Lot size 1 → sampleSize = 1, acceptNumber = 0, rejectNumber = 1 (100% inspection)
- [ ] Codes A–C at AQL 2.5 → sampleSize capped at min(8, lotSize) using D's plan
- [ ] sampleSize is always ≤ lotSize
- [ ] Unit tests cover boundary values and the ↑ arrow cases
- [ ] `pnpm test` passes

**Verify:** `pnpm test server/lib/z14-sampling.test.ts` → all tests pass

**Steps:**

- [ ] **Step 1: Create server/lib/z14-sampling.ts**

```ts
export interface Z14Plan {
  codeLetterLevel2: string;
  sampleSize: number;
  acceptNumber: number;
  rejectNumber: number;
}

interface LotSizeEntry { maxSize: number; code: string }
interface CodeEntry { code: string; n: number; ac: number; re: number }

const LOT_SIZE_TABLE: LotSizeEntry[] = [
  { maxSize: 8,      code: "A" },
  { maxSize: 15,     code: "B" },
  { maxSize: 25,     code: "C" },
  { maxSize: 50,     code: "D" },
  { maxSize: 90,     code: "E" },
  { maxSize: 150,    code: "F" },
  { maxSize: 280,    code: "G" },
  { maxSize: 500,    code: "H" },
  { maxSize: 1200,   code: "J" },
  { maxSize: 3200,   code: "K" },
  { maxSize: 10000,  code: "L" },
  { maxSize: 35000,  code: "M" },
  { maxSize: 150000, code: "N" },
  { maxSize: 500000, code: "P" },
  { maxSize: Infinity, code: "Q" },
];

// AQL 2.5, Normal inspection. Codes A–C use D's plan (↑ arrow in standard).
const AQL_2_5: CodeEntry[] = [
  { code: "A", n: 8,    ac: 0,  re: 1  },
  { code: "B", n: 8,    ac: 0,  re: 1  },
  { code: "C", n: 8,    ac: 0,  re: 1  },
  { code: "D", n: 8,    ac: 0,  re: 1  },
  { code: "E", n: 13,   ac: 0,  re: 1  },
  { code: "F", n: 20,   ac: 1,  re: 2  },
  { code: "G", n: 32,   ac: 2,  re: 3  },
  { code: "H", n: 50,   ac: 3,  re: 4  },
  { code: "J", n: 80,   ac: 5,  re: 6  },
  { code: "K", n: 125,  ac: 7,  re: 8  },
  { code: "L", n: 200,  ac: 10, re: 11 },
  { code: "M", n: 315,  ac: 14, re: 15 },
  { code: "N", n: 500,  ac: 21, re: 22 },
  { code: "P", n: 800,  ac: 21, re: 22 },
  { code: "Q", n: 1250, ac: 21, re: 22 },
];

const AQL_TABLES: Record<string, CodeEntry[]> = { "2.5": AQL_2_5 };

export function computeZ14Plan(lotSize: number, aql: number | string = 2.5): Z14Plan {
  const aqlKey = String(Number(aql));
  const table = AQL_TABLES[aqlKey] ?? AQL_2_5;

  if (lotSize <= 1) {
    return { codeLetterLevel2: "A", sampleSize: 1, acceptNumber: 0, rejectNumber: 1 };
  }

  const codeEntry = LOT_SIZE_TABLE.find((e) => lotSize <= e.maxSize);
  const code = codeEntry?.code ?? "Q";

  const planEntry = table.find((e) => e.code === code) ?? table[table.length - 1]!;
  const sampleSize = Math.min(planEntry.n, lotSize);

  return {
    codeLetterLevel2: code,
    sampleSize,
    acceptNumber: planEntry.ac,
    rejectNumber: planEntry.re,
  };
}
```

- [ ] **Step 2: Create server/lib/z14-sampling.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { computeZ14Plan } from "./z14-sampling";

describe("computeZ14Plan", () => {
  it("lot size 1 → 100% inspection (sampleSize = 1)", () => {
    const p = computeZ14Plan(1);
    expect(p.sampleSize).toBe(1);
    expect(p.acceptNumber).toBe(0);
    expect(p.rejectNumber).toBe(1);
  });

  it("lot size 5 (code A) → uses D plan, sampleSize capped at 5", () => {
    const p = computeZ14Plan(5);
    expect(p.codeLetterLevel2).toBe("A");
    expect(p.sampleSize).toBe(5); // min(8, 5)
    expect(p.acceptNumber).toBe(0);
    expect(p.rejectNumber).toBe(1);
  });

  it("lot size 8 (code A boundary) → sampleSize = 8", () => {
    const p = computeZ14Plan(8);
    expect(p.codeLetterLevel2).toBe("A");
    expect(p.sampleSize).toBe(8);
  });

  it("lot size 50 (code D) → sampleSize = 8, Ac=0, Re=1", () => {
    const p = computeZ14Plan(50);
    expect(p.codeLetterLevel2).toBe("D");
    expect(p.sampleSize).toBe(8);
    expect(p.acceptNumber).toBe(0);
    expect(p.rejectNumber).toBe(1);
  });

  it("lot size 100 (code F) → sampleSize = 20, Ac=1, Re=2", () => {
    const p = computeZ14Plan(100);
    expect(p.codeLetterLevel2).toBe("F");
    expect(p.sampleSize).toBe(20);
    expect(p.acceptNumber).toBe(1);
    expect(p.rejectNumber).toBe(2);
  });

  it("lot size 500 (code H) → sampleSize = 50, Ac=3, Re=4", () => {
    const p = computeZ14Plan(500);
    expect(p.codeLetterLevel2).toBe("H");
    expect(p.sampleSize).toBe(50);
    expect(p.acceptNumber).toBe(3);
    expect(p.rejectNumber).toBe(4);
  });

  it("lot size 1000 (code J) → sampleSize = 80, Ac=5, Re=6", () => {
    const p = computeZ14Plan(1000);
    expect(p.codeLetterLevel2).toBe("J");
    expect(p.sampleSize).toBe(80);
    expect(p.acceptNumber).toBe(5);
    expect(p.rejectNumber).toBe(6);
  });

  it("lot size 1 000 000 (code Q) → sampleSize = 1250", () => {
    const p = computeZ14Plan(1_000_000);
    expect(p.codeLetterLevel2).toBe("Q");
    expect(p.sampleSize).toBe(1250);
    expect(p.acceptNumber).toBe(21);
    expect(p.rejectNumber).toBe(22);
  });

  it("sampleSize never exceeds lotSize", () => {
    for (const size of [3, 7, 10, 18, 30]) {
      const p = computeZ14Plan(size);
      expect(p.sampleSize).toBeLessThanOrEqual(size);
    }
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm test server/lib/z14-sampling.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/lib/z14-sampling.ts server/lib/z14-sampling.test.ts
git commit -m "feat(t-04): Z1.4 Level II sampling plan utility with unit tests"
```

---

### Task 1: Schema + migration

**Goal:** Add `samplingPlan` jsonb column to `receivingRecords`.

**Files:**
- Create: `migrations/0010_t04_sampling_plan.sql`
- Modify: `shared/schema.ts`

**Acceptance Criteria:**
- [ ] Migration adds `sampling_plan jsonb` (nullable) to `erp_receiving_records`
- [ ] Journal entry idx 10 added
- [ ] `shared/schema.ts` has `samplingPlan: jsonb("sampling_plan").$type<Z14Plan | null>()` on `receivingRecords`
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → 0 errors

**Steps:**

- [ ] **Step 1: Migration**

Create `migrations/0010_t04_sampling_plan.sql`:

```sql
-- T-04: Z1.4 sampling plan stored with receiving record for audit trail
ALTER TABLE erp_receiving_records
  ADD COLUMN sampling_plan JSONB;
```

Add to `migrations/meta/_journal.json`:

```json
{
  "idx": 10,
  "version": "7",
  "when": 1745500200000,
  "tag": "0010_t04_sampling_plan",
  "breakpoints": true
}
```

- [ ] **Step 2: Update shared/schema.ts**

Import `Z14Plan` type from the server lib — actually since `shared/schema.ts` is shared between client and server, use an inline interface instead:

In `receivingRecords` pgTable, add after `updatedAt`:

```ts
samplingPlan: jsonb("sampling_plan").$type<{
  codeLetterLevel2: string;
  sampleSize: number;
  acceptNumber: number;
  rejectNumber: number;
} | null>(),
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add migrations/0010_t04_sampling_plan.sql migrations/meta/_journal.json shared/schema.ts
git commit -m "feat(t-04): add sampling_plan jsonb column to erp_receiving_records"
```

---

### Task 2: Populate sampling plan on record creation

**Goal:** When a `FULL_LAB_TEST` receiving record is created, compute and store the Z1.4 sampling plan.

**Files:**
- Modify: `server/db-storage.ts`

**Acceptance Criteria:**
- [ ] `createReceivingRecord` in `db-storage.ts` calls `computeZ14Plan` when `qcWorkflowType === "FULL_LAB_TEST"` and `quantityReceived` is set
- [ ] Result stored in `samplingPlan` field of the inserted record
- [ ] Non-FULL_LAB_TEST workflows → `samplingPlan` remains null
- [ ] AQL defaults to 2.5 (no app-settings dependency for now — hardcode 2.5)
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → 0 errors

**Steps:**

- [ ] **Step 1: Find createReceivingRecord in db-storage.ts**

Search for `createReceivingRecord` — it will be the method that inserts into `schema.receivingRecords`.

- [ ] **Step 2: Add sampling plan computation**

Import `computeZ14Plan` at the top of `server/db-storage.ts`:

```ts
import { computeZ14Plan } from "./lib/z14-sampling";
```

In `createReceivingRecord`, before the insert, add:

```ts
let samplingPlan = null;
if (data.qcWorkflowType === "FULL_LAB_TEST" && data.quantityReceived != null) {
  const lotSize = Math.round(Number(data.quantityReceived));
  if (lotSize > 0) {
    samplingPlan = computeZ14Plan(lotSize, 2.5);
  }
}
```

Then include `samplingPlan` in the insert values:

```ts
.values({ ...data, samplingPlan })
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add server/db-storage.ts
git commit -m "feat(t-04): compute and store Z1.4 sampling plan on FULL_LAB_TEST record creation"
```

---

### Task 3: UI — display sampling plan on receiving record

**Goal:** Show the Z1.4 sampling recommendation in the receiving workflow UI when the workflow type is FULL_LAB_TEST.

**Files:**
- Modify: `client/src/pages/receiving.tsx` (or the relevant receiving record detail component — read the file to find where QC workflow info is displayed)

**Acceptance Criteria:**
- [ ] When `record.qcWorkflowType === "FULL_LAB_TEST"` and `record.samplingPlan` is set, display: sample size, accept number, reject number, code letter
- [ ] Display is read-only (informational)
- [ ] Display is clearly labeled (e.g. "Z1.4 Sampling Plan — AQL 2.5")
- [ ] When `samplingPlan` is null (non-FULL_LAB_TEST or old records), nothing extra is shown
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → 0 errors

**Steps:**

- [ ] **Step 1: Read the receiving page to find where to add the display**

Read `client/src/pages/receiving.tsx`. Find where individual receiving records are displayed (likely a detail panel, modal, or expanded row). Look for where `qcWorkflowType` is displayed.

- [ ] **Step 2: Add the sampling plan display**

Find the section that renders the receiving record detail. After the workflow type display, add:

```tsx
{record.qcWorkflowType === "FULL_LAB_TEST" && record.samplingPlan && (
  <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1">
    <div className="text-xs font-medium text-foreground">Z1.4 Sampling Plan — AQL 2.5</div>
    <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
      <div>
        <div className="font-medium text-foreground">{record.samplingPlan.sampleSize}</div>
        <div>Sample size</div>
      </div>
      <div>
        <div className="font-medium text-foreground">≤{record.samplingPlan.acceptNumber}</div>
        <div>Accept if defects</div>
      </div>
      <div>
        <div className="font-medium text-foreground">≥{record.samplingPlan.rejectNumber}</div>
        <div>Reject if defects</div>
      </div>
    </div>
    <div className="text-[10px] text-muted-foreground">Code {record.samplingPlan.codeLetterLevel2} • Level II Normal</div>
  </div>
)}
```

Adjust JSX to match the file's existing style (component structure, className conventions).

- [ ] **Step 3: Update the TypeScript type for ReceivingRecord on the client**

If the client has a local type definition for receiving records that doesn't include `samplingPlan`, add it. Search for `interface.*ReceivingRecord\|type.*ReceivingRecord` in the receiving page.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/receiving.tsx
git commit -m "feat(t-04): display Z1.4 sampling plan on FULL_LAB_TEST receiving records"
```

```json:metadata
{"files": ["server/lib/z14-sampling.ts", "server/lib/z14-sampling.test.ts", "migrations/0010_t04_sampling_plan.sql", "migrations/meta/_journal.json", "shared/schema.ts", "server/db-storage.ts", "client/src/pages/receiving.tsx"], "verifyCommand": "pnpm typecheck && pnpm test", "acceptanceCriteria": ["computeZ14Plan returns correct plan for all lot size ranges", "sampleSize never exceeds lotSize", "samplingPlan stored on FULL_LAB_TEST records at creation", "UI displays sampling plan for FULL_LAB_TEST records", "pnpm typecheck passes", "pnpm test passes"]}
```
