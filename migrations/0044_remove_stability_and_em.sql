-- Remove R2-01 Stability Program and R2-02 Environmental Monitoring tables.
--
-- Same rationale as 0043 (training removal): the modules were built as part
-- of the FDA compliance package but are not in active use. §111.210(f)
-- (stability) and §111.15 (EM) compliance will be met via external lab
-- documentation referenced in the validation package; the ERP can rebuild
-- these subsystems when actual data collection begins.
--
-- Drop order respects foreign keys.

-- ─── R2-02 Environmental Monitoring ────────────────────────
DROP TABLE IF EXISTS "erp_em_excursions" CASCADE;
DROP TABLE IF EXISTS "erp_em_results" CASCADE;
DROP TABLE IF EXISTS "erp_em_limits" CASCADE;
DROP TABLE IF EXISTS "erp_em_schedules" CASCADE;
DROP TABLE IF EXISTS "erp_em_sites" CASCADE;

-- ─── R2-01 Stability Program ───────────────────────────────
DROP TABLE IF EXISTS "erp_stability_conclusions" CASCADE;
DROP TABLE IF EXISTS "erp_stability_results" CASCADE;
DROP TABLE IF EXISTS "erp_stability_timepoints" CASCADE;
DROP TABLE IF EXISTS "erp_stability_batches" CASCADE;
DROP TABLE IF EXISTS "erp_stability_protocol_attributes" CASCADE;
DROP TABLE IF EXISTS "erp_stability_protocols" CASCADE;
