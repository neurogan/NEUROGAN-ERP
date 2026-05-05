# iPad-02 Phase 2: Downstream Barcode Scanning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable lab and QC staff to scan box QR codes on iPad to mark boxes as sampled and navigate to QC review, with auto-advance of receiving record status.

**Architecture:** Four additive changes — DB migration adds `sampled_at`/`sampled_by_id` to `erp_receiving_boxes`; a `sampleBox()` storage method handles marking + auto-status-advance in one transaction; two new API routes expose the functionality; the `BoxScanner` component wraps `BarcodeDetector`/camera/text-fallback; and `ReceivingDetail` gains lab + QC scan buttons.

**Tech Stack:** Drizzle ORM (PostgreSQL), Express, React + TanStack Query, `qrcode` npm package (HTML preview QR), ZPL `^BQ` command (Zebra printer QR), native `BarcodeDetector` API (Safari 17+ / iPad A16), shadcn/ui Sheet

---

## Files

| File | Change |
|---|---|
| `migrations/0040_receiving_boxes_sampling.sql` | New — add `sampled_at`, `sampled_by_id` columns |
| `shared/schema.ts` | Add `sampledAt`, `sampledById` to `receivingBoxes` table + `ReceivingBoxWithSampler` type |
| `server/db-storage.ts` | Add `sampleBox()` + `getBoxByLabel()` + update `getReceivingBoxes()` to join sampler name |
| `server/routes.ts` | Add `PATCH /api/receiving/boxes/:id/sample` + `GET /api/receiving/boxes/by-label/:label` |
| `client/src/lib/zebra-print.ts` | Add `^BQ` QR code to ZPL; remove `QUARANTINE - DO NOT USE` text |
| `client/src/components/receiving/ReceivingLabelDrawer.tsx` | Add QR image to HTML preview per box |
| `client/src/components/receiving/BoxScanner.tsx` | New — camera sheet with `BarcodeDetector` + text-input fallback |
| `client/src/pages/receiving.tsx` | Lab + QC scan buttons, box list with sampled state, pass `setSelectedId` to `ReceivingDetail` |

---

### Task 1: DB Migration + Schema Types

**Goal:** Add `sampled_at` and `sampled_by_id` columns to `erp_receiving_boxes` and update the Drizzle schema.

**Files:**
- Create: `migrations/0040_receiving_boxes_sampling.sql`
- Modify: `shared/schema.ts` (lines 112–120, and the `ReceivingBox` type region ~line 642)

**Acceptance Criteria:**
- [ ] Migration SQL creates the two columns with correct types
- [ ] `receivingBoxes` pgTable definition includes `sampledAt` and `sampledById`
- [ ] `ReceivingBoxWithSampler` type is exported with `sampledByName: string | null`
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → 0 errors

**Steps:**

- [ ] **Step 1: Create migration file**

Create `migrations/0040_receiving_boxes_sampling.sql`:

```sql
-- 0040_receiving_boxes_sampling
-- Add sampling tracking to per-box records.
-- sampled_at: when the lab physically sampled this box (null until scanned).
-- sampled_by_id: FK to erp_users.id — who scanned it.

ALTER TABLE erp_receiving_boxes
  ADD COLUMN sampled_at    TIMESTAMPTZ,
  ADD COLUMN sampled_by_id UUID REFERENCES erp_users(id);
```

- [ ] **Step 2: Update `receivingBoxes` table definition in `shared/schema.ts`**

Current (lines 112–120):
```ts
export const receivingBoxes = pgTable("erp_receiving_boxes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  receivingRecordId: varchar("receiving_record_id").notNull().references(() => receivingRecords.id, { onDelete: "cascade" }),
  boxNumber: integer("box_number").notNull(),
  boxLabel: text("box_label").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  uniqRecordBox: uniqueIndex("erp_receiving_boxes_record_box_uq").on(t.receivingRecordId, t.boxNumber),
}));
```

Replace with:
```ts
export const receivingBoxes = pgTable("erp_receiving_boxes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  receivingRecordId: varchar("receiving_record_id").notNull().references(() => receivingRecords.id, { onDelete: "cascade" }),
  boxNumber: integer("box_number").notNull(),
  boxLabel: text("box_label").notNull(),
  sampledAt: timestamp("sampled_at", { withTimezone: true }),
  sampledById: uuid("sampled_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  uniqRecordBox: uniqueIndex("erp_receiving_boxes_record_box_uq").on(t.receivingRecordId, t.boxNumber),
}));
```

- [ ] **Step 3: Add `ReceivingBoxWithSampler` type near line 642**

After the `ReceivingBox` and `InsertReceivingBox` type exports, add:

```ts
export type ReceivingBoxWithSampler = ReceivingBox & {
  sampledByName: string | null;
};
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add migrations/0040_receiving_boxes_sampling.sql shared/schema.ts
git commit -m "feat(ipad-02-p2): add sampled_at, sampled_by_id to erp_receiving_boxes"
```

---

### Task 2: Storage Layer — sampleBox() + getBoxByLabel() + updated getReceivingBoxes()

**Goal:** Implement the three storage methods that power the scan endpoints.

**Files:**
- Modify: `server/db-storage.ts` — add after `getReceivingBoxes()` (~line 1916)

**Acceptance Criteria:**
- [ ] `sampleBox(boxId, userId)` marks box, auto-advances QUARANTINED→SAMPLING and SAMPLING→PENDING_QC in one transaction
- [ ] `sampleBox()` handles sampleSize=1 edge case (one scan can advance QUARANTINED→SAMPLING→PENDING_QC in same transaction)
- [ ] `sampleBox()` throws 404 if box not found, 409 if already sampled
- [ ] `getBoxByLabel(label)` returns `{ box, receivingRecord }` or undefined
- [ ] `getReceivingBoxes()` returns `ReceivingBoxWithSampler[]` with sampler full name joined
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → 0 errors

**Steps:**

- [ ] **Step 1: Update `getReceivingBoxes()` to join sampler name**

Find `getReceivingBoxes` (~line 1912):
```ts
async getReceivingBoxes(receivingRecordId: string): Promise<ReceivingBox[]> {
  return db.select().from(schema.receivingBoxes)
    .where(eq(schema.receivingBoxes.receivingRecordId, receivingRecordId))
    .orderBy(schema.receivingBoxes.boxNumber);
}
```

Replace with:
```ts
async getReceivingBoxes(receivingRecordId: string): Promise<schema.ReceivingBoxWithSampler[]> {
  const rows = await db
    .select({
      ...getTableColumns(schema.receivingBoxes),
      sampledByName: schema.users.fullName,
    })
    .from(schema.receivingBoxes)
    .leftJoin(schema.users, eq(schema.receivingBoxes.sampledById, schema.users.id))
    .where(eq(schema.receivingBoxes.receivingRecordId, receivingRecordId))
    .orderBy(schema.receivingBoxes.boxNumber);
  return rows.map((r) => ({ ...r, sampledByName: r.sampledByName ?? null }));
}
```

- [ ] **Step 2: Add `getBoxByLabel()` after `getReceivingBoxes()`**

```ts
async getBoxByLabel(label: string): Promise<{ box: schema.ReceivingBox; receivingRecord: schema.ReceivingRecord } | undefined> {
  const [box] = await db
    .select()
    .from(schema.receivingBoxes)
    .where(eq(schema.receivingBoxes.boxLabel, label));
  if (!box) return undefined;

  const [receivingRecord] = await db
    .select()
    .from(schema.receivingRecords)
    .where(eq(schema.receivingRecords.id, box.receivingRecordId));
  if (!receivingRecord) return undefined;

  return { box, receivingRecord };
}
```

- [ ] **Step 3: Add `sampleBox()` after `getBoxByLabel()`**

```ts
async sampleBox(boxId: string, userId: string): Promise<schema.ReceivingRecord> {
  return db.transaction(async (tx) => {
    const [box] = await tx
      .select()
      .from(schema.receivingBoxes)
      .where(eq(schema.receivingBoxes.id, boxId));
    if (!box) throw Object.assign(new Error("Box not found"), { status: 404 });
    if (box.sampledAt) throw Object.assign(new Error("Box already sampled"), { status: 409 });

    const [record] = await tx
      .select()
      .from(schema.receivingRecords)
      .where(eq(schema.receivingRecords.id, box.receivingRecordId));
    if (!record) throw Object.assign(new Error("Receiving record not found"), { status: 404 });

    // Mark this box sampled
    await tx
      .update(schema.receivingBoxes)
      .set({ sampledAt: new Date(), sampledById: userId })
      .where(eq(schema.receivingBoxes.id, boxId));

    // Count total sampled boxes for this record (including the one we just marked)
    const [{ count }] = await tx
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(schema.receivingBoxes)
      .where(
        and(
          eq(schema.receivingBoxes.receivingRecordId, record.id),
          isNotNull(schema.receivingBoxes.sampledAt),
        ),
      );

    let currentStatus = record.status;

    // QUARANTINED → SAMPLING on first scan
    if (currentStatus === "QUARANTINED") {
      assertValidTransition("receiving_record", currentStatus, "SAMPLING");
      await tx
        .update(schema.receivingRecords)
        .set({ status: "SAMPLING", updatedAt: new Date() })
        .where(eq(schema.receivingRecords.id, record.id));
      currentStatus = "SAMPLING";
    }

    // SAMPLING → PENDING_QC when sampledCount >= sampleSize (only if samplingPlan exists)
    if (
      currentStatus === "SAMPLING" &&
      record.samplingPlan !== null &&
      count >= record.samplingPlan.sampleSize
    ) {
      assertValidTransition("receiving_record", currentStatus, "PENDING_QC");
      const [updated] = await tx
        .update(schema.receivingRecords)
        .set({ status: "PENDING_QC", updatedAt: new Date() })
        .where(eq(schema.receivingRecords.id, record.id))
        .returning();
      return updated!;
    }

    // Return the current state of the record
    const [updated] = await tx
      .select()
      .from(schema.receivingRecords)
      .where(eq(schema.receivingRecords.id, record.id));
    return updated!;
  });
}
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add server/db-storage.ts
git commit -m "feat(ipad-02-p2): add sampleBox(), getBoxByLabel(), update getReceivingBoxes() with sampler join"
```

---

### Task 3: API Routes — PATCH sample + GET by-label

**Goal:** Expose the two endpoints the client needs for the scan flows.

**Files:**
- Modify: `server/routes.ts` — add after the `GET /api/receiving/:id/boxes` route (~line 1239)

**Acceptance Criteria:**
- [ ] `PATCH /api/receiving/boxes/:id/sample` requires auth + WAREHOUSE/LAB_TECH/QA role; returns updated receiving record
- [ ] `GET /api/receiving/boxes/by-label/:label` requires auth; URL-decodes the label before lookup
- [ ] Both routes use `next(err)` for error propagation
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → 0 errors

**Steps:**

- [ ] **Step 1: Add the two routes in `server/routes.ts`**

Find the block ending with `GET /api/receiving/:id/boxes` (around line 1239) and insert after it:

```ts
  app.patch<{ id: string }>(
    "/api/receiving/boxes/:id/sample",
    requireAuth,
    requireRole("WAREHOUSE", "LAB_TECH", "QA"),
    async (req, res, next) => {
      try {
        const record = await storage.sampleBox(req.params.id, req.user!.id);
        res.json(record);
      } catch (err) {
        next(err);
      }
    },
  );

  app.get<{ label: string }>(
    "/api/receiving/boxes/by-label/:label",
    requireAuth,
    async (req, res, next) => {
      try {
        const label = decodeURIComponent(req.params.label);
        const result = await storage.getBoxByLabel(label);
        if (!result) return res.status(404).json({ message: "Box not found — check the label and try again" });
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add server/routes.ts
git commit -m "feat(ipad-02-p2): add PATCH /api/receiving/boxes/:id/sample and GET /api/receiving/boxes/by-label/:label"
```

---

### Task 4: QR Code on Labels (ZPL + HTML Preview)

**Goal:** Add a QR code encoding the box label to each printed Zebra label and to the HTML preview in the drawer. Also remove the stale "QUARANTINE — DO NOT USE" ZPL text.

**Files:**
- Modify: `client/src/lib/zebra-print.ts` — add `^BQ` QR code field, remove QUARANTINE text
- Modify: `client/src/components/receiving/ReceivingLabelDrawer.tsx` — add QR image to HTML preview

**Acceptance Criteria:**
- [ ] `buildZpl()` output includes a `^BQ` QR code field encoding `box.boxLabel`
- [ ] `buildZpl()` no longer contains "QUARANTINE - DO NOT USE"
- [ ] HTML preview drawer shows a QR code image for the first box of each job
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → 0 errors

**Steps:**

- [ ] **Step 1: Install `qrcode` package**

```bash
pnpm add qrcode
pnpm add -D @types/qrcode
```

- [ ] **Step 2: Update `buildZpl()` in `client/src/lib/zebra-print.ts`**

Current `buildZpl()`:
```ts
export function buildZpl(box: BoxLabelData): string {
  return [
    "^XA",
    "^PW1015",
    "^LL1421",
    `^FO40,40^A0N,60,60^FD${box.componentName}^FS`,
    `^FO40,120^A0N,36,36^FDLot: ${box.receivingUniqueId}^FS`,
    `^FO40,165^A0N,36,36^FDSupplier lot: ${box.supplierLotNumber}^FS`,
    `^FO40,210^A0N,36,36^FDSupplier: ${box.supplierName}^FS`,
    `^FO40,255^A0N,36,36^FDPO: ${box.poNumber}^FS`,
    `^FO40,300^A0N,36,36^FDReceived: ${box.dateReceived}^FS`,
    `^FO40,380^BY3,2,120^BCN,,Y,N,N^FD${box.boxLabel}^FS`,
    `^FO40,540^A0N,44,44^FDBox ${box.boxNumber} of ${box.boxCount}^FS`,
    "^FO40,610^FR^A0N,40,40^FDQUARANTINE - DO NOT USE^FS",
    "^XZ",
  ].join("\n");
}
```

Replace with:
```ts
export function buildZpl(box: BoxLabelData): string {
  return [
    "^XA",
    "^PW1015",
    "^LL1421",
    // QR code — upper right, 5-dot magnification (~145×145 dots for typical box labels)
    `^FO640,40^BQN,2,5^FDMM,A${box.boxLabel}^FS`,
    `^FO40,40^A0N,60,60^FD${box.componentName}^FS`,
    `^FO40,120^A0N,36,36^FDLot: ${box.receivingUniqueId}^FS`,
    `^FO40,165^A0N,36,36^FDSupplier lot: ${box.supplierLotNumber}^FS`,
    `^FO40,210^A0N,36,36^FDSupplier: ${box.supplierName}^FS`,
    `^FO40,255^A0N,36,36^FDPO: ${box.poNumber}^FS`,
    `^FO40,300^A0N,36,36^FDReceived: ${box.dateReceived}^FS`,
    `^FO40,380^BY3,2,120^BCN,,Y,N,N^FD${box.boxLabel}^FS`,
    `^FO40,540^A0N,44,44^FDBox ${box.boxNumber} of ${box.boxCount}^FS`,
    "^XZ",
  ].join("\n");
}
```

- [ ] **Step 3: Add QR image to HTML preview in `ReceivingLabelDrawer.tsx`**

Add the import at the top of the file:
```ts
import QRCode from "qrcode";
```

Add a state variable after the existing `useState` declarations (inside `ReceivingLabelDrawer`):
```ts
const [qrUrls, setQrUrls] = useState<Record<string, string>>({});
```

Add a `useEffect` to generate QR data URLs when the drawer opens (after the existing state declarations):
```ts
useEffect(() => {
  if (!open) return;
  const allLabels = jobs.flatMap((j) => j.boxes.map((b) => b.boxLabel));
  Promise.all(
    allLabels.map((label) =>
      QRCode.toDataURL(label, { width: 100, margin: 1 }).then((url) => [label, url] as const),
    ),
  ).then((entries) => setQrUrls(Object.fromEntries(entries)));
}, [open, jobs]);
```

In the HTML preview section, find the block that renders the first box label (around line 204–212):

```tsx
{firstBox && (
  <div className="mt-1 rounded bg-muted px-2 py-1 font-mono tracking-widest text-center">
    {firstBox.boxLabel}
  </div>
)}
<div className="text-muted-foreground">
  Box 1 of {job.boxes.length}
</div>
```

Replace with:
```tsx
{firstBox && (
  <div className="mt-1 flex items-center gap-3">
    {qrUrls[firstBox.boxLabel] && (
      <img
        src={qrUrls[firstBox.boxLabel]}
        alt={`QR: ${firstBox.boxLabel}`}
        className="w-20 h-20 border border-border rounded"
      />
    )}
    <div>
      <div className="rounded bg-muted px-2 py-1 font-mono tracking-widest text-center text-[10px]">
        {firstBox.boxLabel}
      </div>
      <div className="text-muted-foreground mt-1">
        Box 1 of {job.boxes.length}
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/zebra-print.ts client/src/components/receiving/ReceivingLabelDrawer.tsx package.json pnpm-lock.yaml
git commit -m "feat(ipad-02-p2): add QR code to ZPL labels and HTML preview; remove QUARANTINE text from ZPL"
```

---

### Task 5: BoxScanner Component

**Goal:** Build a reusable Sheet component that opens the iPad camera, detects QR codes via `BarcodeDetector`, calls `onScan(label)` on success, and falls back to a text input if camera is unavailable.

**Files:**
- Create: `client/src/components/receiving/BoxScanner.tsx`

**Acceptance Criteria:**
- [ ] Attempts `BarcodeDetector` camera scan when opened
- [ ] Falls back to text input immediately if `BarcodeDetector` is unsupported or camera permission denied
- [ ] Calls `onScan(label: string)` with the decoded box label string
- [ ] Shows error message prop below the input/scan area
- [ ] Closes on successful scan (parent decides whether to keep open on error)
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → 0 errors

**Steps:**

- [ ] **Step 1: Create `client/src/components/receiving/BoxScanner.tsx`**

```tsx
import { useState, useEffect, useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, QrCode, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onScan: (label: string) => void;
  error?: string;
  isPending?: boolean;
}

// BarcodeDetector is available in Safari 17+ (iPad A16) and Chrome 88+.
// Declared here to avoid TypeScript "not defined" errors on older target libs.
declare class BarcodeDetector {
  static getSupportedFormats(): Promise<string[]>;
  constructor(opts: { formats: string[] });
  detect(image: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]>;
}

export function BoxScanner({ open, onOpenChange, title, onScan, error, isPending }: Props) {
  const [mode, setMode] = useState<"camera" | "text">("camera");
  const [textValue, setTextValue] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);

  // Determine whether to use camera or text fallback when sheet opens
  useEffect(() => {
    if (!open) return;
    setTextValue("");
    setCameraError(null);

    const tryCamera = async () => {
      if (typeof BarcodeDetector === "undefined") {
        setMode("text");
        return;
      }
      try {
        const formats = await BarcodeDetector.getSupportedFormats();
        if (!formats.includes("qr_code")) {
          setMode("text");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        streamRef.current = stream;
        setMode("camera");
      } catch {
        setMode("text");
      }
    };

    tryCamera();
  }, [open]);

  // Start scanning frames once video is playing
  useEffect(() => {
    if (mode !== "camera" || !open) return;
    const video = videoRef.current;
    if (!video || !streamRef.current) return;

    video.srcObject = streamRef.current;
    video.play().catch(() => setMode("text"));

    const detector = new BarcodeDetector({ formats: ["qr_code"] });

    const scan = async () => {
      if (video.readyState >= 2) {
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0 && barcodes[0]) {
            stopCamera();
            onScan(barcodes[0].rawValue);
            onOpenChange(false);
            return;
          }
        } catch {
          // detection errors are transient — keep scanning
        }
      }
      animFrameRef.current = requestAnimationFrame(scan);
    };

    animFrameRef.current = requestAnimationFrame(scan);
    return stopCamera;
  }, [mode, open]);

  // Stop camera on close
  useEffect(() => {
    if (!open) stopCamera();
  }, [open]);

  function stopCamera() {
    cancelAnimationFrame(animFrameRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function handleTextSubmit() {
    const label = textValue.trim();
    if (!label) return;
    onScan(label);
    setTextValue("");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85vh] flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            {title}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-4">
          {mode === "camera" ? (
            <>
              <div className="relative w-full max-w-sm aspect-square rounded-lg overflow-hidden border-2 border-primary/40 bg-black">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                  muted
                />
                {/* Scan crosshair overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-48 border-2 border-white/70 rounded-md" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Point the camera at the QR code on the box label
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { stopCamera(); setMode("text"); }}
              >
                Enter label manually instead
              </Button>
            </>
          ) : (
            <>
              <Camera className="h-12 w-12 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground text-center">
                {cameraError ?? "Camera not available — enter the box label manually"}
              </p>
              <div className="w-full max-w-sm space-y-2">
                <Label className="text-sm">Box Label</Label>
                <Input
                  autoFocus
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleTextSubmit(); }}
                  placeholder="e.g. RCV-20260505-001-BOX-01"
                  className="font-mono"
                  data-testid="input-box-label-fallback"
                />
              </div>
              <Button
                onClick={handleTextSubmit}
                disabled={!textValue.trim() || isPending}
                className="w-full max-w-sm"
                data-testid="button-submit-box-label"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Submit
              </Button>
            </>
          )}

          {error && (
            <p className="text-sm text-destructive text-center" data-testid="text-scanner-error">
              {error}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add client/src/components/receiving/BoxScanner.tsx
git commit -m "feat(ipad-02-p2): add BoxScanner component with BarcodeDetector + text fallback"
```

---

### Task 6: Wire Scan Buttons + Box List into ReceivingDetail

**Goal:** Add "Mark Box Sampled" (lab) and "Scan Box" (QC) buttons to `ReceivingDetail`, fetch and display boxes with sampled state, and pass `setSelectedId` for QC navigation to a different record.

**Files:**
- Modify: `client/src/pages/receiving.tsx`

**Acceptance Criteria:**
- [ ] `ReceivingDetail` receives `onNavigateTo: (id: string) => void` prop
- [ ] Box list renders for QUARANTINED/SAMPLING/PENDING_QC records, showing sampled state
- [ ] "Mark Box Sampled" button visible for QUARANTINED/SAMPLING records, requires WAREHOUSE/LAB_TECH/QA role
- [ ] Lab scan flow: QR detected → lookup by label → validate same record → PATCH sample → cache invalidated
- [ ] "Scan Box" button visible for PENDING_QC records, requires QA role
- [ ] QC scan flow: QR detected → lookup by label → if same record scroll to QC section; if different record navigate to it
- [ ] All error conditions from spec show appropriate error text in scanner
- [ ] Font sizes on "Awaiting Receipt" PO list items bumped (pending tweak from last PR)
- [ ] `pnpm typecheck` passes

**Verify:** `pnpm typecheck` → 0 errors

**Steps:**

- [ ] **Step 1: Add new imports at the top of `receiving.tsx`**

Add to the existing imports block:

```ts
import { useAuth } from "@/lib/auth";
import { BoxScanner } from "@/components/receiving/BoxScanner";
import type { ReceivingBoxWithSampler } from "@shared/schema";
```

- [ ] **Step 2: Add `onNavigateTo` prop to `ReceivingDetail` and its internal logic**

Update the function signature at line ~499:
```ts
function ReceivingDetail({
  record,
  onUpdated,
  onNavigateTo,
}: {
  record: ReceivingRecordWithDetails;
  onUpdated: () => void;
  onNavigateTo: (id: string) => void;
}) {
```

Inside `ReceivingDetail`, after the existing state declarations, add:
```ts
const { user } = useAuth();
const userRoles = user?.roles ?? [];
const canSampleBox = userRoles.some((r) => ["WAREHOUSE", "LAB_TECH", "QA"].includes(r));
const canQcScan = userRoles.includes("QA");

const isSamplingActive = record.status === "QUARANTINED" || record.status === "SAMPLING";

// BoxScanner state
const [scannerOpen, setScannerOpen] = useState(false);
const [scannerTitle, setScannerTitle] = useState("");
const [scannerMode, setScannerMode] = useState<"lab" | "qc">("lab");
const [scanError, setScanError] = useState<string | undefined>();

// Box list query
const { data: boxes = [] } = useQuery<ReceivingBoxWithSampler[]>({
  queryKey: [`/api/receiving/${record.id}/boxes`],
  enabled: isSamplingActive || record.status === "PENDING_QC",
});

const qcReviewRef = useRef<HTMLDivElement>(null);
```

Also add `useRef` to the existing React import if not present.

- [ ] **Step 3: Add lab and QC scan mutations**

After the existing `submitQcReview` mutation, add:

```ts
const sampleBoxMutation = useMutation({
  mutationFn: async (boxId: string) => {
    const res = await apiRequest("PATCH", `/api/receiving/boxes/${boxId}/sample`, {});
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { message?: string }).message ?? "Failed to mark box sampled");
    }
    return res.json();
  },
  onSuccess: () => {
    setScannerOpen(false);
    setScanError(undefined);
    queryClient.invalidateQueries({ queryKey: ["/api/receiving"] });
    queryClient.invalidateQueries({ queryKey: [`/api/receiving/${record.id}/boxes`] });
    onUpdated();
  },
  onError: (err: Error) => {
    setScanError(err.message);
  },
});

async function handleLabScan(label: string) {
  setScanError(undefined);
  try {
    const res = await apiRequest("GET", `/api/receiving/boxes/by-label/${encodeURIComponent(label)}`, undefined);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setScanError((body as { message?: string }).message ?? "Box not found — check the label and try again");
      return;
    }
    const { box, receivingRecord } = await res.json() as { box: ReceivingBoxWithSampler; receivingRecord: { id: string } };
    if (receivingRecord.id !== record.id) {
      setScanError("This box belongs to a different lot");
      return;
    }
    if (box.sampledAt) {
      const byName = box.sampledByName ?? "unknown";
      const atDate = new Date(box.sampledAt).toLocaleDateString();
      setScanError(`Already marked as sampled by ${byName} on ${atDate}`);
      return;
    }
    sampleBoxMutation.mutate(box.id);
  } catch {
    setScanError("Network error — please try again");
  }
}

async function handleQcScan(label: string) {
  setScanError(undefined);
  try {
    const res = await apiRequest("GET", `/api/receiving/boxes/by-label/${encodeURIComponent(label)}`, undefined);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setScanError((body as { message?: string }).message ?? "Box not found — check the label and try again");
      return;
    }
    const { receivingRecord } = await res.json() as { receivingRecord: { id: string; status: string } };
    if (receivingRecord.status !== "PENDING_QC") {
      setScanError(`This lot is not ready for QC review (status: ${receivingRecord.status})`);
      return;
    }
    setScannerOpen(false);
    if (receivingRecord.id !== record.id) {
      onNavigateTo(receivingRecord.id);
    } else {
      qcReviewRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  } catch {
    setScanError("Network error — please try again");
  }
}
```

- [ ] **Step 4: Add box list section to the JSX**

In the JSX, after the Visual Inspection section and before the QC Review section (find the `{/* QC Review section */}` comment), add a new section:

```tsx
{/* Box Sampling section */}
{(isSamplingActive || record.status === "PENDING_QC") && (
  <>
    <Separator />
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <QrCode className="h-4 w-4 text-muted-foreground" />
          Boxes
          {record.samplingPlan && (
            <span className="text-xs font-normal text-muted-foreground">
              ({boxes.filter((b) => b.sampledAt).length} / {record.samplingPlan.sampleSize} sampled)
            </span>
          )}
        </h3>
        <div className="flex gap-2">
          {canSampleBox && isSamplingActive && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setScannerTitle("Mark Box Sampled");
                setScannerMode("lab");
                setScanError(undefined);
                setScannerOpen(true);
              }}
              data-testid="button-mark-box-sampled"
            >
              <QrCode className="h-3.5 w-3.5 mr-1.5" />
              Mark Box Sampled
            </Button>
          )}
          {canQcScan && record.status === "PENDING_QC" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setScannerTitle("Scan Box for QC");
                setScannerMode("qc");
                setScanError(undefined);
                setScannerOpen(true);
              }}
              data-testid="button-scan-box-qc"
            >
              <QrCode className="h-3.5 w-3.5 mr-1.5" />
              Scan Box
            </Button>
          )}
        </div>
      </div>

      {boxes.length > 0 ? (
        <div className="space-y-1">
          {boxes.map((box) => (
            <div
              key={box.id}
              className="flex items-center justify-between rounded border border-border px-3 py-2 text-xs"
            >
              <span className="font-mono text-foreground">{box.boxLabel}</span>
              {box.sampledAt ? (
                <span className="text-emerald-600 dark:text-emerald-400">
                  ✓ Sampled {box.sampledByName ? `by ${box.sampledByName}` : ""}
                </span>
              ) : (
                <span className="text-muted-foreground">Not sampled</span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No boxes recorded for this lot.</p>
      )}
    </div>
  </>
)}
```

- [ ] **Step 5: Add `ref` to QC Review section and `BoxScanner` at the end of `ReceivingDetail` JSX**

Find the QC Review section heading `<div data-tour="receiving-qc-review">` and add `ref={qcReviewRef}`:
```tsx
<div data-tour="receiving-qc-review" ref={qcReviewRef}>
```

At the end of the returned JSX (before the closing `</div>` of the top-level container), add:
```tsx
<BoxScanner
  open={scannerOpen}
  onOpenChange={setScannerOpen}
  title={scannerTitle}
  onScan={scannerMode === "lab" ? handleLabScan : handleQcScan}
  error={scanError}
  isPending={sampleBoxMutation.isPending}
/>
```

- [ ] **Step 6: Pass `onNavigateTo` when rendering `ReceivingDetail` in the main `Receiving()` component**

Find the `<ReceivingDetail>` usage (~line 1122):
```tsx
<ReceivingDetail
  key={selectedRecord.id + ":" + selectedRecord.status}
  record={selectedRecord}
  onUpdated={handleUpdated}
/>
```

Replace with:
```tsx
<ReceivingDetail
  key={selectedRecord.id + ":" + selectedRecord.status}
  record={selectedRecord}
  onUpdated={handleUpdated}
  onNavigateTo={(id) => setSelectedId(id)}
/>
```

- [ ] **Step 7: Fix "Awaiting Receipt" PO list font sizes (pending tweak)**

Find the submitted POs map section (~line 1075). Look for `text-sm font-medium font-mono` on the PO number and `text-xs` on supplier name. Bump these:

```tsx
// PO number: change text-sm → text-base
// Supplier name: change text-xs → text-sm
```

Find the actual elements in the `submittedPOs.map(...)` block and update the class names accordingly.

- [ ] **Step 8: Add `QrCode` to the lucide-react import**

Find the lucide-react import line and add `QrCode` to it.

- [ ] **Step 9: Verify**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 10: Commit**

```bash
git add client/src/pages/receiving.tsx
git commit -m "feat(ipad-02-p2): wire BoxScanner into ReceivingDetail — lab sample + QC scan flows, box list"
```

---

## Manual Testing Checklist

After all tasks are implemented and the dev server is running:

1. Create a receiving record with 3 boxes (`samplingPlan.sampleSize = 3`) → confirm each label preview shows a unique QR code (open the label drawer)
2. Confirm ZPL output in the browser console or via test print no longer contains "QUARANTINE - DO NOT USE"
3. Open Receiving detail on a QUARANTINED record → "Mark Box Sampled" button visible
4. Click "Mark Box Sampled" → scanner opens → type BOX-01 label in text fallback → record advances to SAMPLING, box shows ✓ Sampled
5. Scan BOX-02 → still SAMPLING
6. Scan BOX-03 → record auto-advances to PENDING_QC
7. Attempt to scan BOX-01 again → "Already marked as sampled by..." error shown
8. On a PENDING_QC record → "Scan Box" button visible → scan a box → scrolls to QC Review section
9. Scan a box from a different PENDING_QC record → navigates to that record
10. Deny camera permission → text input fallback appears immediately
11. Enter unknown label in text fallback → "Box not found" error shown
12. Check Awaiting Receipt PO list font sizes look appropriate on iPad
