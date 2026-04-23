-- F-10: Platform validation documents (IQ / OQ / PQ / VSR)
--
-- Stores GAMP 5 Category 5 validation documents as records in the ERP.
-- Documents transition DRAFT → SIGNED via the F-04 electronic signature
-- ceremony. Once signed, content is frozen.

CREATE TABLE IF NOT EXISTS erp_validation_documents (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id       TEXT        NOT NULL UNIQUE,
  title        TEXT        NOT NULL,
  type         TEXT        NOT NULL,
  module       TEXT        NOT NULL,
  content      TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'DRAFT',
  signature_id UUID        REFERENCES erp_electronic_signatures(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_vdoc_status CHECK (status IN ('DRAFT', 'SIGNED')),
  CONSTRAINT chk_vdoc_type   CHECK (type IN ('IQ', 'OQ', 'PQ', 'VSR'))
);

CREATE INDEX idx_vdoc_module_type
  ON erp_validation_documents (module, type);

-- Protect signed document content: revoke DELETE from public; keep UPDATE for the sign operation.
-- INSERT is needed to seed documents; SELECT for all queries.
REVOKE DELETE ON erp_validation_documents FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON erp_validation_documents TO erp_app;
-- Run manually if migration was already applied: REVOKE DELETE ON erp_validation_documents FROM PUBLIC;
