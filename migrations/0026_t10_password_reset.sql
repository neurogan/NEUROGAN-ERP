ALTER TABLE erp_users
  ADD COLUMN reset_token_hash        TEXT,
  ADD COLUMN reset_token_expires_at  TIMESTAMPTZ;
