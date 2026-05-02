-- 0029_r2_03_capa.sql
-- R2-03: CAPA / QMS backbone (21 CFR Part 111 §111.140)

CREATE TABLE erp_nonconformances (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nc_number           VARCHAR NOT NULL UNIQUE,
  type                TEXT NOT NULL,   -- OOS / COMPLAINT / RETURN / DEVIATION / EM_EXCURSION / AUDIT_FINDING / OTHER
  severity            TEXT NOT NULL,   -- CRITICAL / MAJOR / MINOR
  status              TEXT NOT NULL DEFAULT 'OPEN',  -- OPEN / UNDER_INVESTIGATION / CAPA_OPEN / CLOSED
  title               TEXT NOT NULL,
  description         TEXT,
  source_type         TEXT,
  source_id           TEXT,
  created_by_user_id  UUID NOT NULL REFERENCES erp_users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at           TIMESTAMPTZ
);

CREATE TABLE erp_capas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capa_number         VARCHAR NOT NULL UNIQUE,
  nc_id               UUID NOT NULL REFERENCES erp_nonconformances(id),
  capa_type           TEXT NOT NULL,   -- CORRECTIVE / PREVENTIVE / BOTH
  root_cause          TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'OPEN',  -- OPEN / EFFECTIVENESS_PENDING / CLOSED
  opened_by_user_id   UUID NOT NULL REFERENCES erp_users(id),
  opened_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  open_signature_id   UUID REFERENCES erp_electronic_signatures(id),
  closed_by_user_id   UUID REFERENCES erp_users(id),
  closed_at           TIMESTAMPTZ,
  close_signature_id  UUID REFERENCES erp_electronic_signatures(id)
);

CREATE TABLE erp_capa_actions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capa_id                 UUID NOT NULL REFERENCES erp_capas(id),
  description             TEXT NOT NULL,
  assigned_to_user_id     UUID REFERENCES erp_users(id),
  due_at                  TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  completed_by_user_id    UUID REFERENCES erp_users(id),
  created_by_user_id      UUID NOT NULL REFERENCES erp_users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE erp_capa_effectiveness_checks (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capa_id                 UUID NOT NULL REFERENCES erp_capas(id),
  scheduled_at            TIMESTAMPTZ NOT NULL,
  result                  TEXT NOT NULL DEFAULT 'PENDING',  -- EFFECTIVE / NOT_EFFECTIVE / PENDING
  notes                   TEXT,
  performed_by_user_id    UUID REFERENCES erp_users(id),
  performed_at            TIMESTAMPTZ,
  signature_id            UUID REFERENCES erp_electronic_signatures(id),
  created_by_user_id      UUID NOT NULL REFERENCES erp_users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE erp_management_reviews (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_number       VARCHAR NOT NULL UNIQUE,
  period              VARCHAR NOT NULL,
  reviewed_at         TIMESTAMPTZ NOT NULL,
  summary             TEXT NOT NULL,
  outcome             TEXT NOT NULL,  -- SATISFACTORY / REQUIRES_ACTION
  signature_id        UUID REFERENCES erp_electronic_signatures(id),
  created_by_user_id  UUID NOT NULL REFERENCES erp_users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE erp_management_review_capas (
  review_id  UUID NOT NULL REFERENCES erp_management_reviews(id),
  capa_id    UUID NOT NULL REFERENCES erp_capas(id),
  PRIMARY KEY (review_id, capa_id)
);

CREATE INDEX idx_nonconformances_status ON erp_nonconformances(status);
CREATE INDEX idx_nonconformances_type ON erp_nonconformances(type);
CREATE INDEX idx_capas_nc_id ON erp_capas(nc_id);
CREATE INDEX idx_capas_status ON erp_capas(status);
CREATE INDEX idx_capa_actions_capa_id ON erp_capa_actions(capa_id);
CREATE INDEX idx_capa_effectiveness_capa_id ON erp_capa_effectiveness_checks(capa_id);
