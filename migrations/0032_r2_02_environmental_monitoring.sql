-- R2-02 Environmental monitoring (§111.15)
-- EM site registry, per-site schedules/limits, result entry,
-- and auto-excursion creation on action-limit breach.

CREATE TABLE erp_em_sites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               varchar(255) NOT NULL,
  area               varchar(255) NOT NULL,
  site_type          text         NOT NULL,  -- AIR | SURFACE_NON_CONTACT | SURFACE_CONTACT
  is_active          boolean      NOT NULL DEFAULT true,
  created_by_user_id uuid         NOT NULL REFERENCES erp_users(id),
  created_at         timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE erp_em_schedules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            uuid         NOT NULL REFERENCES erp_em_sites(id),
  frequency          text         NOT NULL,  -- WEEKLY | MONTHLY | QUARTERLY
  organism_targets   text[]       NOT NULL DEFAULT '{}',
  is_active          boolean      NOT NULL DEFAULT true,
  created_by_user_id uuid         NOT NULL REFERENCES erp_users(id),
  created_at         timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE erp_em_limits (
  id                 uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            uuid    NOT NULL REFERENCES erp_em_sites(id),
  organism           varchar(255) NOT NULL,
  alert_limit        numeric(12,2),
  action_limit       numeric(12,2),
  unit               varchar(50)  NOT NULL DEFAULT 'CFU/m³',
  created_by_user_id uuid    NOT NULL REFERENCES erp_users(id),
  created_at         timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (site_id, organism)
);

CREATE TABLE erp_em_results (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            uuid         NOT NULL REFERENCES erp_em_sites(id),
  sampled_at         timestamp with time zone NOT NULL,
  organism           varchar(255) NOT NULL,
  cfu_count          numeric(12,2),           -- NULL when is_below_lod = true
  is_below_lod       boolean      NOT NULL DEFAULT false,
  tested_by_lab      varchar(255),
  notes              text,
  entered_by_user_id uuid         NOT NULL REFERENCES erp_users(id),
  created_at         timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE erp_em_excursions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id          uuid         NOT NULL REFERENCES erp_em_results(id),
  site_id            uuid         NOT NULL REFERENCES erp_em_sites(id),
  organism           varchar(255) NOT NULL,
  limit_type         text         NOT NULL,  -- ALERT | ACTION
  cfu_count          numeric(12,2) NOT NULL,
  limit_value        numeric(12,2) NOT NULL,
  nc_id              uuid         REFERENCES erp_nonconformances(id),
  created_at         timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_em_schedules_site     ON erp_em_schedules(site_id);
CREATE INDEX idx_em_limits_site        ON erp_em_limits(site_id);
CREATE INDEX idx_em_results_site       ON erp_em_results(site_id);
CREATE INDEX idx_em_results_sampled    ON erp_em_results(sampled_at);
CREATE INDEX idx_em_excursions_result  ON erp_em_excursions(result_id);
CREATE INDEX idx_em_excursions_nc      ON erp_em_excursions(nc_id);
