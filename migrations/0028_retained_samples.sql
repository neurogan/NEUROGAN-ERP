-- 0028_retained_samples.sql
-- Obs 11 partial — Retained Sample Register (21 CFR §111.83(b))

CREATE TABLE erp_retained_samples (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bpr_id                  VARCHAR NOT NULL REFERENCES erp_batch_production_records(id),
  sampled_at              TIMESTAMPTZ NOT NULL,
  pulled_qty              NUMERIC(10,3) NOT NULL,
  qty_unit                VARCHAR(20) NOT NULL,
  retention_location      VARCHAR(255) NOT NULL,
  retention_expires_at    TIMESTAMPTZ NOT NULL,
  destroyed_at            TIMESTAMPTZ,
  destroyed_by_user_id    UUID REFERENCES erp_users(id),
  created_by_user_id      UUID NOT NULL REFERENCES erp_users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_retained_samples_bpr_id ON erp_retained_samples(bpr_id);
CREATE INDEX idx_retained_samples_expires ON erp_retained_samples(retention_expires_at);
