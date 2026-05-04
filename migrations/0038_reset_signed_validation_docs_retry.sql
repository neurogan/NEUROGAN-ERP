-- 0038: Reset signed validation docs to DRAFT (retry)
--
-- Migration 0037 was assigned a `when` timestamp that collided with an
-- earlier migration in the runner's deduplication table, causing it to be
-- silently skipped. This migration is identical in effect but carries a
-- guaranteed-unique timestamp (sequential from 0034).
--
-- Idempotent: only touches SIGNED docs; no-op if already DRAFT.

UPDATE erp_validation_documents
SET status = 'DRAFT', signature_id = NULL, updated_at = now()
WHERE status = 'SIGNED';
