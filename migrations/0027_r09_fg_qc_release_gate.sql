-- 0027_r09_fg_qc_release_gate.sql
-- R-09: Finished-Goods QC Release Gate (FDA Form 483 Obs 5 — 21 CFR Part 111 §111.123(a)(4))
-- Five new tables; no destructive changes; no grandfathering.

-- 1. Spec header (one per FINISHED_GOOD product, optional name/description)
CREATE TABLE erp_finished_goods_specs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          VARCHAR NOT NULL REFERENCES erp_products(id),
  name                TEXT NOT NULL,
  description         TEXT,
  status              TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE, RETIRED
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id  UUID NOT NULL REFERENCES erp_users(id)
);

-- 2. Versioned, approval-gated spec versions
CREATE TABLE erp_finished_goods_spec_versions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_id               UUID NOT NULL REFERENCES erp_finished_goods_specs(id),
  version               INTEGER NOT NULL,
  status                TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',  -- PENDING_APPROVAL, APPROVED, SUPERSEDED
  approved_by_user_id   UUID REFERENCES erp_users(id),
  approved_at           TIMESTAMPTZ,
  signature_id          UUID REFERENCES erp_electronic_signatures(id),
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id    UUID NOT NULL REFERENCES erp_users(id),
  UNIQUE(spec_id, version)
);

-- 3. Attributes (analytes) on a spec version — immutable once APPROVED
CREATE TABLE erp_finished_goods_spec_attributes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_version_id  UUID NOT NULL REFERENCES erp_finished_goods_spec_versions(id),
  analyte          TEXT NOT NULL,
  category         TEXT NOT NULL,  -- NUTRIENT_CONTENT, CONTAMINANT, MICROBIOLOGICAL
  target_value     NUMERIC,
  min_value        NUMERIC,
  max_value        NUMERIC,
  unit             TEXT NOT NULL,
  required         BOOLEAN NOT NULL DEFAULT TRUE,
  notes            TEXT
);

-- 4. Per-batch test submission (one row per lab visit / COA)
CREATE TABLE erp_finished_goods_qc_tests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bpr_id               VARCHAR NOT NULL REFERENCES erp_batch_production_records(id),
  lab_id               UUID NOT NULL REFERENCES erp_labs(id),
  sample_reference     TEXT,
  tested_at            DATE NOT NULL,
  entered_by_user_id   UUID NOT NULL REFERENCES erp_users(id),
  coa_document_id      VARCHAR REFERENCES erp_coa_documents(id),
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Per-attribute results within a test
CREATE TABLE erp_finished_goods_qc_test_results (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id               UUID NOT NULL REFERENCES erp_finished_goods_qc_tests(id) ON DELETE CASCADE,
  spec_attribute_id     UUID NOT NULL REFERENCES erp_finished_goods_spec_attributes(id),
  reported_value        NUMERIC NOT NULL,
  reported_unit         TEXT NOT NULL,
  pass_fail             TEXT NOT NULL,  -- PASS, FAIL, NOT_EVALUATED
  oos_investigation_id  UUID REFERENCES erp_oos_investigations(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
