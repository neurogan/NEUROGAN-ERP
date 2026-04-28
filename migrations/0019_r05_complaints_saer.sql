-- 0019: R-05 Complaints & SAER module.
-- Closes FDA Form 483 Obs 7 (complaints not reviewed by qualified person; AEs not investigated)
-- and Obs 8 (complaint records lack lot number).
--
-- Adds 6 tables:
--   erp_complaints, erp_complaint_triages, erp_complaint_investigations,
--   erp_complaint_lab_retests, erp_adverse_events, erp_saer_submissions
-- Seeds helpcore system user (UUID 00000000-0000-0000-cafe-000000000001).
-- Inserts 7 app_settings_kv keys.
-- Touches no existing user rows; pnpm check:migrations passes by construction.

-- ── 1. erp_complaints ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "erp_complaints" (
  "id"                        uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "helpcore_ref"              text NOT NULL UNIQUE,
  "source"                    text NOT NULL
                                CHECK ("source" IN ('HELPCORE','MANUAL')),
  "customer_name"             text NOT NULL,
  "customer_email"            text NOT NULL,
  "customer_phone"            text,
  "complaint_text"            text NOT NULL,
  "lot_code_raw"              text NOT NULL,
  "lot_id"                    varchar REFERENCES "erp_lots"("id"),
  "status"                    text NOT NULL
                                CHECK ("status" IN (
                                  'TRIAGE','LOT_UNRESOLVED','INVESTIGATION',
                                  'AE_URGENT_REVIEW','AWAITING_DISPOSITION',
                                  'CLOSED','CANCELLED'
                                )),
  "severity"                  text
                                CHECK ("severity" IN ('LOW','MEDIUM','HIGH')),
  "defect_category"           text
                                CHECK ("defect_category" IN (
                                  'FOREIGN_MATTER','LABEL','POTENCY',
                                  'TASTE_SMELL','PACKAGE','CUSTOMER_USE_ERROR','OTHER'
                                )),
  "ae_flag"                   boolean NOT NULL DEFAULT false,
  "assigned_user_id"          uuid REFERENCES "erp_users"("id"),
  "intake_at"                 timestamptz NOT NULL,
  "triaged_at"                timestamptz,
  "investigated_at"           timestamptz,
  "dispositioned_at"          timestamptz,
  "closed_at"                 timestamptz,
  "disposition_signature_id"  uuid REFERENCES "erp_electronic_signatures"("id"),
  "disposition_summary"       text,
  "capa_required"             boolean,
  "capa_ref"                  text,
  "helpcore_callback_at"      timestamptz,
  "created_at"                timestamptz NOT NULL DEFAULT now(),
  "updated_at"                timestamptz NOT NULL DEFAULT now(),
  "created_by_user_id"        uuid NOT NULL REFERENCES "erp_users"("id")
);

CREATE INDEX IF NOT EXISTS "complaints_status_idx"    ON "erp_complaints" ("status");
CREATE INDEX IF NOT EXISTS "complaints_lot_id_idx"    ON "erp_complaints" ("lot_id");
CREATE INDEX IF NOT EXISTS "complaints_intake_at_idx" ON "erp_complaints" ("intake_at");

-- ── 2. erp_complaint_triages ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "erp_complaint_triages" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "complaint_id"          uuid NOT NULL REFERENCES "erp_complaints"("id"),
  "triaged_by_user_id"    uuid NOT NULL REFERENCES "erp_users"("id"),
  "triaged_at"            timestamptz NOT NULL,
  "severity"              text NOT NULL
                            CHECK ("severity" IN ('LOW','MEDIUM','HIGH')),
  "defect_category"       text NOT NULL
                            CHECK ("defect_category" IN (
                              'FOREIGN_MATTER','LABEL','POTENCY',
                              'TASTE_SMELL','PACKAGE','CUSTOMER_USE_ERROR','OTHER'
                            )),
  "ae_flag"               boolean NOT NULL,
  "batch_link_confirmed"  boolean NOT NULL,
  "notes"                 text,
  "created_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "complaint_triages_complaint_idx"
  ON "erp_complaint_triages" ("complaint_id");

-- ── 3. erp_complaint_investigations ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "erp_complaint_investigations" (
  "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "complaint_id"             uuid NOT NULL REFERENCES "erp_complaints"("id"),
  "investigated_by_user_id"  uuid NOT NULL REFERENCES "erp_users"("id"),
  "investigated_at"          timestamptz NOT NULL,
  "root_cause"               text NOT NULL,
  "scope"                    text NOT NULL,
  "bpr_id"                   varchar REFERENCES "erp_batch_production_records"("id"),
  "coa_id"                   varchar REFERENCES "erp_coa_documents"("id"),
  "retest_required"          boolean NOT NULL,
  "summary_for_review"       text NOT NULL,
  "packaged_at"              timestamptz,
  "packaged_by_user_id"      uuid REFERENCES "erp_users"("id"),
  "created_at"               timestamptz NOT NULL DEFAULT now(),
  "updated_at"               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "complaint_investigations_complaint_idx"
  ON "erp_complaint_investigations" ("complaint_id");

-- ── 4. erp_complaint_lab_retests ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "erp_complaint_lab_retests" (
  "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "complaint_id"            uuid NOT NULL REFERENCES "erp_complaints"("id"),
  "investigation_id"        uuid NOT NULL REFERENCES "erp_complaint_investigations"("id"),
  "requested_by_user_id"    uuid NOT NULL REFERENCES "erp_users"("id"),
  "requested_at"            timestamptz NOT NULL,
  "lot_id"                  varchar NOT NULL REFERENCES "erp_lots"("id"),
  "method"                  text NOT NULL,
  "assigned_lab_user_id"    uuid NOT NULL REFERENCES "erp_users"("id"),
  "lab_test_result_id"      uuid REFERENCES "erp_lab_test_results"("id"),
  "completed_at"            timestamptz,
  "created_at"              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "complaint_lab_retests_complaint_idx"
  ON "erp_complaint_lab_retests" ("complaint_id");

-- ── 5. erp_adverse_events ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "erp_adverse_events" (
  "id"                           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "complaint_id"                 uuid NOT NULL UNIQUE REFERENCES "erp_complaints"("id"),
  "serious"                      boolean NOT NULL,
  "serious_criteria"             jsonb NOT NULL,
  "urgent_reviewed_by_user_id"   uuid NOT NULL REFERENCES "erp_users"("id"),
  "urgent_reviewed_at"           timestamptz NOT NULL,
  "medwatch_required"            boolean NOT NULL,
  "clock_started_at"             timestamptz NOT NULL,
  "due_at"                       timestamptz NOT NULL,
  "status"                       text NOT NULL DEFAULT 'OPEN'
                                   CHECK ("status" IN ('OPEN','SUBMITTED','CLOSED')),
  "created_at"                   timestamptz NOT NULL DEFAULT now(),
  "updated_at"                   timestamptz NOT NULL DEFAULT now()
);

-- ── 6. erp_saer_submissions ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "erp_saer_submissions" (
  "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "adverse_event_id"        uuid NOT NULL UNIQUE REFERENCES "erp_adverse_events"("id"),
  "draft_json"              jsonb NOT NULL,
  "submitted_at"            timestamptz,
  "submitted_by_user_id"    uuid REFERENCES "erp_users"("id"),
  "signature_id"            uuid REFERENCES "erp_electronic_signatures"("id"),
  "acknowledgment_ref"      text,
  "submission_proof_path"   text,
  "created_at"              timestamptz NOT NULL DEFAULT now(),
  "updated_at"              timestamptz NOT NULL DEFAULT now()
);

-- ── 7. Seed HelpCore system user ─────────────────────────────────────────────
-- Fixed UUID used in code as HELPCORE_SYSTEM_USER_ID.
-- Password hash is an unguessable bcrypt string; login is disabled by convention
-- (no UI surface accepts this email). No roles assigned.

INSERT INTO "erp_users" (
  "id", "email", "full_name", "title",
  "password_hash", "status", "created_at"
)
VALUES (
  '00000000-0000-0000-cafe-000000000001',
  'helpcore-system@neurogan.internal',
  'HelpCore System',
  NULL,
  '$2b$12$HELPCORE.SYSTEM.USER.DISABLED.NOT.A.REAL.HASH.XXXXXXXXXXXXXX',
  'ACTIVE',
  now()
)
ON CONFLICT ("id") DO NOTHING;

-- ── 8. App settings keys ─────────────────────────────────────────────────────

INSERT INTO "erp_app_settings_kv" ("key", "value") VALUES
  ('complaintTriageSlaBusinessDays', '1'),
  ('dispositionSlaBusinessDays',     '5'),
  ('saerClockBusinessDays',          '15'),
  ('usFederalHolidaysJson',          '["2026-01-01","2026-01-19","2026-02-16","2026-05-25","2026-06-19","2026-07-03","2026-07-04","2026-09-07","2026-10-12","2026-11-11","2026-11-26","2026-12-25","2027-01-01","2027-01-18","2027-02-15","2027-05-31","2027-06-18","2027-06-19","2027-07-04","2027-07-05","2027-09-06","2027-10-11","2027-11-11","2027-11-25","2027-12-24","2027-12-25"]'),
  ('facilityName',                   'Neurogan, Inc.'),
  ('facilityAddress',                ''),
  ('facilityContactPhone',           '')
ON CONFLICT ("key") DO NOTHING;
