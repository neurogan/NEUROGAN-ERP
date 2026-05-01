-- R-08: BPR hardening — process deviation Part 11 sign-off
-- Adds signature_id FK to erp_bpr_deviations so each deviation can be
-- independently signed by QA before the BPR can be approved.
-- Existing columns (reviewed_by, reviewed_at, signature_of_reviewer) are
-- retained for historical data; no longer written by new code.

ALTER TABLE erp_bpr_deviations
  ADD COLUMN signature_id uuid REFERENCES erp_electronic_signatures(id);
