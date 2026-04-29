-- 0020: R-06 Returned Product module.
-- Closes FDA Form 483 Obs 12 (§111.503, §111.510, §111.513).
-- Adds 2 tables: erp_returned_products, erp_return_investigations.
-- Seeds 1 app_settings_kv key.

-- ── 1. erp_returned_products ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "erp_returned_products" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "return_ref"                  text NOT NULL UNIQUE,
  "source"                      text NOT NULL
                                  CHECK ("source" IN ('AMAZON_FBA','WHOLESALE','OTHER')),
  "lot_id"                      varchar REFERENCES "erp_lots"("id"),
  "lot_code_raw"                text NOT NULL,
  "qty_returned"                integer NOT NULL,
  "uom"                         text NOT NULL,
  "wholesale_customer_name"     text,
  "carrier_tracking_ref"        text,
  "received_by_user_id"         uuid NOT NULL REFERENCES "erp_users"("id"),
  "received_at"                 timestamptz NOT NULL,
  "condition_notes"             text,
  "status"                      text NOT NULL DEFAULT 'QUARANTINE'
                                  CHECK ("status" IN ('QUARANTINE','DISPOSED')),
  "disposition"                 text
                                  CHECK ("disposition" IN ('RETURN_TO_INVENTORY','DESTROY')),
  "disposition_notes"           text,
  "disposition_signature_id"    uuid REFERENCES "erp_electronic_signatures"("id"),
  "dispositioned_by_user_id"    uuid REFERENCES "erp_users"("id"),
  "dispositioned_at"            timestamptz,
  "investigation_triggered"     boolean NOT NULL DEFAULT false,
  "created_by_user_id"          uuid NOT NULL REFERENCES "erp_users"("id"),
  "created_at"                  timestamptz NOT NULL DEFAULT now(),
  "updated_at"                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "returned_products_status_idx"      ON "erp_returned_products" ("status");
CREATE INDEX IF NOT EXISTS "returned_products_lot_id_idx"      ON "erp_returned_products" ("lot_id");
CREATE INDEX IF NOT EXISTS "returned_products_received_at_idx" ON "erp_returned_products" ("received_at");

-- ── 2. erp_return_investigations ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "erp_return_investigations" (
  "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "lot_id"                  varchar NOT NULL REFERENCES "erp_lots"("id"),
  "triggered_at"            timestamptz NOT NULL,
  "returns_count"           integer NOT NULL,
  "threshold_at_trigger"    integer NOT NULL,
  "status"                  text NOT NULL DEFAULT 'OPEN'
                              CHECK ("status" IN ('OPEN','CLOSED')),
  "root_cause"              text,
  "corrective_action"       text,
  "closed_by_user_id"       uuid REFERENCES "erp_users"("id"),
  "closed_at"               timestamptz,
  "close_signature_id"      uuid REFERENCES "erp_electronic_signatures"("id"),
  "created_at"              timestamptz NOT NULL DEFAULT now(),
  "updated_at"              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "return_investigations_lot_id_idx" ON "erp_return_investigations" ("lot_id");
CREATE INDEX IF NOT EXISTS "return_investigations_status_idx" ON "erp_return_investigations" ("status");

-- ── 3. App settings ──────────────────────────────────────────────────────────

INSERT INTO "erp_app_settings_kv" ("key", "value") VALUES
  ('returnsInvestigationThresholdCount', '3')
ON CONFLICT ("key") DO NOTHING;
