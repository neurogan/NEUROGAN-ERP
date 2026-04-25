-- 0015: T-07 lab qualification lifecycle.
-- Records each qualify/disqualify event for third-party labs per 21 CFR §111.75(h)(2).

CREATE TABLE "erp_lab_qualifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "lab_id" uuid NOT NULL REFERENCES "erp_labs"("id"),
  "event_type" text NOT NULL,
  "performed_by_user_id" uuid NOT NULL REFERENCES "erp_users"("id"),
  "performed_at" timestamptz NOT NULL DEFAULT now(),
  "qualification_method" text,
  "requalification_frequency_months" integer,
  "next_requalification_due" text,
  "notes" text
);
