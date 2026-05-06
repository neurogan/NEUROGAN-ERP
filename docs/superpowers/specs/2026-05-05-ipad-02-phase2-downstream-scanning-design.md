# iPad-02 Phase 2: Downstream Barcode Scanning Design

**Date:** 2026-05-05  
**Ticket:** iPad-02 phase 2  
**Status:** Approved

## Goal

Enable lab and QC staff to scan physical box QR codes on iPad to mark boxes as sampled and navigate to QC review, replacing manual record lookup on the warehouse floor.

## Architecture

Four additive changes — no existing flows are restructured:

1. **QR codes on labels** — add QR code image to the HTML label preview (using `qrcode` npm package) and to the ZPL print template (`^BQ` command). QR encodes the box label string (e.g. `RCV-20260505-001-BOX-01`) — the box's existing unique identifier. Each of the 10 boxes in a 10-box lot gets a unique QR pointing to its own DB row.

2. **DB additions** — add `sampled_at` (timestamp) and `sampled_by_id` (varchar FK → users) to `erp_receiving_boxes`. No new table. Status auto-advance logic computes `COUNT(sampled_at IS NOT NULL)` vs `samplingPlan.sampleSize` on the parent receiving record.

3. **`<BoxScanner>` component** — reusable Sheet component that opens iPad camera, runs `BarcodeDetector` on frames to detect QR codes, calls `onScan(boxLabel: string)` on success. Falls back to a text input immediately if `BarcodeDetector` is unsupported or camera permission is denied.

4. **Two scan actions in `ReceivingDetail`**:
   - **Lab — "Mark Box Sampled"**: visible when record status is QUARANTINED or SAMPLING, roles RECEIVING + QA.
   - **QC — "Scan Box"**: visible when record status is PENDING_QC, role QA only.

## Status Auto-Advance Rules

Per FDA build spec (already in codebase, `receivingRecords.samplingPlan`):
- First box scanned on a QUARANTINED record → advance record to `SAMPLING`
- `sampledCount >= samplingPlan.sampleSize` → advance record to `PENDING_QC`
- If `samplingPlan` is null → advance to SAMPLING on first scan, but never auto-advance to PENDING_QC (manual QC action required)

Both transitions happen server-side in the same transaction as the box update. No manual status button needed.

## Data Model

### `erp_receiving_boxes` additions
```sql
sampled_at    TIMESTAMPTZ  -- null until lab scans this box
sampled_by_id VARCHAR      -- FK to users.id, null until sampled
```

## API

### `PATCH /api/receiving/boxes/:id/sample`
- Auth: RECEIVING or QA role
- Body: none (user from session)
- Sets `sampled_at = NOW()`, `sampled_by_id = req.user.id`
- Runs auto-advance logic in transaction
- Returns updated receiving record

### `GET /api/receiving/boxes/by-label/:label`
- Auth: any authenticated user
- URL-decodes label, looks up box + parent receiving record
- Returns `{ box, receivingRecord }`

## Data Flow

**Lab scan:**
1. "Mark Box Sampled" button → `BoxScanner` opens
2. QR detected → `GET /api/receiving/boxes/by-label/:label`
3. Validate box belongs to current record; check not already sampled
4. `PATCH /api/receiving/boxes/:id/sample`
5. Server marks box, counts sampled boxes, auto-advances status
6. UI cache invalidated → detail refreshes

**QC scan:**
1. "Scan Box" button → `BoxScanner` opens
2. QR detected → `GET /api/receiving/boxes/by-label/:label`
3. Validate record is PENDING_QC
4. If different record → `setSelectedId` to navigate there
5. Scroll QC review section into view
6. Existing disposition + signature flow unchanged

## Error Handling

| Condition | Response |
|---|---|
| `BarcodeDetector` not supported | Show text input immediately |
| Camera permission denied | Show text input fallback |
| Unknown box label | "Box not found — check the label and try again" |
| Box belongs to different record (lab) | "This box belongs to a different lot" |
| Box already sampled | "Already marked as sampled by [name] on [date]" |
| Record not PENDING_QC (QC scan) | "This lot is not ready for QC review (status: X)" |
| Network error | Toast with retry |

## Files

| File | Change |
|---|---|
| `shared/schema.ts` | Add `sampledAt`, `sampledById` to `receivingBoxes` |
| `server/db-storage.ts` | `sampleBox()` — mark box + auto-advance record status |
| `server/routes.ts` | `PATCH /api/receiving/boxes/:id/sample` + `GET /api/receiving/boxes/by-label/:label` |
| `client/src/components/receiving/ReceivingLabelDrawer.tsx` | Add QR image to HTML preview + ZPL `^BQ` command |
| `client/src/components/receiving/BoxScanner.tsx` | New — camera sheet, `BarcodeDetector`, text fallback |
| `client/src/pages/receiving.tsx` | Lab + QC scan buttons, wire `BoxScanner`, box list shows sampled state |
| migrations | Add `sampled_at`, `sampled_by_id` to `erp_receiving_boxes` |

## Out of Scope

- Warehouse location scanning → separate ticket (post-QC release move + general LOCATION_MOVE transactions + physical QR codes on shelves/bins)
- Box-level QC disposition (QC acts on the receiving record, not individual boxes)
- Offline scanning (requires network for DB lookup)

## Testing

1. Generate a receiving record with 3 boxes → confirm each label preview shows a unique QR code
2. Print labels → confirm ZPL output includes `^BQ` with correct box label encoded
3. Open Receiving detail (QUARANTINED) → "Mark Box Sampled" button visible
4. Scan BOX-01 → record advances to SAMPLING, box shows sampled by/at
5. Scan BOX-02 → still SAMPLING (sampleSize = 3)
6. Scan BOX-03 → record auto-advances to PENDING_QC
7. Scan same box again → "Already sampled" error shown
8. QC scan on PENDING_QC record → scrolls to QC review section
9. Deny camera permission → text input fallback appears
10. Enter unknown label in text fallback → "Box not found" error
