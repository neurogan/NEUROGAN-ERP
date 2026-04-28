-- 0018: R-04 Labeling & Reconciliation module.
-- Closes FDA Form 483 Obs 9 (§111.415(f), §111.260(g) — label reconciliation)
-- and the ERP side of Obs 10 (§111.415 — labeling/packaging SOPs).
--
-- Adds 6 tables:
--   erp_label_artwork, erp_label_spools, erp_label_issuance_log,
--   erp_label_print_jobs, erp_label_reconciliations, erp_sops
-- Extends erp_bpr_steps with sop_code + sop_version.
-- Creates erp_app_settings_kv key-value store and seeds labeling defaults.
-- Touches no user-adjacent tables; pnpm check:migrations passes by construction.
--
-- NOTE: erp_electronic_signatures is the actual signature table (not erp_signatures).
--       erp_bpr_deviations is the actual deviations table (not erp_deviations).
--       erp_app_settings is a wide single-row config table; labeling settings
--       use the new erp_app_settings_kv key-value table instead.

-- ── 1. erp_label_artwork ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "erp_label_artwork" (
  "id"                        uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id"                varchar NOT NULL REFERENCES "erp_products"("id"),
  "version"                   text NOT NULL,
  "artwork_file_data"         text NOT NULL,
  "artwork_file_name"         text NOT NULL,
  "artwork_mime_type"         text NOT NULL,
  "variable_data_spec"        jsonb NOT NULL DEFAULT '{}',
  "status"                    text NOT NULL DEFAULT 'DRAFT'
                                CHECK ("status" IN ('DRAFT','APPROVED','RETIRED')),
  "approved_by_signature_id"  uuid REFERENCES "erp_electronic_signatures"("id"),
  "approved_at"               timestamptz,
  "retired_by_signature_id"   uuid REFERENCES "erp_electronic_signatures"("id"),
  "retired_at"                timestamptz,
  "created_at"                timestamptz NOT NULL DEFAULT now(),
  UNIQUE("product_id", "version"),
  CONSTRAINT "artwork_approval_consistency"
    CHECK (
      ("status" != 'APPROVED') OR ("approved_by_signature_id" IS NOT NULL AND "approved_at" IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS "label_artwork_product_status_idx"
  ON "erp_label_artwork" ("product_id", "status");

-- ── 2. erp_label_spools ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "erp_label_spools" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "artwork_id"                  uuid NOT NULL REFERENCES "erp_label_artwork"("id"),
  "spool_number"                text NOT NULL,
  "qty_initial"                 integer NOT NULL CHECK ("qty_initial" > 0),
  "qty_on_hand"                 integer NOT NULL CHECK ("qty_on_hand" >= 0),
  "location_id"                 varchar REFERENCES "erp_locations"("id"),
  "status"                      text NOT NULL DEFAULT 'ACTIVE'
                                  CHECK ("status" IN ('ACTIVE','DEPLETED','QUARANTINED','DISPOSED')),
  "received_by_signature_id"    uuid REFERENCES "erp_electronic_signatures"("id"),
  "disposed_by_signature_id"    uuid REFERENCES "erp_electronic_signatures"("id"),
  "disposed_at"                 timestamptz,
  "dispose_reason"              text,
  "created_at"                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE("artwork_id", "spool_number"),
  CONSTRAINT "spool_qty_on_hand_lte_initial"
    CHECK ("qty_on_hand" <= "qty_initial")
);

CREATE INDEX IF NOT EXISTS "label_spools_artwork_status_idx"
  ON "erp_label_spools" ("artwork_id", "status");

-- ── 3. erp_label_issuance_log ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "erp_label_issuance_log" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bpr_id"              varchar NOT NULL REFERENCES "erp_batch_production_records"("id"),
  "spool_id"            uuid NOT NULL REFERENCES "erp_label_spools"("id"),
  "artwork_id"          uuid NOT NULL REFERENCES "erp_label_artwork"("id"),
  "quantity_issued"     integer NOT NULL CHECK ("quantity_issued" > 0),
  "issued_by_user_id"   uuid NOT NULL REFERENCES "erp_users"("id"),
  "issued_at"           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "label_issuance_bpr_idx"    ON "erp_label_issuance_log" ("bpr_id");
CREATE INDEX IF NOT EXISTS "label_issuance_spool_idx"  ON "erp_label_issuance_log" ("spool_id");

-- ── 4. erp_label_print_jobs ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "erp_label_print_jobs" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "issuance_log_id"     uuid NOT NULL REFERENCES "erp_label_issuance_log"("id"),
  "lot"                 text NOT NULL,
  "expiry"              date NOT NULL,
  "qty_printed"         integer NOT NULL CHECK ("qty_printed" > 0),
  "adapter"             text NOT NULL CHECK ("adapter" IN ('ZPL_TCP','STUB')),
  "status"              text NOT NULL CHECK ("status" IN ('SUCCESS','FAILED','PARTIAL')),
  "result_json"         jsonb,
  "signature_id"        uuid REFERENCES "erp_electronic_signatures"("id"),
  "created_at"          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "label_print_jobs_issuance_idx"
  ON "erp_label_print_jobs" ("issuance_log_id");

-- ── 5. erp_label_reconciliations ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "erp_label_reconciliations" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bpr_id"              varchar NOT NULL REFERENCES "erp_batch_production_records"("id") UNIQUE,
  "qty_issued"          integer NOT NULL,
  "qty_applied"         integer NOT NULL,
  "qty_destroyed"       integer NOT NULL,
  "qty_returned"        integer NOT NULL,
  "variance"            integer NOT NULL,
  "tolerance_exceeded"  boolean NOT NULL DEFAULT false,
  "proof_file_data"     text,
  "proof_mime_type"     text,
  "deviation_id"        varchar REFERENCES "erp_bpr_deviations"("id"),
  "signature_id"        uuid REFERENCES "erp_electronic_signatures"("id"),
  "reconciled_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "reconciliation_qty_non_negative"
    CHECK ("qty_applied" >= 0 AND "qty_destroyed" >= 0 AND "qty_returned" >= 0),
  CONSTRAINT "reconciliation_tolerance_requires_deviation"
    CHECK (("tolerance_exceeded" = false) OR ("deviation_id" IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS "label_reconciliations_bpr_idx"
  ON "erp_label_reconciliations" ("bpr_id");

-- ── 6. erp_sops ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "erp_sops" (
  "id"                        uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code"                      text NOT NULL,
  "title"                     text NOT NULL,
  "version"                   text NOT NULL,
  "status"                    text NOT NULL DEFAULT 'DRAFT'
                                CHECK ("status" IN ('DRAFT','APPROVED','RETIRED')),
  "approved_by_signature_id"  uuid REFERENCES "erp_electronic_signatures"("id"),
  "approved_at"               timestamptz,
  "retired_by_signature_id"   uuid REFERENCES "erp_electronic_signatures"("id"),
  "retired_at"                timestamptz,
  "created_at"                timestamptz NOT NULL DEFAULT now(),
  UNIQUE("code", "version"),
  CONSTRAINT "sop_approval_consistency"
    CHECK (
      ("status" != 'APPROVED') OR ("approved_by_signature_id" IS NOT NULL AND "approved_at" IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS "sops_status_idx" ON "erp_sops" ("status");

-- ── 7. erp_bpr_steps extension ─────────────────────────────────────────────

ALTER TABLE "erp_bpr_steps" ADD COLUMN IF NOT EXISTS "sop_code"    text;
ALTER TABLE "erp_bpr_steps" ADD COLUMN IF NOT EXISTS "sop_version" text;

-- ── 8. erp_app_settings_kv — key-value store for labeling runtime config ───
-- (Distinct from the wide erp_app_settings table which is a single-row config.)

CREATE TABLE IF NOT EXISTS "erp_app_settings_kv" (
  "key"        text PRIMARY KEY NOT NULL,
  "value"      text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "erp_app_settings_kv" ("key", "value") VALUES
  ('labelToleranceAbs',  '5'),
  ('labelPrintAdapter',  'STUB'),
  ('labelPrintHost',     ''),
  ('labelPrintPort',     '9100')
ON CONFLICT ("key") DO NOTHING;
