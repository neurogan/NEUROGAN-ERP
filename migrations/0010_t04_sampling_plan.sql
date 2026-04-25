-- T-04: Z1.4 sampling plan stored with receiving record for audit trail
ALTER TABLE erp_receiving_records
  ADD COLUMN sampling_plan JSONB;
