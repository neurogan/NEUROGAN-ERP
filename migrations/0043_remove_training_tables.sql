-- Remove R2-04 training gate tables.
--
-- The personnel qualification matrix (§111.12-14) requirement is now satisfied
-- by storing training records in the SOPs subsystem instead of a separate
-- Training module. The dedicated tables, routes, and UI are removed.
--
-- Drop order respects foreign keys: assignments → records → programs.

DROP TABLE IF EXISTS "erp_training_assignments" CASCADE;
DROP TABLE IF EXISTS "erp_training_records" CASCADE;
DROP TABLE IF EXISTS "erp_training_programs" CASCADE;
