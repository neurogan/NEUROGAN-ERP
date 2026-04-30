-- R-07: Master Manufacturing Records
-- erp_mmrs: versioned, QA-signed manufacturing templates (one per finished good)
-- erp_mmr_steps: ordered process step templates linked to an MMR

CREATE TABLE erp_mmrs (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id           VARCHAR     NOT NULL REFERENCES erp_products(id),
  recipe_id            VARCHAR     NOT NULL REFERENCES erp_recipes(id),
  version              INTEGER     NOT NULL DEFAULT 1,
  status               TEXT        NOT NULL DEFAULT 'DRAFT'
                                   CHECK (status IN ('DRAFT', 'APPROVED', 'SUPERSEDED')),
  yield_min_threshold  NUMERIC,
  yield_max_threshold  NUMERIC,
  notes                TEXT,
  created_by_user_id   UUID        NOT NULL REFERENCES erp_users(id),
  approved_by_user_id  UUID        REFERENCES erp_users(id),
  signature_id         UUID        REFERENCES erp_electronic_signatures(id),
  approved_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mmr_self_approval_prohibited
    CHECK (approved_by_user_id IS NULL OR approved_by_user_id <> created_by_user_id),
  CONSTRAINT mmr_signature_required_when_approved
    CHECK (status <> 'APPROVED' OR signature_id IS NOT NULL)
);

CREATE TABLE erp_mmr_steps (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mmr_id           UUID        NOT NULL REFERENCES erp_mmrs(id) ON DELETE CASCADE,
  step_number      INTEGER     NOT NULL,
  description      TEXT        NOT NULL,
  equipment_ids    UUID[]      NOT NULL DEFAULT '{}',
  critical_params  TEXT,
  sop_reference    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mmr_id, step_number)
);

ALTER TABLE erp_batch_production_records
  ADD COLUMN mmr_id      UUID REFERENCES erp_mmrs(id),
  ADD COLUMN mmr_version INTEGER;
