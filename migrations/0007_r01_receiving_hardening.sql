-- R-01: Receiving Hardening — Phase 1 Foundations
-- Labs registry, approved materials, workflow type, identity snapshot, lot quarantine fix.

-- ── 1. Labs registry ─────────────────────────────────────────────────────────
CREATE TABLE erp_labs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL UNIQUE,
  address    TEXT,
  type       TEXT        NOT NULL CHECK (type IN ('IN_HOUSE', 'THIRD_PARTY')),
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO erp_labs (name, address, type) VALUES
  ('Neurogan Labs', '', 'IN_HOUSE'),
  ('Nutri Analytical Testing Laboratories', '', 'THIRD_PARTY')
ON CONFLICT (name) DO NOTHING;

-- ── 2. Approved materials registry ───────────────────────────────────────────
CREATE TABLE erp_approved_materials (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            VARCHAR     NOT NULL REFERENCES erp_products(id),
  supplier_id           VARCHAR     NOT NULL REFERENCES erp_suppliers(id),
  approved_by_user_id   UUID        NOT NULL REFERENCES erp_users(id),
  approved_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes                 TEXT,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, supplier_id)
);

-- ── 3. erp_receiving_records additions ───────────────────────────────────────
ALTER TABLE erp_receiving_records
  ADD COLUMN requires_qualification BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN qc_workflow_type       TEXT;

-- Migrate visual_exam_by: text → jsonb identity snapshot
ALTER TABLE erp_receiving_records
  ALTER COLUMN visual_exam_by TYPE jsonb USING
    CASE
      WHEN visual_exam_by IS NULL THEN NULL
      ELSE jsonb_build_object('userId', null, 'fullName', visual_exam_by, 'title', null)
    END;

-- Migrate qc_reviewed_by: text → jsonb identity snapshot
ALTER TABLE erp_receiving_records
  ALTER COLUMN qc_reviewed_by TYPE jsonb USING
    CASE
      WHEN qc_reviewed_by IS NULL THEN NULL
      ELSE jsonb_build_object('userId', null, 'fullName', qc_reviewed_by, 'title', null)
    END;

-- ── 4. erp_coa_documents: add lab FK ─────────────────────────────────────────
ALTER TABLE erp_coa_documents
  ADD COLUMN lab_id UUID REFERENCES erp_labs(id);

-- ── 5. Fix erp_lots quarantine_status default (was APPROVED — bug) ────────────
ALTER TABLE erp_lots
  ALTER COLUMN quarantine_status SET DEFAULT 'QUARANTINED';
