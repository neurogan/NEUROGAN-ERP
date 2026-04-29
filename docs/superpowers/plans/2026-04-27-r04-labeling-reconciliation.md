# R-04 Labeling & Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the FDA Form 483 Obs 9 + Obs 10 closure: artwork master with QA approval, software-managed label-cage spool inventory, BPR-tied label issuance + thermal print events via injectable adapter, mandatory reconciliation at BPR close with deviation gate on out-of-tolerance, plus a minimal SOPs registry cited from BPR steps. New top-level "Quality" tab houses it.

**Architecture:** Migration `0018_r04_labeling_reconciliation.sql` adds 6 tables (+ extends `erp_bpr_steps`). Storage helpers per file under `server/storage/`. Print adapter pattern under new `server/printing/`. UI under new `client/src/pages/quality/` directory. BPR completion gates extend the R-03 gate framework via a new `server/state/bpr-completion-gates.ts`.

**Tech Stack:** Drizzle ORM + Postgres, Express + Zod, Vitest with `describeIfDb`, React 18 + wouter + TanStack Query v5 + react-hook-form + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-04-27-r04-labeling-reconciliation-design.md`

---

## Task 1: Migration 0018 + Drizzle schema

**Goal:** All 6 new tables created, `erp_bpr_steps` extended with `sop_code`/`sop_version`, app_settings rows seeded, Drizzle schema in `shared/schema.ts` reflects everything.

**Files:**
- Create: `migrations/0018_r04_labeling_reconciliation.sql`
- Modify: `shared/schema.ts` (add 6 tables + extend `bprSteps`)
- Create: `migrations/__tests__/0018-r04.test.ts`
- Modify: `migrations/meta/_journal.json` (register migration)

**Acceptance Criteria:**
- [ ] All 6 tables created with documented columns + CHECK constraints + UNIQUE indexes
- [ ] `bpr_steps.sop_code` and `bpr_steps.sop_version` added (both nullable text)
- [ ] App-settings rows for `labelToleranceAbs`, `labelPrintAdapter`, `labelPrintHost`, `labelPrintPort` upserted
- [ ] Drizzle schema exports `labelArtwork`, `labelSpools`, `labelIssuanceLog`, `labelPrintJobs`, `labelReconciliations`, `sops` plus their `*Schema` Zod inserts
- [ ] Migration test asserts column existence, CHECK on `qty_on_hand`, UNIQUE `(product_id, version)`, UNIQUE `(bpr_id)` on reconciliations

**Verify:** `pnpm test migrations/__tests__/0018-r04.test.ts -- --run` → PASS

**Steps:**

- [ ] **Step 1: Write the migration test first**

```ts
// migrations/__tests__/0018-r04.test.ts
import { describeIfDb } from "../../server/__tests__/_helpers";

describeIfDb("migration 0018 — R-04 labeling tables", (ctx) => {
  test("erp_label_artwork exists with expected columns", async () => {
    const cols = await ctx.db.execute(/* sql information_schema query */);
    expect(cols).toContain("artwork_file_data");
    expect(cols).toContain("variable_data_spec");
    /* ...assert all 6 tables and bpr_steps extension */
  });

  test("qty_on_hand CHECK rejects negative", async () => {
    /* attempt INSERT with qty_on_hand = -1 → expect error */
  });

  test("UNIQUE (product_id, version) on label_artwork", async () => { /* ... */ });
  test("UNIQUE bpr_id on label_reconciliations", async () => { /* ... */ });
  test("app_settings rows seeded", async () => { /* ... */ });
});
```

- [ ] **Step 2: Write the migration SQL**

Create the 6 tables with the exact columns listed in the spec (§5). Order: `erp_label_artwork`, `erp_label_spools`, `erp_label_issuance_log`, `erp_label_print_jobs`, `erp_label_reconciliations`, `erp_sops`. Then extend `erp_bpr_steps`. Then `INSERT INTO erp_app_settings ... ON CONFLICT (key) DO NOTHING`. Add all CHECK constraints and indexes.

- [ ] **Step 3: Run test, expect FAIL (table missing)**

`pnpm test migrations/__tests__/0018-r04.test.ts -- --run`

- [ ] **Step 4: Apply migration locally**

`DATABASE_URL=postgresql://frederikhejlskov@localhost:5432/neurogan_erp_test pnpm drizzle-kit push`

- [ ] **Step 5: Add Drizzle schema exports in `shared/schema.ts`**

For each table: `pgTable` definition + `createInsertSchema` Zod export + inferred type. Match the existing R-03 patterns (e.g. `equipment`, `cleaningLogs`).

- [ ] **Step 6: Register migration in `migrations/meta/_journal.json`**

Append the journal entry like prior migrations.

- [ ] **Step 7: Run test, expect PASS**

- [ ] **Step 8: Commit**

```bash
git add migrations/0018_r04_labeling_reconciliation.sql migrations/__tests__/0018-r04.test.ts migrations/meta/_journal.json shared/schema.ts
git commit -m "feat(r-04): migration 0018 + Drizzle schema for labeling tables"
```

---

## Task 2: Signature meanings + audit actions

**Goal:** Six new signature meanings and audit-action codes registered.

**Files:**
- Modify: `server/signatures/signatures.ts`
- Modify: `server/audit/actions.ts`

**Acceptance Criteria:**
- [ ] Signature meanings registered: `ARTWORK_APPROVED`, `ARTWORK_RETIRED`, `LABEL_SPOOL_RECEIVED`, `LABEL_PRINT_BATCH`, `LABEL_RECONCILED`, `SOP_APPROVED`, `SOP_RETIRED`
- [ ] Audit actions registered: `LABEL_ARTWORK_CREATED`, `LABEL_ARTWORK_APPROVED`, `LABEL_ARTWORK_RETIRED`, `LABEL_SPOOL_RECEIVED`, `LABEL_SPOOL_DISPOSED`, `LABEL_ISSUED`, `LABEL_PRINTED`, `LABEL_RECONCILED`, `SOP_CREATED`, `SOP_APPROVED`, `SOP_RETIRED`
- [ ] Each meaning has a grammatical present-tense manifestation phrase (matches existing R-03 pattern)

**Verify:** `pnpm tsc --noEmit` → no errors

**Steps:**

- [ ] **Step 1: Read existing signature-meanings file**

Read `server/signatures/signatures.ts` to find the `MEANING_*` exports and the verb-manifestation table. Match the R-03 entries you find there as a pattern.

- [ ] **Step 2: Add the 7 new meanings**

```ts
export const MEANING_ARTWORK_APPROVED = "ARTWORK_APPROVED" as const;
export const MEANING_ARTWORK_RETIRED  = "ARTWORK_RETIRED"  as const;
export const MEANING_LABEL_SPOOL_RECEIVED = "LABEL_SPOOL_RECEIVED" as const;
export const MEANING_LABEL_PRINT_BATCH    = "LABEL_PRINT_BATCH"    as const;
export const MEANING_LABEL_RECONCILED     = "LABEL_RECONCILED"     as const;
export const MEANING_SOP_APPROVED = "SOP_APPROVED" as const;
export const MEANING_SOP_RETIRED  = "SOP_RETIRED"  as const;
```

Add manifestation phrases (grammatical present tense matching R-03 verb table):
- `ARTWORK_APPROVED` → `"approves artwork"`
- `ARTWORK_RETIRED` → `"retires artwork"`
- `LABEL_SPOOL_RECEIVED` → `"receives label spool"`
- `LABEL_PRINT_BATCH` → `"initiates label print"`
- `LABEL_RECONCILED` → `"reconciles labels"`
- `SOP_APPROVED` → `"approves SOP version"`
- `SOP_RETIRED` → `"retires SOP version"`

- [ ] **Step 3: Add the 11 new audit actions in `server/audit/actions.ts`**

Pattern match existing exports (e.g. `LOT_APPROVED`, `EQUIPMENT_QUALIFIED`):

```ts
export const ACTION_LABEL_ARTWORK_CREATED  = "LABEL_ARTWORK_CREATED"  as const;
export const ACTION_LABEL_ARTWORK_APPROVED = "LABEL_ARTWORK_APPROVED" as const;
export const ACTION_LABEL_ARTWORK_RETIRED  = "LABEL_ARTWORK_RETIRED"  as const;
export const ACTION_LABEL_SPOOL_RECEIVED   = "LABEL_SPOOL_RECEIVED"   as const;
export const ACTION_LABEL_SPOOL_DISPOSED   = "LABEL_SPOOL_DISPOSED"   as const;
export const ACTION_LABEL_ISSUED           = "LABEL_ISSUED"           as const;
export const ACTION_LABEL_PRINTED          = "LABEL_PRINTED"          as const;
export const ACTION_LABEL_RECONCILED       = "LABEL_RECONCILED"       as const;
export const ACTION_SOP_CREATED  = "SOP_CREATED"  as const;
export const ACTION_SOP_APPROVED = "SOP_APPROVED" as const;
export const ACTION_SOP_RETIRED  = "SOP_RETIRED"  as const;
```

- [ ] **Step 4: Run typecheck**

`pnpm tsc --noEmit` → expect zero errors.

- [ ] **Step 5: Commit**

```bash
git add server/signatures/signatures.ts server/audit/actions.ts
git commit -m "feat(r-04): register signature meanings and audit actions"
```

---

## Task 3: Print adapter module

**Goal:** `LabelPrintAdapter` interface + `ZplOverTcpAdapter` impl + `StubAdapter` impl + factory/registry with test injection point.

**Files:**
- Create: `server/printing/adapter.ts` (interface + types)
- Create: `server/printing/zpl-tcp-adapter.ts`
- Create: `server/printing/stub-adapter.ts`
- Create: `server/printing/registry.ts`
- Create: `server/printing/__tests__/zpl-tcp.test.ts`
- Create: `server/printing/__tests__/stub.test.ts`
- Create: `server/printing/__tests__/registry.test.ts`

**Acceptance Criteria:**
- [ ] `LabelPrintAdapter` interface with `name` + `print(input)` returning `Promise<PrintResult>`
- [ ] `ZplOverTcpAdapter` connects to `host:port`, writes ZPL bytes, treats response as success indicator, FAILED on connect/timeout/socket error
- [ ] `ZplOverTcpAdapter` 5s connect timeout, 10s total timeout
- [ ] `StubAdapter` always returns `SUCCESS` with `qtyPrinted = input.qty`
- [ ] `getLabelPrintAdapter()` reads `app_settings.labelPrintAdapter` and returns the configured impl
- [ ] `setLabelPrintAdapter(adapter)` for test override; `resetLabelPrintAdapter()` to clear

**Verify:** `pnpm test server/printing -- --run` → PASS (uses Node `net.createServer` mock for ZPL test)

**Steps:**

- [ ] **Step 1: Write tests first**

```ts
// server/printing/__tests__/stub.test.ts
import { StubAdapter } from "../stub-adapter";

test("StubAdapter returns SUCCESS with provided qty", async () => {
  const adapter = new StubAdapter();
  const result = await adapter.print({
    artwork: { id: "a", productId: "p", version: "v1", variableDataSpec: { lot: true, expiry: true } } as any,
    lot: "L001",
    expiry: new Date("2027-01-01"),
    qty: 100,
  });
  expect(result.status).toBe("SUCCESS");
  expect(result.qtyPrinted).toBe(100);
  expect(result.diagnostics.stubbed).toBe(true);
});
```

```ts
// server/printing/__tests__/zpl-tcp.test.ts
import * as net from "node:net";
import { ZplOverTcpAdapter } from "../zpl-tcp-adapter";

test("sends ZPL to printer and returns SUCCESS on socket close", async () => {
  let received = "";
  const server = net.createServer((sock) => {
    sock.on("data", (chunk) => { received += chunk.toString(); });
    sock.on("end", () => sock.end());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;

  const adapter = new ZplOverTcpAdapter("127.0.0.1", port);
  const result = await adapter.print({
    artwork: { variableDataSpec: { lot: true, expiry: true } } as any,
    lot: "L001",
    expiry: new Date("2027-01-01"),
    qty: 5,
  });

  expect(received).toContain("^XA");      // ZPL start
  expect(received).toContain("L001");
  expect(result.status).toBe("SUCCESS");
  expect(result.qtyPrinted).toBe(5);
  server.close();
});

test("returns FAILED on connect timeout", async () => {
  const adapter = new ZplOverTcpAdapter("10.255.255.1", 9100); // unreachable
  const result = await adapter.print({ /* ... */ } as any);
  expect(result.status).toBe("FAILED");
  expect(result.diagnostics.error).toBeDefined();
}, 15000);
```

```ts
// server/printing/__tests__/registry.test.ts
import { setLabelPrintAdapter, resetLabelPrintAdapter, getLabelPrintAdapter } from "../registry";
import { StubAdapter } from "../stub-adapter";

afterEach(() => resetLabelPrintAdapter());

test("returns configured adapter", async () => {
  const stub = new StubAdapter();
  setLabelPrintAdapter(stub);
  expect(getLabelPrintAdapter()).toBe(stub);
});
```

- [ ] **Step 2: Implement `server/printing/adapter.ts`**

```ts
import type { LabelArtwork } from "@shared/schema";

export interface PrintInput {
  artwork: LabelArtwork;
  lot: string;
  expiry: Date;
  qty: number;
}

export interface PrintResult {
  status: "SUCCESS" | "FAILED" | "PARTIAL";
  qtyPrinted: number;
  diagnostics: Record<string, unknown>;
}

export interface LabelPrintAdapter {
  readonly name: "ZPL_TCP" | "STUB";
  print(input: PrintInput): Promise<PrintResult>;
}
```

- [ ] **Step 3: Implement `StubAdapter`**

```ts
import type { LabelPrintAdapter, PrintInput, PrintResult } from "./adapter";

export class StubAdapter implements LabelPrintAdapter {
  readonly name = "STUB" as const;
  async print(input: PrintInput): Promise<PrintResult> {
    return { status: "SUCCESS", qtyPrinted: input.qty, diagnostics: { stubbed: true } };
  }
}
```

- [ ] **Step 4: Implement `ZplOverTcpAdapter`**

```ts
import * as net from "node:net";
import type { LabelPrintAdapter, PrintInput, PrintResult } from "./adapter";

const CONNECT_TIMEOUT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 10_000;

export class ZplOverTcpAdapter implements LabelPrintAdapter {
  readonly name = "ZPL_TCP" as const;
  constructor(private host: string, private port: number) {}

  async print(input: PrintInput): Promise<PrintResult> {
    const zpl = renderZpl(input);
    const start = Date.now();
    return new Promise<PrintResult>((resolve) => {
      const sock = new net.Socket();
      let settled = false;
      const total = setTimeout(() => {
        if (settled) return;
        settled = true;
        sock.destroy();
        resolve({ status: "FAILED", qtyPrinted: 0, diagnostics: { error: "total timeout", host: this.host, port: this.port, durationMs: Date.now() - start } });
      }, TOTAL_TIMEOUT_MS);
      sock.setTimeout(CONNECT_TIMEOUT_MS);
      sock.on("timeout", () => {
        if (settled) return;
        settled = true;
        clearTimeout(total);
        sock.destroy();
        resolve({ status: "FAILED", qtyPrinted: 0, diagnostics: { error: "connect timeout", host: this.host, port: this.port } });
      });
      sock.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(total);
        resolve({ status: "FAILED", qtyPrinted: 0, diagnostics: { error: err.message, host: this.host, port: this.port } });
      });
      sock.connect(this.port, this.host, () => {
        sock.write(zpl, () => sock.end());
      });
      sock.on("close", () => {
        if (settled) return;
        settled = true;
        clearTimeout(total);
        resolve({ status: "SUCCESS", qtyPrinted: input.qty, diagnostics: { host: this.host, port: this.port, durationMs: Date.now() - start, bytesSent: zpl.length } });
      });
    });
  }
}

function renderZpl(input: PrintInput): string {
  const expiry = input.expiry.toISOString().split("T")[0];
  // Minimal ZPL: print lot + expiry on a 2"x1" label, qty copies via ^PQ
  return [
    "^XA",
    `^FO50,30^A0N,30,30^FDLot: ${input.lot}^FS`,
    `^FO50,80^A0N,30,30^FDExp: ${expiry}^FS`,
    `^PQ${input.qty},0,1,Y`,
    "^XZ",
  ].join("\n");
}
```

- [ ] **Step 5: Implement `registry.ts`**

```ts
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import type { LabelPrintAdapter } from "./adapter";
import { StubAdapter } from "./stub-adapter";
import { ZplOverTcpAdapter } from "./zpl-tcp-adapter";

let override: LabelPrintAdapter | null = null;

export function setLabelPrintAdapter(adapter: LabelPrintAdapter): void {
  override = adapter;
}
export function resetLabelPrintAdapter(): void {
  override = null;
}
export async function getLabelPrintAdapter(): Promise<LabelPrintAdapter> {
  if (override) return override;
  const rows = await db.select().from(schema.appSettings)
    .where(eq(schema.appSettings.key, "labelPrintAdapter")).limit(1);
  const adapterType = rows[0]?.value ?? "STUB";
  if (adapterType === "ZPL_TCP") {
    const host = (await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "labelPrintHost")).limit(1))[0]?.value ?? "";
    const port = parseInt((await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "labelPrintPort")).limit(1))[0]?.value ?? "9100", 10);
    return new ZplOverTcpAdapter(host, port);
  }
  return new StubAdapter();
}
```

- [ ] **Step 6: Run all printing tests, expect PASS**

`pnpm test server/printing -- --run`

- [ ] **Step 7: Commit**

```bash
git add server/printing
git commit -m "feat(r-04): label print adapter (ZPL/TCP + stub) with test injection"
```

---

## Task 4: Storage layer — artwork

**Goal:** `server/storage/label-artwork.ts` with CRUD + approval/retire helpers; full integration tests.

**Files:**
- Create: `server/storage/label-artwork.ts`
- Create: `server/__tests__/r04-artwork-storage.test.ts`

**Acceptance Criteria:**
- [ ] `createArtwork(input)` returns DRAFT artwork
- [ ] `approveArtwork(id, userId)` performs F-04 ceremony with `ARTWORK_APPROVED` meaning, sets status APPROVED + signatureId + approvedAt
- [ ] `retireArtwork(id, userId)` performs F-04 ceremony with `ARTWORK_RETIRED`
- [ ] `listArtworkByProduct(productId)` returns ordered by version desc
- [ ] `getActiveArtwork(productId)` returns the latest APPROVED row or null
- [ ] All mutations write audit rows
- [ ] Trying to approve a RETIRED artwork → throws structured error `ARTWORK_INVALID_STATE`

**Verify:** `pnpm test server/__tests__/r04-artwork-storage.test.ts -- --run` → PASS

**Steps:**

- [ ] **Step 1: Tests first**

Tests assert: create returns DRAFT, approve transitions DRAFT→APPROVED with non-null signatureId, retire transitions APPROVED→RETIRED, getActiveArtwork returns latest APPROVED, attempting to approve already-APPROVED throws.

- [ ] **Step 2: Implement storage helpers**

Use the `performSignature(...)` wrapper for state transitions matching how R-03 equipment qualifications worked. Direct DB inserts/updates for non-signed paths.

- [ ] **Step 3: Run tests, expect PASS**

- [ ] **Step 4: Commit**

```bash
git add server/storage/label-artwork.ts server/__tests__/r04-artwork-storage.test.ts
git commit -m "feat(r-04): label artwork storage with F-04 approval"
```

---

## Task 5: Storage layer — spools

**Goal:** `server/storage/label-spools.ts` with receive/dispose/list helpers + atomic qty decrement helper used by issuance.

**Files:**
- Create: `server/storage/label-spools.ts`
- Create: `server/__tests__/r04-spools-storage.test.ts`

**Acceptance Criteria:**
- [ ] `receiveSpool(input)` performs F-04 (`LABEL_SPOOL_RECEIVED`), creates ACTIVE spool with `qtyOnHand = qtyInitial`
- [ ] `disposeSpool(id, userId, reason)` performs F-04, sets status DISPOSED + signatureId
- [ ] `decrementSpoolQty(spoolId, qty, tx)` accepts a Drizzle transaction, atomically decrements `qtyOnHand`, throws `INSUFFICIENT_SPOOL_QTY` (HTTP 409) if would go negative; transitions to DEPLETED when qty hits 0
- [ ] `listActiveSpools(artworkId)` returns ACTIVE spools ordered by oldest first (FIFO consumption)
- [ ] Cannot receive a spool against a non-APPROVED artwork → throws `ARTWORK_NOT_APPROVED`

**Verify:** `pnpm test server/__tests__/r04-spools-storage.test.ts -- --run` → PASS

**Steps:**

- [ ] **Step 1: Tests first**

Cover: receive happy path, dispose happy path, decrement reduces qty, decrement to 0 transitions to DEPLETED, decrement insufficient throws 409, receive against retired artwork rejected.

- [ ] **Step 2: Implement storage**

Use Drizzle `db.transaction` for the atomic decrement. Use `sql\`qty_on_hand - ${qty}\`` for the update; precondition check via `WHERE qty_on_hand >= ${qty}` and check `result.rowCount === 1`.

- [ ] **Step 3: Run tests, expect PASS**

- [ ] **Step 4: Commit**

```bash
git add server/storage/label-spools.ts server/__tests__/r04-spools-storage.test.ts
git commit -m "feat(r-04): label spool inventory with atomic qty decrement"
```

---

## Task 6: Storage layer — issuance + print jobs

**Goal:** `server/storage/label-issuance.ts` for BPR↔spool check-out and print-job audit.

**Files:**
- Create: `server/storage/label-issuance.ts`
- Create: `server/__tests__/r04-issuance-storage.test.ts`

**Acceptance Criteria:**
- [ ] `issueLabels(bprId, spoolId, qty, userId)` opens transaction; verifies BPR is `IN_PROGRESS`; verifies spool ACTIVE; calls `decrementSpoolQty` within transaction; inserts `label_issuance_log` row; writes audit row; returns the issuance row
- [ ] Error on BPR not in IN_PROGRESS → 409 `BPR_NOT_IN_PROGRESS`
- [ ] Error on spool not ACTIVE → 409 `SPOOL_NOT_ACTIVE`
- [ ] Error on insufficient qty → 409 `INSUFFICIENT_SPOOL_QTY` (raised by helper from Task 5; transaction rolls back)
- [ ] `recordPrintJob(input)` performs F-04 (`LABEL_PRINT_BATCH`), inserts `label_print_jobs` row using the result the route already obtained from the adapter (helper does NOT call the adapter — separation of concerns)
- [ ] `listIssuanceForBpr(bprId)` returns issuance rows + their print jobs (joined)
- [ ] `sumIssuedForBpr(bprId)` returns scalar — used by reconciliation

**Verify:** `pnpm test server/__tests__/r04-issuance-storage.test.ts -- --run` → PASS

**Steps:**

- [ ] **Step 1: Tests first**

- [ ] **Step 2: Implement storage**

- [ ] **Step 3: Run tests, expect PASS**

- [ ] **Step 4: Commit**

```bash
git add server/storage/label-issuance.ts server/__tests__/r04-issuance-storage.test.ts
git commit -m "feat(r-04): label issuance + print-job audit storage"
```

---

## Task 7: Storage layer — reconciliation

**Goal:** `server/storage/label-reconciliations.ts` with single-row-per-BPR insertion + variance/tolerance computation.

**Files:**
- Create: `server/storage/label-reconciliations.ts`
- Create: `server/__tests__/r04-reconciliation-storage.test.ts`

**Acceptance Criteria:**
- [ ] `reconcileBpr(input)` performs F-04 (`LABEL_RECONCILED`), computes `issued = sumIssuedForBpr(bprId)`, computes `variance = issued - applied - destroyed - returned`, looks up `labelToleranceAbs` from app_settings, sets `toleranceExceeded = abs(variance) > tolerance`
- [ ] If `toleranceExceeded` and no `deviationId` → throws 409 `RECONCILIATION_OUT_OF_TOLERANCE`
- [ ] If reconciliation already exists for this BPR → throws 409 `RECONCILIATION_ALREADY_EXISTS`
- [ ] If `deviationId` provided, verifies the deviation belongs to this BPR
- [ ] `getReconciliationForBpr(bprId)` returns row or null
- [ ] Audit row written with action `LABEL_RECONCILED`

**Verify:** `pnpm test server/__tests__/r04-reconciliation-storage.test.ts -- --run` → PASS

**Steps:**

- [ ] **Step 1: Tests first**

Tests cover: in-tolerance happy path, out-of-tolerance with deviation succeeds, out-of-tolerance without deviation 409s, double-reconcile 409s, mismatched deviationId rejected.

- [ ] **Step 2: Implement**

- [ ] **Step 3: Run tests, expect PASS**

- [ ] **Step 4: Commit**

```bash
git add server/storage/label-reconciliations.ts server/__tests__/r04-reconciliation-storage.test.ts
git commit -m "feat(r-04): reconciliation storage with tolerance + deviation gate"
```

---

## Task 8: BPR completion gate framework

**Goal:** `server/state/bpr-completion-gates.ts` mirrors `bpr-equipment-gates.ts` from R-03; runs gates before BPR transitions to COMPLETE.

**Files:**
- Create: `server/state/bpr-completion-gates.ts`
- Create: `server/__tests__/r04-bpr-completion-gates.test.ts`
- Modify: `server/routes.ts` (BPR status transition route calls `runCompletionGates` before COMPLETE)

**Acceptance Criteria:**
- [ ] `CompletionGateError extends Error` with `status=409`, `code`, `payload`
- [ ] Gate codes: `LABEL_RECONCILIATION_MISSING`, `LABEL_RECONCILIATION_OUT_OF_TOLERANCE_NO_DEVIATION` (defense-in-depth)
- [ ] `runCompletionGates(db, bprId)` runs gates in order, throws on first failure
- [ ] BPR status transition `IN_PROGRESS → COMPLETE` calls this; resume from `ON_HOLD` to `IN_PROGRESS` does NOT (already completed BPRs unaffected)
- [ ] Existing BPR completion paths (currently free to transition) now blocked unless reconciliation exists

**Verify:** `pnpm test server/__tests__/r04-bpr-completion-gates.test.ts -- --run` → PASS

**Steps:**

- [ ] **Step 1: Tests first** — assert each gate fires with correct code on its precondition; happy path passes through.

- [ ] **Step 2: Implement gates module**

```ts
// server/state/bpr-completion-gates.ts
import { getReconciliationForBpr } from "../storage/label-reconciliations";

export type CompletionGateCode =
  | "LABEL_RECONCILIATION_MISSING"
  | "LABEL_RECONCILIATION_OUT_OF_TOLERANCE_NO_DEVIATION";

export class CompletionGateError extends Error {
  readonly status = 409 as const;
  readonly code: CompletionGateCode;
  readonly payload: unknown;
  constructor(code: CompletionGateCode, message: string, payload: unknown) {
    super(message);
    this.name = "CompletionGateError";
    this.code = code;
    this.payload = payload;
  }
  static is(e: unknown): e is CompletionGateError {
    return e instanceof CompletionGateError;
  }
}

export async function runCompletionGates(bprId: string): Promise<void> {
  const recon = await getReconciliationForBpr(bprId);
  if (!recon) {
    throw new CompletionGateError("LABEL_RECONCILIATION_MISSING", "Label reconciliation required before BPR can complete", { bprId });
  }
  if (recon.toleranceExceeded && !recon.deviationId) {
    throw new CompletionGateError("LABEL_RECONCILIATION_OUT_OF_TOLERANCE_NO_DEVIATION", "Out-of-tolerance reconciliation requires a linked deviation", { bprId, variance: recon.variance });
  }
}
```

- [ ] **Step 3: Wire into BPR status transition route**

Find the existing `PATCH /api/bpr/:id` (or status endpoint) that handles `status` updates. Where it transitions to `COMPLETE`, call `runCompletionGates(bprId)` and let the error propagate (the existing GateError-style error handler will JSON it).

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add server/state/bpr-completion-gates.ts server/__tests__/r04-bpr-completion-gates.test.ts server/routes.ts
git commit -m "feat(r-04): BPR completion gate (label reconciliation + deviation)"
```

---

## Task 9: API routes — artwork

**Goal:** REST endpoints for artwork.

**Files:**
- Modify: `server/routes.ts`
- Create: `server/__tests__/r04-artwork-routes.test.ts`

**Acceptance Criteria:**
- [ ] `POST /api/label-artwork` — role `QA|QC_MANAGER|ADMIN`, multipart upload (file_data + variableDataSpec), returns DRAFT
- [ ] `GET /api/label-artwork?productId=...` — all roles, returns list
- [ ] `GET /api/label-artwork/:id` — returns single
- [ ] `POST /api/label-artwork/:id/approve` — F-04 with password ceremony, transitions DRAFT→APPROVED
- [ ] `POST /api/label-artwork/:id/retire` — F-04, transitions APPROVED→RETIRED
- [ ] 403 for non-permitted roles, 404 for missing IDs, 409 on invalid state transitions

**Verify:** `pnpm test server/__tests__/r04-artwork-routes.test.ts -- --run` → PASS

**Steps:**

- [ ] **Step 1: Tests first** — supertest happy paths + role denial + invalid transitions.

- [ ] **Step 2: Implement routes** matching existing patterns (see equipment routes for shape).

- [ ] **Step 3: Run tests, expect PASS**

- [ ] **Step 4: Commit**

---

## Task 10: API routes — spools + issuance + print

**Goal:** REST endpoints for spool intake/dispose, BPR label issuance, and print job triggering (with adapter call).

**Files:**
- Modify: `server/routes.ts`
- Create: `server/__tests__/r04-spools-routes.test.ts`
- Create: `server/__tests__/r04-issuance-routes.test.ts`
- Create: `server/__tests__/r04-print-routes.test.ts`

**Acceptance Criteria:**
- [ ] `POST /api/label-spools` — F-04 ceremony, role gating
- [ ] `GET /api/label-spools?artworkId=...&status=ACTIVE`
- [ ] `POST /api/label-spools/:id/dispose` — F-04
- [ ] `POST /api/bpr/:id/issue-labels` — operational (no F-04), validates BPR state + spool state, returns issuance row
- [ ] `POST /api/bpr/:id/print-labels` — F-04 ceremony, calls `getLabelPrintAdapter()`, persists `label_print_jobs` row, returns job
- [ ] `GET /api/bpr/:id/labels` — returns issuance + print history (joined)
- [ ] Tests for `print-labels` use `setLabelPrintAdapter(new StubAdapter())` in `beforeAll`

**Verify:** `pnpm test server/__tests__/r04-{spools,issuance,print}-routes.test.ts -- --run` → PASS

**Steps:**

- [ ] **Step 1: Tests first** for all three route files.

- [ ] **Step 2: Implement routes.**

- [ ] **Step 3: Run tests, expect PASS**

- [ ] **Step 4: Commit**

---

## Task 11: API routes — reconciliation

**Goal:** Multipart endpoint at BPR close.

**Files:**
- Modify: `server/routes.ts`
- Create: `server/__tests__/r04-reconciliation-routes.test.ts`

**Acceptance Criteria:**
- [ ] `POST /api/bpr/:id/reconcile-labels` — multipart (proof file + JSON body), F-04 ceremony, calls `reconcileBpr` storage helper
- [ ] `GET /api/bpr/:id/reconciliation` — returns row or 404
- [ ] In-tolerance happy path returns 201 with row
- [ ] Out-of-tolerance without deviation → 409 `RECONCILIATION_OUT_OF_TOLERANCE`
- [ ] Out-of-tolerance with deviation → 201
- [ ] Double-submit → 409 `RECONCILIATION_ALREADY_EXISTS`
- [ ] Missing proof file → 400

**Verify:** `pnpm test server/__tests__/r04-reconciliation-routes.test.ts -- --run` → PASS

**Steps:**

- [ ] **Step 1: Tests first**

- [ ] **Step 2: Implement multipart route** — use existing multipart pattern from supplier documents (or add a minimal `multer`-equivalent using `req.body` if existing pattern uses base64-in-JSON; check supplier-document upload pattern first).

- [ ] **Step 3: Run tests, expect PASS**

- [ ] **Step 4: Commit**

---

## Task 12: API routes — SOPs

**Goal:** CRUD with QA approval ceremony.

**Files:**
- Modify: `server/routes.ts`
- Create: `server/storage/sops.ts`
- Create: `server/__tests__/r04-sops-routes.test.ts`

**Acceptance Criteria:**
- [ ] `POST /api/sops` — DRAFT
- [ ] `GET /api/sops?status=APPROVED` — filtered list
- [ ] `POST /api/sops/:id/approve` — F-04 (`SOP_APPROVED`)
- [ ] `POST /api/sops/:id/retire` — F-04 (`SOP_RETIRED`)
- [ ] BPR step update endpoint: if `sopCode` set, validates an APPROVED `(code, version)` row exists; rejects with 409 `SOP_NOT_APPROVED` otherwise
- [ ] Audit rows for all transitions

**Verify:** `pnpm test server/__tests__/r04-sops-routes.test.ts -- --run` → PASS

**Steps:**

- [ ] **Step 1: Tests first**

- [ ] **Step 2: Implement storage + routes + BPR-step extension validation**

- [ ] **Step 3: Run tests, expect PASS**

- [ ] **Step 4: Commit**

---

## Task 13: Frontend — Quality tab routing scaffold

**Goal:** New top-level "Quality" nav entry; subtab structure with placeholders for future R-05/R-06.

**Files:**
- Create: `client/src/pages/quality/index.tsx` (subtab nav)
- Create: `client/src/pages/quality/labeling.tsx` (placeholder during this task; filled in Task 14)
- Create: `client/src/pages/quality/sops.tsx` (placeholder; filled in Task 16)
- Modify: `client/src/App.tsx` (router wiring + nav entry)
- Modify: `client/src/components/MainLayout.tsx` or wherever the top nav lives (add "Quality" entry)

**Acceptance Criteria:**
- [ ] `/quality` redirects to `/quality/labeling`
- [ ] Subtab nav under Quality: Labeling, SOPs, (Complaints — disabled), (Returns — disabled), (Validation — disabled)
- [ ] Disabled placeholders carry data-testid and a "coming in R-05/R-06" tooltip
- [ ] Browser sanity-check: navigating to /quality renders without console errors

**Verify:** Manual: `pnpm dev`, navigate to /quality, confirm subtabs render. Run `pnpm tsc --noEmit` and `pnpm lint`.

**Steps:**

- [ ] **Step 1: Add nav entry** in the top-level layout component. Match existing entries (Dashboard, Inventory, ...).

- [ ] **Step 2: Create `client/src/pages/quality/index.tsx`** with subtab nav using shadcn Tabs component.

- [ ] **Step 3: Create placeholder labeling.tsx, sops.tsx**

- [ ] **Step 4: Wire router** in App.tsx for `/quality/labeling`, `/quality/sops`, with `/quality` redirect.

- [ ] **Step 5: Run typecheck + lint**

- [ ] **Step 6: Manual browser test**

- [ ] **Step 7: Commit**

---

## Task 14: Frontend — Labeling subtab (Artwork + Spools + Reconciliation queue)

**Goal:** Three nested tabs under /quality/labeling with full CRUD UI.

**Files:**
- Replace: `client/src/pages/quality/labeling.tsx` with the real UI (router for nested tabs)
- Create: `client/src/pages/quality/labeling/artwork.tsx`
- Create: `client/src/pages/quality/labeling/spools.tsx`
- Create: `client/src/pages/quality/labeling/reconciliation-queue.tsx`
- Create: `client/src/components/labeling/ArtworkCreateDialog.tsx`
- Create: `client/src/components/labeling/SpoolReceiveDialog.tsx`
- Create: `client/src/components/labeling/ApproveArtworkDialog.tsx` (F-04 ceremony)

**Acceptance Criteria:**
- [ ] Artwork tab: table with version, status badge, approved-at, approved-by; Create button; row click → detail dialog with Approve / Retire buttons (F-04)
- [ ] Spools tab: table grouped by artwork; columns spool#, qty on hand / initial, status, location, age; Receive button (F-04); Dispose action (F-04)
- [ ] Reconciliation queue tab: list of BPRs in IN_PROGRESS with their issuance + reconciliation status indicators; click → routes to BPR detail
- [ ] All file uploads use base64 client-side encode (matches existing supplier-document pattern)
- [ ] data-testid coverage on all interactive elements

**Verify:** Manual browser test of each subtab; `pnpm tsc --noEmit`; `pnpm lint`.

**Steps:**

- [ ] **Step 1: Implement Artwork subtab** (table + create + approve/retire dialogs). Use TanStack Query for list + mutations. F-04 dialogs use the existing `<SignatureDialog>` component.

- [ ] **Step 2: Implement Spools subtab**

- [ ] **Step 3: Implement Reconciliation queue subtab**

- [ ] **Step 4: Browser test**

- [ ] **Step 5: Commit**

---

## Task 15: Frontend — BPR detail integration (Issue + Print + Reconcile)

**Goal:** Three new sections on `/production/batches/:id` for the BPR labeling workflow.

**Files:**
- Modify: `client/src/pages/production.tsx` (or wherever BPR detail lives)
- Create: `client/src/components/labeling/IssueLabelsModal.tsx`
- Create: `client/src/components/labeling/PrintLabelsModal.tsx`
- Create: `client/src/components/labeling/ReconcileLabelsForm.tsx`

**Acceptance Criteria:**
- [ ] Section 1 (visible during IN_PROGRESS): "Issue labels" — modal with artwork picker (filters by current product) → spool picker (active only) → qty → submit. No signature required (operational).
- [ ] Section 2 (after issuance): per-issuance row, "Print" button → modal collects lot, expiry, qty → F-04 ceremony → result toast (success or failed-with-diagnostics)
- [ ] Section 3 (visible at close): Reconciliation form — applied/destroyed/returned numeric inputs, file upload (image/PDF), live variance display, deviation picker (visible if computed variance > tolerance threshold), F-04 submit
- [ ] Form blocks submission with helpful inline messages when 409 codes returned
- [ ] data-testid on all interactive elements

**Verify:** Manual end-to-end test of issue → print → reconcile → BPR complete in browser; `pnpm tsc --noEmit`; `pnpm lint`.

**Steps:**

- [ ] **Step 1: IssueLabelsModal**

- [ ] **Step 2: PrintLabelsModal**

- [ ] **Step 3: ReconcileLabelsForm**

- [ ] **Step 4: Wire into BPR detail page**

- [ ] **Step 5: Manual end-to-end browser test**

- [ ] **Step 6: Commit**

---

## Task 16: Frontend — SOPs subtab + BPR step citation UI

**Goal:** Plain CRUD table for SOPs + dropdown picker on BPR step editor.

**Files:**
- Replace: `client/src/pages/quality/sops.tsx` with real UI
- Modify: BPR step editor (add SOP code+version picker)

**Acceptance Criteria:**
- [ ] SOPs table: code, title, version, status, approved-at; Create / Approve / Retire actions
- [ ] BPR step editor: optional dropdown sourced from `GET /api/sops?status=APPROVED`
- [ ] Step save validates server-side (existing 409 surfaces as inline error)

**Verify:** Manual browser test; `pnpm tsc --noEmit`; `pnpm lint`.

**Steps:**

- [ ] **Step 1: SOPs CRUD**

- [ ] **Step 2: Step editor extension**

- [ ] **Step 3: Browser test**

- [ ] **Step 4: Commit**

---

## Task 17: Frontend — Dashboard cards

**Goal:** Two new dashboard cards mirroring R-03 patterns.

**Files:**
- Modify: `client/src/pages/dashboard.tsx`

**Acceptance Criteria:**
- [ ] "Label artwork pending QA" — count of `DRAFT` artworks; top 5 with deep-link to /quality/labeling/artwork?focus=<id>
- [ ] "Reconciliations out-of-tolerance" — count of BPRs with `toleranceExceeded=true` and no deviation; top 5 with deep-link to /production/batches/<id>
- [ ] Empty states ("All artwork approved.", "All reconciliations within tolerance.")
- [ ] data-testid on rows and cards

**Verify:** `pnpm tsc --noEmit`; `pnpm lint`; manual browser test.

**Steps:**

- [ ] **Step 1: Read existing R-03 calibration card pattern in dashboard.tsx**

- [ ] **Step 2: Add the two new cards using the same `useQueries` fan-out**

- [ ] **Step 3: Browser test**

- [ ] **Step 4: Commit**

---

## Task 18: Full integration suite + fixture updates

**Goal:** Run the full integration suite; add minimal label-cage fixtures for any pre-existing BPR test that now hits the new completion gate.

**Files:**
- Modify: any `server/__tests__/**/*.test.ts` whose BPR-completion path is now blocked

**Acceptance Criteria:**
- [ ] `pnpm test:integration` → all green (323 from baseline + new R-04 tests, 0 failures)
- [ ] Any BPR that completes in pre-existing tests gets a minimal reconciliation fixture (or the test sets up the gate-passing state explicitly)

**Verify:** `pnpm test:integration` → green

**Steps:**

- [ ] **Step 1: Run full suite, identify regressions**

- [ ] **Step 2: Patch each regressed test with minimal R-04 fixtures** — add an APPROVED artwork + ACTIVE spool + issuance row + reconciliation row inserted as part of the test setup so the BPR can complete.

- [ ] **Step 3: Re-run suite, expect all green**

- [ ] **Step 4: Commit**

---

## Task 19: Validation scaffold updates + VSR-R-04

**Goal:** Append URS rows for R-04 to `~/Desktop/NEUROGAN/FDA/validation-scaffold.md` and the matching traceability matrix rows.

**Files:**
- Modify: `~/Desktop/NEUROGAN/FDA/validation-scaffold.md`

**Acceptance Criteria:**
- [ ] URS rows replace existing R-04 placeholder lines:
  - URS-R-04-01-01 (artwork QA approval gate)
  - URS-R-04-01-02 (artwork retirement blocks new spools)
  - URS-R-04-02-01 (issuance recorded with spool decrement)
  - URS-R-04-02-02 (print events audited with adapter result)
  - URS-R-04-03-01 (reconciliation required at BPR close; out-of-tolerance requires deviation)
  - URS-R-04-04-01 (BPR steps cite APPROVED labeling/packaging SOP)
- [ ] Traceability matrix rows added matching each URS
- [ ] VSR-R-04 record creation deferred to UI per `feedback_avoid_manual_workflows` exception (VSR records are inherently QA-signed via the F-10 validation document UI)

**Verify:** Inspect file by hand; ensure no broken pipe rows.

**Steps:**

- [ ] **Step 1: Edit URS section** to replace the 4 R-04 placeholder rows with the 6 actual rows above

- [ ] **Step 2: Edit traceability matrix** — add row per URS-R-04-XX-YY between existing R-03 and R-05 rows

- [ ] **Step 3: Confirm with user** before VSR-R-04 record creation (per the deferred-to-UI decision in spec §11)

- [ ] **Step 4: No commit** — file is outside the worktree, not in this git repo (it lives at `~/Desktop/NEUROGAN/FDA/`).

---

## Task 20: Open PR

**Goal:** Push branch, open PR against `FDA-EQMS-feature-package` per `feedback_git_workflow`.

**Files:** —

**Acceptance Criteria:**
- [ ] Branch pushed to origin
- [ ] PR opened against `FDA-EQMS-feature-package`
- [ ] PR body summarizes scope (Obs 9 + Obs 10 closure), highlights the new Quality tab IA, and lists the test plan (manual checks for end-to-end issue→print→reconcile flow)
- [ ] CI lint/typecheck/integration green

**Verify:** `gh pr view` shows the PR; CI is green.

**Steps:**

- [ ] **Step 1: `git push -u origin ticket/r-04-labeling-reconciliation`**

- [ ] **Step 2: `gh pr create --base FDA-EQMS-feature-package` with summary + test plan**

- [ ] **Step 3: Post URL to user**
