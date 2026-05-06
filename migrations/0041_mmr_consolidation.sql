-- Add erp_mmr_components — BOM/formula now lives in the MMR, not a separate recipe
CREATE TABLE "erp_mmr_components" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mmr_id" uuid NOT NULL REFERENCES "erp_mmrs"("id") ON DELETE CASCADE,
  "product_id" varchar NOT NULL REFERENCES "erp_products"("id"),
  "quantity" numeric NOT NULL,
  "uom" text NOT NULL,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

-- Remove recipe dependency from MMRs
ALTER TABLE "erp_mmrs" DROP COLUMN IF EXISTS "recipe_id";

-- Remove recipe audit trail from BPRs (mmrId/mmrVersion already cover traceability)
ALTER TABLE "erp_batch_production_records" DROP COLUMN IF EXISTS "recipe_id";

-- Drop recipe tables (BOM data is now managed in erp_mmr_components)
DROP TABLE IF EXISTS "erp_recipe_lines";
DROP TABLE IF EXISTS "erp_recipes";
