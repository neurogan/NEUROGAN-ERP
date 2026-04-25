CREATE TABLE "erp_lab_test_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "coa_document_id" varchar NOT NULL REFERENCES "erp_coa_documents"("id"),
  "analyte_name" text NOT NULL,
  "result_value" text NOT NULL,
  "result_units" text,
  "spec_min" text,
  "spec_max" text,
  "pass" boolean NOT NULL,
  "tested_by_user_id" uuid NOT NULL REFERENCES "erp_users"("id"),
  "tested_at" timestamp with time zone NOT NULL DEFAULT now(),
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
-- §111.75: test results must be traceable to the component lot and the
-- person who performed the test. This table provides that traceability.
