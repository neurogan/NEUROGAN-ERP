-- 0016: T-08 OOS investigation workflow.
-- Tables supporting OOS investigations per 21 CFR §111.113 / §111.123 / SOP-QC-006.
-- Application logic in server/db-storage.ts opens an investigation when pass=false is recorded.
-- This migration touches no user-adjacent tables; pnpm check:migrations passes by construction.

CREATE TABLE "erp_oos_investigations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "oos_number" text NOT NULL UNIQUE,
  "coa_document_id" varchar NOT NULL REFERENCES "erp_coa_documents"("id"),
  "lot_id" varchar NOT NULL REFERENCES "erp_lots"("id"),
  "status" text NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN','RETEST_PENDING','CLOSED')),
  "disposition" text CHECK ("disposition" IS NULL OR "disposition" IN ('APPROVED','REJECTED','RECALL','NO_INVESTIGATION_NEEDED')),
  "disposition_reason" text,
  "no_investigation_reason" text CHECK ("no_investigation_reason" IS NULL OR "no_investigation_reason" IN ('LAB_ERROR','SAMPLE_INVALID','INSTRUMENT_OUT_OF_CALIBRATION','OTHER')),
  "recall_class" text CHECK ("recall_class" IS NULL OR "recall_class" IN ('I','II','III')),
  "recall_distribution_scope" text,
  "recall_fda_notification_date" date,
  "recall_customer_notification_date" date,
  "recall_recovery_target_date" date,
  "recall_affected_lot_ids" varchar[],
  "lead_investigator_user_id" uuid REFERENCES "erp_users"("id"),
  "auto_created_at" timestamptz NOT NULL DEFAULT now(),
  "closed_by_user_id" uuid REFERENCES "erp_users"("id"),
  "closed_at" timestamptz,
  "closure_signature_id" uuid REFERENCES "erp_electronic_signatures"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "oos_closed_consistency" CHECK (
    ("status" = 'CLOSED') = (
      "closed_by_user_id" IS NOT NULL
      AND "closed_at" IS NOT NULL
      AND "closure_signature_id" IS NOT NULL
      AND "disposition" IS NOT NULL
      AND "lead_investigator_user_id" IS NOT NULL
      AND "disposition_reason" IS NOT NULL
    )
  ),
  CONSTRAINT "oos_recall_fields_required" CHECK (
    ("disposition" = 'RECALL') = (
      "recall_class" IS NOT NULL AND "recall_distribution_scope" IS NOT NULL
    )
  ),
  CONSTRAINT "oos_no_investigation_reason_consistency" CHECK (
    ("no_investigation_reason" IS NOT NULL) = ("disposition" = 'NO_INVESTIGATION_NEEDED')
  )
);

CREATE UNIQUE INDEX "oos_one_open_per_coa"
  ON "erp_oos_investigations" ("coa_document_id")
  WHERE "status" != 'CLOSED';

CREATE INDEX "oos_status_idx"          ON "erp_oos_investigations" ("status");
CREATE INDEX "oos_lot_id_idx"          ON "erp_oos_investigations" ("lot_id");
CREATE INDEX "oos_auto_created_at_idx" ON "erp_oos_investigations" ("auto_created_at" DESC);

CREATE TABLE "erp_oos_investigation_test_results" (
  "investigation_id"   uuid NOT NULL REFERENCES "erp_oos_investigations"("id") ON DELETE CASCADE,
  "lab_test_result_id" uuid NOT NULL REFERENCES "erp_lab_test_results"("id"),
  PRIMARY KEY ("investigation_id", "lab_test_result_id")
);

CREATE TABLE "erp_oos_investigation_counter" (
  "year" integer PRIMARY KEY,
  "last_seq" integer NOT NULL DEFAULT 0
);
