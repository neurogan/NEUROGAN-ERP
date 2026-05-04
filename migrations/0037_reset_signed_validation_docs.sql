-- 0037: Reset any still-signed validation documents to DRAFT
--
-- Migrations 0034-0036 were intended to reset all docs to DRAFT with v2.0
-- content, but production's migration tracker may have already recorded those
-- migrations as applied (from a prior failed deploy), causing them to be
-- skipped. This migration is idempotent: only touches SIGNED docs so it is
-- safe to run even if 0034 already executed correctly.
--
-- Signatories must re-sign the updated v2.0 documents after this runs.

UPDATE erp_validation_documents
SET status = 'DRAFT', signature_id = NULL, updated_at = now()
WHERE status = 'SIGNED';
