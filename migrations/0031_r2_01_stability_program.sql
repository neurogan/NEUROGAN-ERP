-- R2-01 Stability program (§111.210(f))
-- Per-product stability protocols, batch enrollment, timepoint scheduling,
-- result entry, and shelf-life conclusions.

CREATE TABLE erp_stability_protocols (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  varchar(255) NOT NULL,
  product_id            uuid REFERENCES erp_products(id),
  description           text,
  storage_condition     varchar(255) NOT NULL,
  test_intervals_months integer[]    NOT NULL,
  is_active             boolean      NOT NULL DEFAULT true,
  signature_id          uuid REFERENCES erp_electronic_signatures(id),
  created_by_user_id    uuid NOT NULL REFERENCES erp_users(id),
  created_at            timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE erp_stability_protocol_attributes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id uuid NOT NULL REFERENCES erp_stability_protocols(id),
  analyte_name varchar(255) NOT NULL,
  unit        varchar(50),
  min_spec    numeric(12,4),
  max_spec    numeric(12,4),
  test_method varchar(255),
  created_at  timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE erp_stability_batches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id         uuid NOT NULL REFERENCES erp_stability_protocols(id),
  bpr_id              varchar NOT NULL REFERENCES erp_batch_production_records(id),
  enrolled_at         timestamp with time zone NOT NULL,
  status              text NOT NULL DEFAULT 'ONGOING',
  enrolled_by_user_id uuid NOT NULL REFERENCES erp_users(id),
  created_at          timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE erp_stability_timepoints (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id         uuid NOT NULL REFERENCES erp_stability_batches(id),
  interval_months  integer NOT NULL,
  scheduled_at     timestamp with time zone NOT NULL,
  completed_at     timestamp with time zone,
  created_at       timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE erp_stability_results (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timepoint_id        uuid NOT NULL REFERENCES erp_stability_timepoints(id),
  attribute_id        uuid NOT NULL REFERENCES erp_stability_protocol_attributes(id),
  reported_value      numeric(12,4) NOT NULL,
  reported_unit       varchar(50)   NOT NULL,
  pass_fail           text          NOT NULL,
  notes               text,
  entered_by_user_id  uuid NOT NULL REFERENCES erp_users(id),
  created_at          timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE erp_stability_conclusions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id                    uuid NOT NULL UNIQUE REFERENCES erp_stability_batches(id),
  supported_shelf_life_months integer NOT NULL,
  basis                       text    NOT NULL,
  outcome                     text    NOT NULL,
  signature_id                uuid REFERENCES erp_electronic_signatures(id),
  concluded_by_user_id        uuid NOT NULL REFERENCES erp_users(id),
  created_at                  timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_stability_batches_protocol  ON erp_stability_batches(protocol_id);
CREATE INDEX idx_stability_batches_bpr       ON erp_stability_batches(bpr_id);
CREATE INDEX idx_stability_timepoints_batch  ON erp_stability_timepoints(batch_id);
CREATE INDEX idx_stability_timepoints_sched  ON erp_stability_timepoints(scheduled_at);
CREATE INDEX idx_stability_results_timepoint ON erp_stability_results(timepoint_id);
