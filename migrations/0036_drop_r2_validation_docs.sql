-- 0036: Remove R2 module-specific validation docs
--
-- Migration 0034 inserted IQ/OQ/PQ/VSR docs scoped to R2 modules alongside
-- the existing PLATFORM docs. The PLATFORM v2.0 docs (also updated in 0034)
-- already cover F-01 through R2-04 comprehensively, making the R2-specific
-- set redundant. Remove the four R2 docs to keep a clean set of 4 documents.
--
-- These docs were never signed (DRAFT since insertion).

DELETE FROM erp_validation_documents
WHERE doc_id IN ('IQ-R2', 'OQ-R2', 'PQ-R2', 'VSR-R2');
