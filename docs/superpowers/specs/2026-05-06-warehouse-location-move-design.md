# Warehouse Location Move — Design Spec

**Ticket:** WH-01  
**Date:** 2026-05-06  
**Status:** Spec — not yet planned

---

## Problem

After QC approval, the lot's `locationId` in the system still points to wherever the material was received (e.g. "QUARANTINE" cage). No step exists to record that the material was physically moved to a shelf/bin. This causes two concrete problems:

1. **System location ≠ physical location** — from QC sign-off until someone manually reconciles, the ERP shows wrong pick locations for production.
2. **Production batches show "QUARANTINE" as the pick location** — confusing and potentially blocking warehouse staff from picking the right bin.

The window between receiving and QC approval can be days or weeks (lab testing), so this divergence is not a corner case — it's the normal operating state.

---

## Regulatory context

21 CFR §111.80(b) requires physical segregation of quarantined components. The quarantine cage IS the compliant physical location. The move to a shelf/bin after QC release is the physical manifestation of the approval decision. The ERP should record this move so lot location is always accurate and traceable.

---

## Design

### Core concept

When QC approves a receiving record (status → APPROVED), the system triggers a mandatory **location confirmation step** before the record is fully closed. The approving user (or a warehouse worker notified by the system) confirms the destination location. The system records a `LOCATION_MOVE` transaction and updates the lot's current location.

### Two-phase approval

**Phase 1 — QC sign-off** (existing, no change to data model):
- QC reviewer submits disposition (Approved / Rejected)
- Receiving record status → APPROVED
- Lot `quarantineStatus` → APPROVED
- Lot is now legally releasable

**Phase 2 — Location confirmation** (new):
- Immediately after sign-off, the UI prompts: "Where is this material being moved to?"
- User selects destination location (existing locations + inline "create new location")
- System writes a `LOCATION_MOVE` transaction: `{ lotId, fromLocationId, toLocationId, movedBy, movedAt }`
- The lot's effective location (derived from transaction history) updates to the new bin

Phase 2 is required before the receiving record is considered fully released. A new intermediate status `APPROVED_PENDING_MOVE` prevents the record from showing as fully "Released" until the move is confirmed.

### Status flow addition

```
QUARANTINED → PENDING_QC → APPROVED_PENDING_MOVE → RELEASED
                                       ↑
                              (location confirmed)
```

`APPROVED_PENDING_MOVE` is a new status value. The lot's `quarantineStatus` is already `APPROVED` at this point — production can legally use the material. The move confirmation is a warehouse ops step, not a regulatory gate on the lot itself.

> **Note:** If the material is staying in place (e.g. approved in a walk-in that IS the storage location), the user can confirm the same location. This is a valid "no-move" confirmation.

### Transaction model

Add `LOCATION_MOVE` to the transaction type set:

```sql
-- Existing: PO_RECEIPT, PRODUCTION_CONSUMPTION, PRODUCTION_OUTPUT, COUNT_ADJUSTMENT
-- New:
ALTER TYPE transaction_type ADD VALUE 'LOCATION_MOVE';
```

Or, since `type` is `text` (not a Postgres enum — see schema line 136), no migration is needed for the column. The enum in `shared/schema.ts` (line 26) is a `pgEnum` which IS a Postgres-level type and DOES require a migration.

**Option A:** Add `LOCATION_MOVE` to `transactionTypeEnum` via migration.  
**Option B:** Keep transactions as-is and add a separate `erp_location_moves` table.

Recommendation: **Option B** — a dedicated `erp_location_moves` table. Reasons:
- Location moves are bidirectional (`fromLocationId` + `toLocationId`), which doesn't fit the existing `transactions` schema (single `locationId`).
- Avoids altering the Postgres enum (risky on production).
- Cleaner audit trail for location history.

```sql
CREATE TABLE erp_location_moves (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id      VARCHAR NOT NULL REFERENCES erp_lots(id),
  from_location_id VARCHAR REFERENCES erp_locations(id),
  to_location_id   VARCHAR NOT NULL REFERENCES erp_locations(id),
  moved_by    VARCHAR NOT NULL REFERENCES erp_users(id),
  moved_at    TIMESTAMP NOT NULL DEFAULT now(),
  notes       TEXT,
  receiving_record_id VARCHAR REFERENCES erp_receiving_records(id)
);
```

`from_location_id` is nullable to handle the case where no prior location exists (e.g. material never formally placed before).

### Lot "current location" query

The lot's current location is the `to_location_id` of its most recent `erp_location_moves` row. If no location move exists, fall back to the `locationId` of its most recent `PO_RECEIPT` transaction.

```sql
SELECT COALESCE(
  (SELECT to_location_id FROM erp_location_moves
   WHERE lot_id = $1 ORDER BY moved_at DESC LIMIT 1),
  (SELECT location_id FROM erp_transactions
   WHERE lot_id = $1 AND type = 'PO_RECEIPT' ORDER BY created_at DESC LIMIT 1)
) AS current_location_id
```

This is backwards-compatible — existing lots without location moves will show their receiving location (current behavior).

### UI changes

**Receiving detail panel — after QC sign-off:**

Instead of showing "Released" immediately, show an `APPROVED_PENDING_MOVE` banner:

```
✅ QC Approved — Confirm warehouse move to release

[ Move to: [Location dropdown ▾] ]   [ Confirm Move ]
```

The banner stays until the move is confirmed. The receiving record shows status badge "Pending Move" (amber) rather than "Released" (green).

**Task queue:**

- WAREHOUSE role sees "Confirm location move" tasks for any `APPROVED_PENDING_MOVE` records.
- QA role does NOT see these — it's a warehouse ops task.

**Inventory lot view:**

Lot detail shows a "Location History" timeline if location moves exist.

### What does NOT change

- The production gate (`quarantineStatus === APPROVED`) is unchanged — production can use approved lots even before the move is confirmed.
- Lot `quarantineStatus` is set to APPROVED at QC sign-off (Phase 1), not at move confirmation (Phase 2).
- Rejected records never enter `APPROVED_PENDING_MOVE`.

---

## Scope estimate

| Area | Work |
|---|---|
| Migration | New `erp_location_moves` table + new `APPROVED_PENDING_MOVE` status value in receiving records |
| Storage | `createLocationMove()`, `getLocationMovesByLot()`, `getLotCurrentLocation()` |
| Routes | `POST /api/receiving/:id/confirm-move` (WAREHOUSE, QA, ADMIN) |
| State machine | Add `APPROVED_PENDING_MOVE` → `RELEASED` transition; update `assertValidTransition` |
| Receiving UI | Post-sign-off move confirmation widget; status badge update; task queue entry |
| Inventory UI | Location history timeline on lot detail |
| Task queue | "Confirm location move" task type for WAREHOUSE role |

**Rough size:** Medium — 1–2 days of focused work. No external dependencies. Non-breaking (backwards compatible).

---

## Open questions

1. Should confirming the move require a signature (Part 11 / F-04)? Probably not — it's a warehouse ops step, not a QC decision.
2. What happens if a material is moved again after initial placement (e.g. reorganising the warehouse)? The `erp_location_moves` table supports this naturally — any WAREHOUSE user can record ad-hoc moves outside of the receiving workflow. This is the "general LOCATION_MOVE transactions" from the iPad-02ph2 backlog.
3. Should the quarantine cage location be hidden from the location picker after QC approval? Probably not — some materials may stay in a quarantine cage for secondary inspection.
