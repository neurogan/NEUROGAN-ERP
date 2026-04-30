-- 0023_component_specifications.sql
-- Three new tables + two new columns on erp_lab_test_results

CREATE TABLE erp_component_specs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      VARCHAR NOT NULL REFERENCES erp_products(id),
  created_by_user_id UUID NOT NULL REFERENCES erp_users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes           TEXT,
  UNIQUE(product_id)
);

CREATE TABLE erp_component_spec_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_id         UUID NOT NULL REFERENCES erp_component_specs(id),
  version_number  INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'DRAFT',
  signature_id    UUID REFERENCES erp_electronic_signatures(id),
  created_by_user_id UUID NOT NULL REFERENCES erp_users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(spec_id, version_number)
);

CREATE TABLE erp_component_spec_attributes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_version_id UUID NOT NULL REFERENCES erp_component_spec_versions(id),
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  spec_min        TEXT,
  spec_max        TEXT,
  units           TEXT,
  test_method     TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE erp_lab_test_results
  ADD COLUMN spec_version_id  UUID REFERENCES erp_component_spec_versions(id),
  ADD COLUMN spec_attribute_id UUID REFERENCES erp_component_spec_attributes(id);
