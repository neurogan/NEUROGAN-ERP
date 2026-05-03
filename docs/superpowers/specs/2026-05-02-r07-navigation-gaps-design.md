# R-07 Navigation Gaps Design

## Goal

Wire bidirectional navigation between MMR, Inventory, and Production Batch pages; split inventory display into Available vs Quarantine quantities.

## Architecture

All changes are at the presentation and storage-query layers. No new tables, no new API routes, no schema migrations. URL query params carry context between pages. The inventory quantity split is a read-side concern only — the `PO_RECEIPT` transaction is still written at receipt entry; the display layer partitions it by lot quarantine status.

## Tech Stack

React 18 + wouter (hash routing), TanStack Query, shadcn/ui, Drizzle ORM (PostgreSQL read-side join update).

---

## 1. MMR Page — Query Param Support

**File:** `client/src/pages/mmr/index.tsx`

The MMR list page reads two optional URL query params on mount:

- `?productId=<uuid>` — filters the visible list client-side to only rows matching that product; if multiple MMR versions exist for the product, all are shown
- `?mmrId=<uuid>` — filters to that exact MMR row and expands/selects it

If neither param is present, the page behaves as today (full list, no pre-selection).

Implementation: read params via wouter's `useSearch()`, apply as client-side filter over the TanStack Query result after it resolves. No extra API call needed.

---

## 2. Navigation Links

Five new links wired across existing pages. All use `setLocation()` (wouter programmatic navigation) or `<a href>` with hash path.

| Source | Element | Destination |
|---|---|---|
| `finished-goods.tsx` "View MMR" button (line ~707) | Change `onClick` to pass productId | `/operations/mmr?productId={product.id}` |
| MMR detail panel/row | New "View Product" link | `/inventory/finished-goods?productId={mmr.productId}` |
| BPR detail view | New "View MMR Used" link (visible when `bpr.mmrId` is set) | `/operations/mmr?mmrId={bpr.mmrId}` |
| Receiving QC approval success | Toast action button "View in Inventory" | `/inventory?lotId={lot.id}` |
| Batch completion success | Toast action button "View FG in Inventory" | `/inventory?lotId={outputLotId}` |

**Receiving / Batch toast pattern:** Use the existing `toast()` utility (shadcn). Add an `action` prop pointing to the relevant inventory path. The lotId for receiving comes from the lot linked to the receiving record; for batch completion it comes from the `outputLotId` returned by the complete endpoint.

---

## 3. Inventory: Available vs Quarantine Split

### Storage layer

`getInventory()` (in `server/storage/`) currently sums all transactions grouped by `lotId + locationId`. Update the query to join `erp_lots` and partition the sum:

```sql
SELECT
  t.lot_id,
  t.location_id,
  SUM(CASE WHEN l.quarantine_status = 'APPROVED' THEN t.quantity ELSE 0 END) AS available_qty,
  SUM(CASE WHEN l.quarantine_status != 'APPROVED' THEN t.quantity ELSE 0 END) AS quarantine_qty,
  SUM(t.quantity) AS total_qty
FROM erp_transactions t
JOIN erp_lots l ON l.id = t.lot_id
GROUP BY t.lot_id, t.location_id
```

Response type gains `availableQty` and `quarantineQty` (decimals). `totalQty` is kept for backwards compat.

### UI layer

Inventory table replaces the single "Qty" column with two adjacent columns:

- **Available** — green-tinted if > 0
- **Quarantine** — amber-tinted if > 0

Total row in footer shows sums of each column. The existing sort/filter behaviour is preserved.

### `?lotId=` param

The Inventory page reads `?lotId=` on mount. If present, it scrolls the matching lot row into view and applies a brief highlight (ring or background flash). Used by the toast action buttons from receiving and batch completion.

---

## 4. Finished Goods page — `?productId=` param

`/inventory/finished-goods` already exists. It will read `?productId=` and scroll-to/highlight the matching product row. Used by the "View Product" link from the MMR detail panel.

---

## Error Handling

- If `?mmrId=` points to a record the query returns nothing for (deleted, no access), the MMR page renders normally with no pre-selection — no error shown.
- If `?lotId=` references a lot not in the current inventory results, the page renders normally with no scroll action.
- Toast action buttons are best-effort UX — if the underlying data isn't ready when the user clicks, they land on the inventory page unfiltered.

---

## Testing

- Unit: `getInventory()` returns correct `availableQty` / `quarantineQty` split for a mix of approved and quarantined lots.
- Integration: receiving QC approval response includes lotId; batch completion response includes outputLotId (already present — verify).
- E2E (manual): navigate FG → MMR → BPR → MMR round-trip; approve a receiving record and follow the toast to inventory; complete a batch and follow the toast to the FG lot.
