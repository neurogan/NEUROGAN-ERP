-- T-01: Rename RECEIVING role to WAREHOUSE
-- Role is stored as plain TEXT; no Postgres enum to ALTER.
UPDATE erp_user_roles SET role = 'WAREHOUSE' WHERE role = 'RECEIVING';
