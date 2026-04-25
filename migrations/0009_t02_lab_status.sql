-- T-02: Replace is_active boolean with status enum on erp_labs
ALTER TABLE erp_labs
  ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'DISQUALIFIED'));

UPDATE erp_labs SET status = 'ACTIVE'   WHERE is_active = true;
UPDATE erp_labs SET status = 'INACTIVE' WHERE is_active = false;

ALTER TABLE erp_labs DROP COLUMN is_active;
