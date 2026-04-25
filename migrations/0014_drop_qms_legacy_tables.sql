-- 0014: Drop the seven orphaned qms_* tables created by the frozen dev branch.
-- These tables were auto-migrated by the old Perplexity prototype before the
-- erp_ prefix convention was adopted. No current code references them.

DROP TABLE IF EXISTS qms_audit_log;
DROP TABLE IF EXISTS qms_signatures;
DROP TABLE IF EXISTS qms_lot_releases;
DROP TABLE IF EXISTS qms_complaints;
DROP TABLE IF EXISTS qms_capa_actions;
DROP TABLE IF EXISTS qms_capas;
DROP TABLE IF EXISTS qms_users;
