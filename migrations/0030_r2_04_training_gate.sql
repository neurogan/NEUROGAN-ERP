-- R2-04 Training Gate (§111.12–14)
-- Personnel qualification / training matrix

CREATE TABLE erp_training_programs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                varchar(255) NOT NULL,
  version             varchar(50)  NOT NULL DEFAULT '1.0',
  description         text,
  validity_days       integer      NOT NULL DEFAULT 365,
  required_for_roles  text[]       NOT NULL DEFAULT '{}',
  document_url        text,
  is_active           boolean      NOT NULL DEFAULT true,
  created_by_user_id  uuid         NOT NULL REFERENCES erp_users(id),
  created_at          timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE erp_training_records (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES erp_users(id),
  program_id            uuid NOT NULL REFERENCES erp_training_programs(id),
  completed_at          timestamp with time zone NOT NULL,
  expires_at            timestamp with time zone NOT NULL,
  trained_by_user_id    uuid REFERENCES erp_users(id),
  trained_by_external   varchar(255),
  document_url          text,
  notes                 text,
  signature_id          uuid REFERENCES erp_electronic_signatures(id),
  created_by_user_id    uuid NOT NULL REFERENCES erp_users(id),
  created_at            timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE erp_training_assignments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES erp_users(id),
  program_id          uuid NOT NULL REFERENCES erp_training_programs(id),
  due_at              timestamp with time zone NOT NULL,
  status              text NOT NULL DEFAULT 'PENDING',
  training_record_id  uuid REFERENCES erp_training_records(id),
  created_by_user_id  uuid NOT NULL REFERENCES erp_users(id),
  created_at          timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_training_records_user_program ON erp_training_records(user_id, program_id);
CREATE INDEX idx_training_records_expires_at   ON erp_training_records(expires_at);
CREATE INDEX idx_training_assignments_user     ON erp_training_assignments(user_id, status);
