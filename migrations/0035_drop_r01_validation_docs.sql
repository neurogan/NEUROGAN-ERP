-- 0035: Remove superseded R01 validation documents
--
-- Migration 0034 updated the PLATFORM documents to v2.0, expanding their scope
-- to cover all modules (F-01 through R2-04). The IQ/OQ/PQ/VSR docs that were
-- scoped specifically to the R-01 Receiving module are now fully covered by the
-- comprehensive PLATFORM v2.0 package and are therefore redundant.
--
-- These four documents were never signed (all DRAFT), so deletion is safe from
-- an audit trail perspective.

DELETE FROM erp_validation_documents
WHERE doc_id IN ('IQ-R01', 'OQ-R01', 'PQ-R01', 'VSR-R01');
