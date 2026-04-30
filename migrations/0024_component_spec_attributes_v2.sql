-- Extend componentSpecAttributes with verification source, frequency, result type, and spec text
ALTER TABLE erp_component_spec_attributes
  ADD COLUMN verification_source TEXT,   -- NEUROGAN_IN_HOUSE | SUPPLIER_COA | THIRD_PARTY_LAB | SUPPLIER_DECLARATION
  ADD COLUMN frequency           TEXT,   -- EVERY_LOT | ANNUAL | PERIODIC
  ADD COLUMN result_type         TEXT,   -- NUMERIC | PASS_FAIL | TEXT
  ADD COLUMN specification_text  TEXT;   -- free-text criterion for Pass-Fail / Text rows

-- Extend componentSpecs header with document metadata and storage/packaging rules
ALTER TABLE erp_component_specs
  ADD COLUMN document_number    TEXT,    -- e.g. CSPEC-RES01
  ADD COLUMN synonyms           TEXT,    -- e.g. "3,5,4′-Trihydroxy-trans-stilbene"
  ADD COLUMN cas_number         TEXT,    -- e.g. 501-36-0
  ADD COLUMN botanical_source   TEXT,    -- e.g. "Polygonum cuspidatum root"
  ADD COLUMN country_of_origin  TEXT,    -- e.g. "China"
  ADD COLUMN primary_packaging  TEXT,
  ADD COLUMN secondary_packaging TEXT,
  ADD COLUMN storage_conditions TEXT,
  ADD COLUMN shelf_life_months  INTEGER,
  ADD COLUMN retest_months      INTEGER;
