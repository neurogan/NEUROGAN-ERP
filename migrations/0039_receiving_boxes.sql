-- 0039_receiving_boxes
-- Per-box tracking records linked to a receiving record.
-- Each row is one physical container from an incoming shipment.
-- box_label is the human-readable+scannable ID printed as a barcode.

CREATE TABLE erp_receiving_boxes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receiving_record_id VARCHAR NOT NULL REFERENCES erp_receiving_records(id) ON DELETE CASCADE,
  box_number          INTEGER NOT NULL,
  box_label           TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (receiving_record_id, box_number)
);

CREATE INDEX idx_receiving_boxes_record_id ON erp_receiving_boxes(receiving_record_id);
