-- 0017: R-03 Equipment & Cleaning module.
-- Closes 483 Obs 3. Adds equipment master, IQ/OQ/PQ qualifications,
-- calibration schedule + records, cleaning logs (F-05 dual-verification),
-- line clearances, and BPR equipment-used junction.
-- Touches no user-adjacent tables; pnpm check:migrations passes by construction.

CREATE TABLE IF NOT EXISTS "erp_equipment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_tag" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "model" text,
  "serial" text,
  "manufacturer" text,
  "location_id" varchar REFERENCES "erp_locations"("id"),
  "status" text NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','RETIRED')),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "equipment_status_idx" ON "erp_equipment" ("status");

CREATE TABLE IF NOT EXISTS "erp_equipment_qualifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "equipment_id" uuid NOT NULL REFERENCES "erp_equipment"("id"),
  "type" text NOT NULL CHECK ("type" IN ('IQ','OQ','PQ')),
  "status" text NOT NULL CHECK ("status" IN ('PENDING','QUALIFIED','EXPIRED')),
  "valid_from" date,
  "valid_until" date,
  "signature_id" uuid REFERENCES "erp_electronic_signatures"("id"),
  "document_url" text,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "qualification_signed_when_qualified" CHECK (
    ("status" = 'QUALIFIED') = ("signature_id" IS NOT NULL AND "valid_from" IS NOT NULL AND "valid_until" IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS "qualifications_equipment_type_idx" ON "erp_equipment_qualifications" ("equipment_id", "type");

CREATE TABLE IF NOT EXISTS "erp_calibration_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "equipment_id" uuid NOT NULL UNIQUE REFERENCES "erp_equipment"("id"),
  "frequency_days" integer NOT NULL CHECK ("frequency_days" > 0),
  "next_due_at" timestamptz NOT NULL,
  "last_record_id" uuid
);

CREATE TABLE IF NOT EXISTS "erp_calibration_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "equipment_id" uuid NOT NULL REFERENCES "erp_equipment"("id"),
  "performed_at" timestamptz NOT NULL DEFAULT now(),
  "performed_by_user_id" uuid NOT NULL REFERENCES "erp_users"("id"),
  "result" text NOT NULL CHECK ("result" IN ('PASS','FAIL')),
  "cert_url" text,
  "signature_id" uuid NOT NULL REFERENCES "erp_electronic_signatures"("id"),
  "notes" text
);
CREATE INDEX IF NOT EXISTS "calibration_records_equipment_at_idx" ON "erp_calibration_records" ("equipment_id", "performed_at" DESC);

DO $$ BEGIN
  ALTER TABLE "erp_calibration_schedules"
    ADD CONSTRAINT "calibration_schedules_last_record_fk"
    FOREIGN KEY ("last_record_id") REFERENCES "erp_calibration_records"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "erp_cleaning_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "equipment_id" uuid NOT NULL REFERENCES "erp_equipment"("id"),
  "cleaned_at" timestamptz NOT NULL DEFAULT now(),
  "cleaned_by_user_id" uuid NOT NULL REFERENCES "erp_users"("id"),
  "verified_by_user_id" uuid NOT NULL REFERENCES "erp_users"("id"),
  "method" text,
  "prior_product_id" varchar REFERENCES "erp_products"("id"),
  "next_product_id" varchar REFERENCES "erp_products"("id"),
  "signature_id" uuid NOT NULL REFERENCES "erp_electronic_signatures"("id"),
  "notes" text,
  CONSTRAINT "cleaning_dual_verification" CHECK ("cleaned_by_user_id" <> "verified_by_user_id")
);
CREATE INDEX IF NOT EXISTS "cleaning_logs_equipment_at_idx" ON "erp_cleaning_logs" ("equipment_id", "cleaned_at" DESC);

CREATE TABLE IF NOT EXISTS "erp_line_clearances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "equipment_id" uuid NOT NULL REFERENCES "erp_equipment"("id"),
  "product_change_from_id" varchar REFERENCES "erp_products"("id"),
  "product_change_to_id" varchar NOT NULL REFERENCES "erp_products"("id"),
  "performed_at" timestamptz NOT NULL DEFAULT now(),
  "performed_by_user_id" uuid NOT NULL REFERENCES "erp_users"("id"),
  "signature_id" uuid NOT NULL REFERENCES "erp_electronic_signatures"("id"),
  "notes" text
);
CREATE INDEX IF NOT EXISTS "line_clearances_equipment_at_idx" ON "erp_line_clearances" ("equipment_id", "performed_at" DESC);

CREATE TABLE IF NOT EXISTS "erp_product_equipment" (
  "product_id" varchar NOT NULL REFERENCES "erp_products"("id"),
  "equipment_id" uuid NOT NULL REFERENCES "erp_equipment"("id"),
  PRIMARY KEY ("product_id", "equipment_id")
);

CREATE TABLE IF NOT EXISTS "erp_production_batch_equipment_used" (
  "production_batch_id" varchar NOT NULL REFERENCES "erp_production_batches"("id"),
  "equipment_id" uuid NOT NULL REFERENCES "erp_equipment"("id"),
  PRIMARY KEY ("production_batch_id", "equipment_id")
);

-- BPR free-text cleaning reference: rename to legacy column, add FK.
-- NEVER deletes data. Idempotent via duplicate_column / undefined_column guards.
DO $$ BEGIN
  ALTER TABLE "erp_batch_production_records" RENAME COLUMN "cleaning_record_reference" TO "cleaning_record_legacy_text";
EXCEPTION
  WHEN undefined_column THEN NULL;     -- already renamed
  WHEN duplicate_column THEN NULL;     -- legacy column already exists
END $$;

DO $$ BEGIN
  ALTER TABLE "erp_batch_production_records" ADD COLUMN "cleaning_log_id" uuid REFERENCES "erp_cleaning_logs"("id");
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
