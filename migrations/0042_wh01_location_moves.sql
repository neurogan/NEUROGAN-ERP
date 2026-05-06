-- WH-01: Warehouse Location Move
-- Creates erp_location_moves table for recording physical material moves
-- after QC approval. Introduces APPROVED_PENDING_MOVE as an intermediate
-- receiving record status between QC sign-off and warehouse confirmation.
--
-- 21 CFR §111.80(b): physical segregation records for quarantined components.

CREATE TABLE erp_location_moves (
  id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id              VARCHAR NOT NULL REFERENCES erp_lots(id),
  from_location_id    VARCHAR REFERENCES erp_locations(id),
  to_location_id      VARCHAR NOT NULL REFERENCES erp_locations(id),
  moved_by            VARCHAR NOT NULL REFERENCES erp_users(id),
  moved_at            TIMESTAMP NOT NULL DEFAULT now(),
  notes               TEXT,
  receiving_record_id VARCHAR REFERENCES erp_receiving_records(id)
);
