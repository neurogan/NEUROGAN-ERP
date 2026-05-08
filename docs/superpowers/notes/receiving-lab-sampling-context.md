# Lab Sampling Workflow — Deferred Context

**Status:** Deferred. Not to be built until a dedicated ticket is created.
**Last discussed:** 2026-05-06

---

## Why This Exists

The receiving flow has a `FULL_LAB_TEST` workflow type for dietary active/supporting
ingredients received from a supplier who hasn't been independently verified yet (first-time
supplier, or periodic re-verification required under 21 CFR Part 111 §111.75(c)).

The current UI has a "Boxes" section on the receiving detail panel. It shows a list of
boxes with "Not sampled" status. It was originally built to track which boxes samples
were taken from, but it is fully disconnected from the workflow — nothing blocks QC
approval based on sampling state, and there is no clear action for warehouse staff to
take. It is confusing dead weight and has been hidden in the R-11 redesign pending a
proper implementation.

---

## What the Regulation Requires

- **21 CFR Part 111 §111.80**: Must use a statistically valid sampling plan for dietary
  ingredients received. You do NOT need to test every box. You pull a representative
  sample based on lot size.
- **21 CFR Part 111 §111.75(c)**: If relying on supplier COAs, must periodically verify
  the supplier's testing is reliable by running independent tests. This is what triggers
  `FULL_LAB_TEST`.
- **21 CFR Part 111 §111.260**: Must retain sample records including which containers
  were sampled and the results.

---

## The Agreed Design (to implement in a future ticket)

### Sampling Plan
- The system needs a configurable sampling plan per product/material type: given N boxes
  received, how many must be sampled? (e.g. √N + 1, or a fixed table)
- This does not need to be complex to start — even a simple rule (e.g. "sample at least
  2 boxes, or 10% of boxes, whichever is greater") satisfies the regulation for most
  supplement manufacturers
- The plan should be reviewable/approvals as a SOP document

### The Workflow Steps for FULL_LAB_TEST

1. **Warehouse receives shipment** → visual inspection → submit for QC
2. **QC/Lab task appears**: "Sampling required — select boxes to sample"
   - QC/Lab staff selects which boxes (by scanning QR code or tapping in UI)
   - Each selected box is marked "Sampled — [date] — [user]"
   - A sample ID is generated per box (or per composite sample)
3. **Samples sent to lab** → status moves to "SAMPLING" (already exists in the status model)
   - Staff marks samples as dispatched to lab (lab name, dispatch date)
   - This blocks QC sign-off
4. **Lab results received** → the lab result is a COA/report document
   - Staff uploads the lab report (PDF) from the external lab (e.g. Eurofins)
   - Source = Third-party Lab, overall result = PASS/FAIL
   - This is the same COA upload step as the R-11 redesign, just sourced from a lab not a supplier
5. **QC sign-off** → QC staff reviews the lab COA, signs off

### Key Distinction vs IDENTITY_CHECK
- `IDENTITY_CHECK` (established supplier): upload supplier COA → sign off (no lab sampling required)
- `FULL_LAB_TEST` (new/unverified supplier): sample boxes → send to lab → upload lab report → sign off
- On approval of a FULL_LAB_TEST, the supplier gets added to Approved Materials
  (already implemented) and future receipts from them use IDENTITY_CHECK

### Where Sampling Lives in the UI
This was undecided at the time of deferral. Options discussed:
- **Option A**: On the receiving detail panel, the "Boxes" section becomes an active step
  with a "Mark as sampled" action per box, gated behind workflow state
- **Option B**: A separate "Lab Samples" subtab under Procurement or Quality
- **Option C**: Handled via the task queue — lab tech scans boxes via iPad, the Boxes
  section on the receiving panel just shows the result

Frederik's preference was leaning toward iPad-based scanning for the box marking step
(consistent with iPad-02 and iPad-02ph2 work), but the UI home for the lab sample
tracking was undecided. This should be the first design question when picking up this
ticket.

### The Box QR Codes
Box QR codes (RCV-XXXXX-BOX-XX format) are already generated and printed via the
ReceivingLabelDrawer. Each box has a scannable code. The box sampling ticket should
leverage these existing codes for the "mark as sampled" scan step rather than
generating new identifiers.

---

## What NOT to Re-discuss When Picking This Up

- You do not need to test every box (FDA says statistically valid, not exhaustive)
- The sampling step must BLOCK QC sign-off for FULL_LAB_TEST — this was the root
  problem with the original implementation (it didn't block anything)
- The lab result upload IS a COA upload (same format as R-11 inline COA) just sourced
  from a third-party lab — do not build a separate "lab result" concept, reuse the COA
  upload infrastructure

---

## Schema Notes

The following already exists and should be reused:
- `erp_receiving_records.status` includes `"SAMPLING"` state
- `erp_receiving_boxes` table exists with box QR codes
- `erp_coa_documents` is the target table for lab reports (same as supplier COAs)
- `receivingBoxes.sampledAt` / `sampledBy` columns may need to be added (check schema)
