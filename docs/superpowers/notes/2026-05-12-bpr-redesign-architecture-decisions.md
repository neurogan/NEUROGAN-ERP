# BPR Redesign — Architecture Decisions

**Date locked in:** 2026-05-12
**Status:** Architecture agreed. Waiting on paper BPR templates from Head of QC (~2 days). Spec + implementation come after templates arrive.

---

## Why this rewrite

The current production batch workflow has hardcoded execution steps. This doesn't work because:

- Different product types (capsules, tablets, powders, serums) genuinely need different step sequences
- MMRs are the FDA-approved procedure for each product — they dictate BOMs, equipment, time, yield, and steps
- The Head of QC is the author of MMRs; she needs the system to follow her procedures, not impose its own
- Hardcoding locks the system to whatever templates exist today

## Locked architectural decisions

### 1. Template-driven workflow

The production batch execution UI is dynamic, driven by a BPR template + the active MMR. Nothing about step sequence or per-step fields is hardcoded in the production batch page itself.

### 2. Step-level templates (not section-level)

A template lists the **exact sequence of steps** for that product type, in order. The MMR fills in the **values** within each step (target weights, RPMs, times, equipment IDs).

**Why step-level works:** Within a product type, the steps don't vary — only the values do. Two capsule products with different ingredients still go through the same procedure: weighing → blending → encapsulation → in-process → yield. Variable-length BOM is handled by rendering one row per MMR component inside the Weighing step, not by varying the step list.

**Edge case:** Genuine procedural variation within a type (e.g. capsule-with-granulation vs standard capsule) → create a **separate template**, not conditional steps within one template.

### 3. Hardcoded templates for v1

Templates are TypeScript/JSON files in the repo. Adding/editing a template requires a code change and deploy.

**Rationale:** Only 4-6 templates expected, changing rarely. Database-driven templates would double the scope of this ticket (Template Builder UI + change-control workflow + versioning).

**Future option** captured in: `docs/superpowers/notes/bpr-template-database-driven-future.md`

### 4. One MMR per SKU

Each FG product has one active MMR. The MMR covers both manufacturing AND packaging end-to-end for that specific SKU. The MMR references two templates:

- One **manufacturing template** (e.g. "Capsule Manufacturing")
- One **packaging template** (e.g. "Bottle Packaging")

### 5. Production batch executes in two phases

A single production batch has two sequential execution phases:

```
NEW
  ↓
MANUFACTURING_IN_PROGRESS    ← driven by manufacturing template + MMR
  ↓
MANUFACTURING_COMPLETE       ← QC sign-off
  ↓
PACKAGING_IN_PROGRESS        ← driven by packaging template + MMR
  ↓
PACKAGED
  ↓
RELEASED
```

Each phase has its own steps, deviations, sign-offs, and yield. Internally they may be stored as one BPR with two phase sections, or as two linked BPR records — to be decided in the spec. From the Head of QC's perspective ("separate BPRs for manufacturing and packaging") both representations satisfy the regulatory expectation, since each phase is its own complete execution record.

### 6. Templates per category

**Manufacturing templates** — multiple, one per product TYPE:
- Capsule Manufacturing
- Tablet Manufacturing
- Powder Manufacturing
- Serum Manufacturing
- (variations like "Capsule with Granulation" are separate templates)

**Packaging templates** — likely just 1-2:
- Bottle Packaging
- Possibly Jar Packaging or others depending on what Head of QC defines

**Channel variation** (e.g. Amazon needs FNSKU on the label, DTC doesn't) is a **parameter passed to the packaging phase**, NOT a separate template. The packaging template knows how to conditionally render label fields based on the destination channel.

## Existing scaffolding to evolve

R-07 already shipped MMR infrastructure. The new architecture **extends** these tables rather than replacing them:

| Table | Current state | Changes needed |
|---|---|---|
| `erp_mmrs` | Per-product MMR with version, status, yield thresholds, approval signature | Add `manufacturingTemplateId`, `packagingTemplateId`. Possibly split yield into manufacturing/packaging. |
| `erp_mmr_steps` | Free-form ordered steps with description, equipment, critical params | Add `phase` (MANUFACTURING / PACKAGING), `templateStepKey` to bind to a specific step in the referenced template. Step content evolves from free-form text to structured per-template values. |
| `erp_mmr_components` | BOM (ingredient + quantity + uom) | No changes expected — already structured. |

## Open questions for when templates arrive

These get answered by seeing the actual paper templates:

1. **What step kinds exist?** (WEIGHING, BLENDING, EQUIPMENT_CHECK, IN_PROCESS_TEST, SIGNOFF, etc.)
2. **What fields does each kind record during execution?** (target value, actual value, equipment ID, operator initial, witness, deviation flag, etc.)
3. **How are deviations captured?** (per-step deviation flag → opens deviation form? Or section-level?)
4. **What sign-off ceremonies exist?** (operator+witness per step? Or only at section boundaries? Or only at phase completion?)
5. **In-process testing flow** — does the template define test points where execution pauses for lab results before continuing?
6. **Yield reconciliation specifics** — what's the formula? Theoretical yield vs actual? Loss reasons?
7. **Equipment scheduling/availability** — does selecting equipment in a step lock it out for other batches running simultaneously?
8. **Cleaning verification** — does the template enforce that the chosen equipment has a recent cleaning record before the step can proceed?

## Next steps after templates arrive

1. Read the paper templates carefully — what sections, what steps, what fields per step
2. Categorize the step kinds and field types we need to support
3. Write the BPR redesign implementation spec (under `docs/superpowers/specs/`)
4. Build hardcoded TS template files matching the paper templates exactly
5. Evolve `erp_mmrs` and `erp_mmr_steps` schema
6. Build the dynamic BPR execution UI
7. After this ships, revisit the QR scanning workflows (deferred — the highest-value scan flow is "BPR material dispensing" which only makes sense once the new execution flow exists)

## Decided NOT to do (yet)

- Database-driven templates (notes/bpr-template-database-driven-future.md)
- QR code scanning workflows (waiting for new BPR execution to exist first)
- Multi-SKU manufacturing batches (Neurogan does 1 batch = 1 SKU, no parent-child needed)
- Channel-specific templates (channel is a packaging parameter, not a template)

---

## How this conversation went

Starting point: user wanted "BPR redesign" as a single ticket. Initially assumed paper template would directly define hardcoded steps in the production batch page.

Reframing: Head of QC pointed out BPRs need to match MMRs, MMRs vary per product, and each product type has its own procedure. Hardcoding doesn't work.

Resolution: The TEMPLATE is the procedure structure (hardcoded per product type). The MMR fills in the values for a specific product. The BPR is the execution instance. Production batch goes through two phases (manufacturing + packaging), each phase driven by its own template.
