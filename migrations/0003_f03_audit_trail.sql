-- F-03: Append-only audit trail
-- Part 11 §11.10(e) requires a tamper-resistant record of all regulated writes.
-- The erp_app role is granted INSERT-only on erp_audit_trail; UPDATE and DELETE
-- are revoked from PUBLIC. The application boot check (server/db.ts) verifies
-- this on every startup and refuses to serve traffic if the constraint is violated.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "erp_audit_trail" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "occurred_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "user_id"      uuid                     NOT NULL REFERENCES "erp_users"("id"),
  "action"       text                     NOT NULL,
  "entity_type"  text                     NOT NULL,
  "entity_id"    text,
  "before"       jsonb,
  "after"        jsonb,
  "route"        text,
  "request_id"   text,
  "meta"         jsonb,
  CONSTRAINT "erp_audit_trail_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "erp_audit_trail_no_future_date"
    CHECK (occurred_at <= now() + INTERVAL '1 minute')
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_entity"
  ON "erp_audit_trail" ("entity_type", "entity_id", "occurred_at" DESC);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_user"
  ON "erp_audit_trail" ("user_id", "occurred_at" DESC);

--> statement-breakpoint
-- Create the application role if it does not already exist.
-- In production the DATABASE_URL should point to this role, not postgres.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    CREATE ROLE erp_app LOGIN;
  END IF;
END
$$;

--> statement-breakpoint
-- Revoke broad write privileges from PUBLIC so no role inherits them by default.
REVOKE UPDATE, DELETE ON "erp_audit_trail" FROM PUBLIC;

--> statement-breakpoint
-- Grant only INSERT to erp_app (SELECT needed for cursor pagination queries).
GRANT SELECT, INSERT ON "erp_audit_trail" TO erp_app;
