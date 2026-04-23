-- F-04: Electronic signatures (21 CFR Part 11 §11.50 / §11.70 / §11.100)
--
-- Each regulated state transition is accompanied by an e-signature row that
-- captures the signer's identity at the moment of signing (not a live FK
-- join), the intended meaning, and a JSON manifestation suitable for
-- rendering on a printable record.

CREATE TABLE IF NOT EXISTS erp_electronic_signatures (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  signed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id         UUID        NOT NULL REFERENCES erp_users(id),
  meaning         TEXT        NOT NULL,
  entity_type     TEXT        NOT NULL,
  entity_id       TEXT        NOT NULL,
  commentary      TEXT,
  full_name_at_signing TEXT   NOT NULL,
  title_at_signing     TEXT,
  request_id      TEXT        NOT NULL,
  manifestation_json JSONB    NOT NULL,

  CONSTRAINT chk_sig_signed_at_not_future
    CHECK (signed_at <= now() + INTERVAL '1 minute')
);

CREATE INDEX idx_esig_entity
  ON erp_electronic_signatures (entity_type, entity_id, signed_at DESC);

CREATE INDEX idx_esig_user
  ON erp_electronic_signatures (user_id, signed_at DESC);

-- Signatures are append-only: the application role may INSERT but never
-- UPDATE or DELETE. This mirrors the audit trail guarantee (D-07).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_app') THEN
    CREATE ROLE erp_app;
  END IF;
END
$$;

REVOKE UPDATE, DELETE ON erp_electronic_signatures FROM PUBLIC;
GRANT SELECT, INSERT ON erp_electronic_signatures TO erp_app;
