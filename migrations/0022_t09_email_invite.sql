ALTER TABLE erp_users
  ADD COLUMN invite_token_hash       TEXT,
  ADD COLUMN invite_token_expires_at TIMESTAMPTZ;
