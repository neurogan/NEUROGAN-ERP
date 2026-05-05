-- 0040_receiving_boxes_sampling
-- Add sampling tracking to per-box records.
-- sampled_at: when the lab physically sampled this box (null until scanned).
-- sampled_by_id: FK to erp_users.id — who scanned it.

ALTER TABLE erp_receiving_boxes
  ADD COLUMN sampled_at    TIMESTAMPTZ,
  ADD COLUMN sampled_by_id UUID REFERENCES erp_users(id);
