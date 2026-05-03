-- R-08 cleanup: drop legacy reviewer columns that were never written by current code.
-- The Part-11 signature for deviation disposition is captured via erp_electronic_signatures
-- (signatureId FK already on the table). These three text columns are dead weight.

ALTER TABLE erp_bpr_deviations
  DROP COLUMN IF EXISTS reviewed_by,
  DROP COLUMN IF EXISTS reviewed_at,
  DROP COLUMN IF EXISTS signature_of_reviewer;
