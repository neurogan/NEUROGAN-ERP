-- T-06: LAB_TECH is a new application-level role.
-- erp_user_roles.role is text with no DB-level enum constraint,
-- so no column change is needed. This migration is intentionally
-- a no-op SQL comment to preserve the migration chain record.
-- §111.12(c): separation of duties — lab tech performs testing,
-- QA performs disposition. These are distinct roles.
SELECT 1; -- sentinel
