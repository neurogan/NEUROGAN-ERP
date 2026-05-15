# BPR Templates — Database-Driven Future Option

**Status:** Future / not implemented. Sketch only.

**Decided 2026-05-12:** Ship v1 of the BPR redesign with hardcoded templates (TypeScript/JSON in the repo). This document captures a rough plan for the database-driven alternative in case we need to revisit it.

---

## When to revisit

Switch to database-driven templates if any of these happen:

- New product types are added frequently (more than once every 3-6 months)
- Head of QC wants to revise step structure / sign-off requirements without a code release
- Multiple template variations emerge that differ only in small details (better expressed as data than as new files)
- A second QC author joins and template authoring becomes a bottleneck on dev capacity

## Rough schema

```sql
erp_bpr_templates
  id                  uuid PK
  name                text         -- "Capsule Manufacturing v2"
  kind                text         -- MANUFACTURING | PACKAGING
  status              text         -- DRAFT | APPROVED | RETIRED
  version             int
  created_by          uuid FK -> users
  approved_by         jsonb        -- signature snapshot
  approved_at         timestamp
  created_at          timestamp

erp_bpr_template_steps
  id                  uuid PK
  template_id         uuid FK -> erp_bpr_templates
  step_order          int
  step_kind           text         -- WEIGHING | BLENDING | EQUIPMENT_CHECK | SIGNOFF | ... (known kinds)
  title               text
  instructions        text
  required_fields     jsonb        -- which fields the operator records during execution
  required_signoffs   text[]       -- ["operator", "witness", "qc"]
  iterates_over_bom   boolean      -- true for the weighing step
```

## UI implications

Building this means building two systems instead of one:

1. **Template Builder** (admin/QC-only):
   - Drag-and-drop or form-based step composer
   - Field-type picker per step (number, text, signature, equipment-select, etc.)
   - Versioning UI — every change creates a new draft, approval ceremony promotes it to active
   - Migration UI — when a template version changes, deciding what happens to existing MMRs and in-flight BPRs

2. **BPR Execution** (operator-facing):
   - Same as hardcoded version, but reads its structure from the database

The Template Builder is the expensive piece. Realistically that's 4-6 weeks of work on its own.

## Part 11 / change control implications

Templates become regulated artifacts under 21 CFR Part 11. Each template would need:
- E-signature approval before becoming usable (similar to MMRs and validation docs)
- Full audit trail of changes (already covered by the platform audit log)
- Effective-date management — if Template v2 is approved mid-batch, in-flight BPRs stay on v1 and new MMRs default to v2
- Retired templates can't be deleted (existing BPRs still reference them)

## Migration from hardcoded → database-driven

Reasonably clean:

1. Build the template tables and the execution engine that reads from them
2. Write a one-time seed script that converts the existing hardcoded TS templates into DB rows
3. Mark them as v1, APPROVED (with a backdated signature snapshot or a one-time admin approval)
4. Build the Template Builder UI
5. Existing MMRs continue working — they already reference templates by ID

The execution code only needs to change its data source, not its logic.

## Why we're not doing this now

- 4-6 templates only, changing rarely
- Head of QC works in tight collaboration with the developer; a code-change cycle for new templates is acceptable
- Building the Template Builder doubles the scope of the BPR redesign ticket
- Easier to validate (and FDA-defend) the small, fixed set of hardcoded templates initially
