# R-06 Returned Product — Design Spec

**FDA citations:** §111.503, §111.510, §111.513  
**Closes:** Form 483 Obs 12 — No returned-product SOP; no quarantine tracking; no QC disposition workflow.  
**Size:** S  
**Worktree:** `ticket/r-06-returned-product`  
**Migration:** `0020_r06_returned_product`

---

## 1. Goal

Build a quarantine-intake → QA-disposition → lot-trend-investigation workflow for returned finished goods. Covers Amazon FBA replenishment returns and wholesale customer returns. D2C customers are asked to scrap product in place, so no physical return flow exists for that channel.

---

## 2. Scope

**In scope:**
- Return intake record (warehouse creates, product goes into quarantine)
- QA disposition: Return to Inventory or Destroy — F-04 electronic signature required
- Automatic investigation trigger when a single lot accumulates returns ≥ configurable threshold
- Investigation close workflow: root cause + corrective action + F-04 signature
- Dashboard tiles and task surface for QA

**Out of scope:**
- Salvage-with-retest (sealed finished goods — visual inspection + QA signature is sufficient under §111.510)
- Inventory quantity movement mechanics (ERP records the decision; physical movement is a warehouse operation)
- Shopify/Amazon order linkage (lot traceability is sufficient for compliance)

---

## 3. Data Model

### 3.1 `erp_returned_products`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `return_ref` | text NOT NULL UNIQUE | Auto-generated `RET-YYYYMMDD-NNN` |
| `source` | text NOT NULL | `AMAZON_FBA \| WHOLESALE \| OTHER` |
| `lot_id` | varchar → `erp_lots.id` | Nullable — may be unresolved at intake |
| `lot_code_raw` | text NOT NULL | What was on the box |
| `qty_returned` | integer NOT NULL | Unit count |
| `uom` | text NOT NULL | e.g. `UNITS` |
| `wholesale_customer_name` | text | Required when `source = WHOLESALE` |
| `carrier_tracking_ref` | text | Optional Amazon/carrier reference |
| `received_by_user_id` | uuid → `erp_users.id` | NOT NULL |
| `received_at` | timestamptz NOT NULL | |
| `condition_notes` | text | Warehouse physical inspection notes |
| `status` | text NOT NULL | `QUARANTINE \| DISPOSED` |
| `disposition` | text | `RETURN_TO_INVENTORY \| DESTROY` — null until signed |
| `disposition_notes` | text | |
| `disposition_signature_id` | uuid → `erp_electronic_signatures.id` | |
| `dispositioned_by_user_id` | uuid → `erp_users.id` | |
| `dispositioned_at` | timestamptz | |
| `investigation_triggered` | boolean NOT NULL DEFAULT false | Set when this return pushed lot over threshold |
| `created_by_user_id` | uuid NOT NULL → `erp_users.id` | |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz NOT NULL DEFAULT now() | |

Indexes: `status`, `lot_id`, `received_at`.

### 3.2 `erp_return_investigations`

Opened automatically when a lot's return count hits the configured threshold. Only one open investigation per lot at a time.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `lot_id` | varchar NOT NULL → `erp_lots.id` | |
| `triggered_at` | timestamptz NOT NULL | When threshold was crossed |
| `returns_count` | integer NOT NULL | Return count at time of trigger |
| `threshold_at_trigger` | integer NOT NULL | Value of `returnsInvestigationThresholdCount` at trigger time |
| `status` | text NOT NULL DEFAULT `OPEN` | `OPEN \| CLOSED` |
| `root_cause` | text | Required to close |
| `corrective_action` | text | Required to close |
| `closed_by_user_id` | uuid → `erp_users.id` | |
| `closed_at` | timestamptz | |
| `close_signature_id` | uuid → `erp_electronic_signatures.id` | |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz NOT NULL DEFAULT now() | |

Index: `lot_id`, `status`.

### 3.3 App settings keys

Two keys inserted into `erp_app_settings_kv`:

| Key | Default | Description |
|---|---|---|
| `returnsInvestigationThresholdCount` | `3` | Number of returns against a single lot that triggers an investigation |

### 3.4 Electronic signature meanings

New meaning added to the `erp_electronic_signatures` `meaning` column check constraint and `schema.ts` enum:

| Meaning | Used by |
|---|---|
| `RETURNED_PRODUCT_DISPOSITION` | QA signs disposition on a returned product |
| `RETURN_INVESTIGATION_CLOSE` | QA signs close of a return investigation |

### 3.5 Audit trail actions

New actions added to the `erp_audit_trail` `action` column:

- `RETURN_INTAKE`
- `RETURN_DISPOSITION_SIGNED`
- `RETURN_INVESTIGATION_OPENED`
- `RETURN_INVESTIGATION_CLOSED`

---

## 4. State Machine

### Returned product

```
QUARANTINE ──(QA signs disposition)──► DISPOSED
```

Rules enforced at the storage layer:
1. Disposition requires `lot_id` to be set (warehouse must confirm lot before QA can sign).
2. `disposition` must be `RETURN_TO_INVENTORY` or `DESTROY` — null is rejected.
3. F-04 ceremony required: password verified outside transaction, then atomic tx: insert signature → update record → write audit rows.

### Return investigation

```
OPEN ──(QA closes with root_cause + corrective_action + signature)──► CLOSED
```

Rules:
1. `root_cause` and `corrective_action` are required to close.
2. Only one open investigation per lot at a time — new returns against the same lot increment the count but do not open a second investigation.
3. After an investigation is closed, the threshold check resets — a fresh investigation opens if returns continue to accumulate.

### Threshold trigger (runs on every new return intake)

```
returnsCount = SELECT COUNT(*) FROM erp_returned_products
               WHERE lot_id = $lotId

openInv = SELECT id FROM erp_return_investigations
          WHERE lot_id = $lotId AND status = 'OPEN'

if returnsCount >= threshold AND openInv IS NULL:
    INSERT INTO erp_return_investigations (...)
    UPDATE erp_returned_products SET investigation_triggered = true WHERE id = $newReturnId
```

---

## 5. API Routes

All routes require `requireAuth`. Role constraints as noted.

| Method | Path | Roles | Description |
|---|---|---|---|
| `POST` | `/api/returned-products` | `RECEIVING, QA, ADMIN` | Create intake record |
| `GET` | `/api/returned-products` | `QA, ADMIN` | List, filterable by `status`, `lotId` |
| `GET` | `/api/returned-products/:id` | `QA, ADMIN` | Detail |
| `POST` | `/api/returned-products/:id/disposition` | `QA, ADMIN` | F-04 sign disposition |
| `GET` | `/api/return-investigations` | `QA, ADMIN` | List investigations |
| `GET` | `/api/return-investigations/:id` | `QA, ADMIN` | Detail |
| `POST` | `/api/return-investigations/:id/close` | `QA, ADMIN` | F-04 close investigation |

### POST `/api/returned-products` body
```json
{
  "source": "AMAZON_FBA | WHOLESALE | OTHER",
  "lotCodeRaw": "string",
  "lotId": "uuid (optional — system resolves via ilike if omitted)",
  "qtyReturned": 12,
  "uom": "UNITS",
  "wholesaleCustomerName": "string (required if source=WHOLESALE)",
  "carrierTrackingRef": "string (optional)",
  "conditionNotes": "string (optional)",
  "receivedAt": "ISO 8601"
}
```

### POST `/api/returned-products/:id/disposition` body
```json
{
  "disposition": "RETURN_TO_INVENTORY | DESTROY",
  "dispositionNotes": "string (optional)",
  "password": "string"
}
```

### POST `/api/return-investigations/:id/close` body
```json
{
  "rootCause": "string",
  "correctiveAction": "string",
  "password": "string"
}
```

---

## 6. Return Reference Generator

Auto-generates `RET-YYYYMMDD-NNN` (same counter pattern as `RCV-YYYYMMDD-NNN` in receiving). Uses a daily counter in `erp_app_settings_kv` or a sequence query — follow the existing receiving record pattern.

---

## 7. Frontend

### Navigation
New **Returns** subtab under the Quality tab. Alongside Complaints and OOS subtabs.

### Pages

**`client/src/pages/quality/returns.tsx`** — Returns list
- Table: ref, source badge, lot number, qty, received date, status badge (`QUARANTINE` = amber, `DISPOSED` = grey), disposition badge (`RETURN_TO_INVENTORY` = green, `DESTROY` = red)
- Filter bar: status, lot
- "Log return" button → opens a modal form

**`client/src/pages/quality/ReturnDetail.tsx`** — Return detail
- Header: ref, source, lot link, qty, received by, received at
- Condition notes block
- If `status = QUARANTINE`: disposition form (radio: Return to Inventory / Destroy, notes textarea) + SignatureCeremony button
- If `status = DISPOSED`: read-only disposition summary with signer name, date, meaning
- If lot has an open investigation: amber banner "This lot has an open return investigation" with link

**`client/src/pages/quality/ReturnInvestigations.tsx`** — Investigations list + inline detail
- List: lot number, triggered date, returns count vs threshold, status badge
- Expandable detail: root cause + corrective action fields, F-04 close button
- Closed investigations are read-only

### Dashboard tiles (added to Quality section)

| Tile | Query | Colour |
|---|---|---|
| Returns awaiting disposition | `COUNT(*) WHERE status = 'QUARANTINE'` | Amber if > 0 |
| Open return investigations | `COUNT(*) WHERE status = 'OPEN'` | Red if > 0 |

### Dashboard tasks (getUserTasks)

| taskType | Condition | Role |
|---|---|---|
| `RETURN_PENDING_DISPOSITION` | Return in `QUARANTINE` | QA, ADMIN |
| `RETURN_INVESTIGATION_OPEN` | Investigation `OPEN` | QA, ADMIN |

---

## 8. Validation Requirements (URS)

| URS ID | OQ Test ID | Requirement |
|---|---|---|
| URS-R-06-01 | OQ-R-06-01 | Return intake assigns `QUARANTINE` status and generates a unique `RET-` ref |
| URS-R-06-02 | OQ-R-06-02 | Disposition requires F-04 password verification; signature row created with meaning `RETURNED_PRODUCT_DISPOSITION` |
| URS-R-06-03 | OQ-R-06-03 | When lot return count reaches `returnsInvestigationThresholdCount`, an investigation is opened automatically and `investigation_triggered = true` on the return |
| URS-R-06-04 | OQ-R-06-04 | A second open investigation is not created if one already exists for the lot |
| URS-R-06-05 | OQ-R-06-05 | Investigation close requires `root_cause`, `corrective_action`, and F-04 signature with meaning `RETURN_INVESTIGATION_CLOSE` |
| URS-R-06-06 | OQ-R-06-06 | All state transitions are recorded in `erp_audit_trail` |

---

## 9. SLA gap fix (carry-over from R-05 gap analysis)

During R-06 implementation, add SLA breach context to the existing complaint dashboard tiles in `getComplaintsSummary()`:
- Split `TRIAGE` count into `within_sla` and `overdue` (compare `intake_at` + `complaintTriageSlaBusinessDays` business days against now)
- Split `AWAITING_DISPOSITION` count similarly (compare `investigated_at` + `dispositionSlaBusinessDays`)

This closes the one deferred gap from R-05 without a separate ticket.
