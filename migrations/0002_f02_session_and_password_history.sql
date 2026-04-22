-- F-02: Authentication, sessions, password policy
-- Creates:
--   session           — Postgres-backed session store (connect-pg-simple)
--   erp_password_history — last-N password hashes for reuse checking (D-02)
--
-- The session table is owned by connect-pg-simple; its schema is defined
-- by the library. We create it here rather than at boot (D-09: no self-
-- mutating schemas at runtime).
--
-- Rollback:
--   DROP TABLE IF EXISTS "session";
--   DROP TABLE IF EXISTS erp_password_history;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    varchar       NOT NULL COLLATE "default",
  "sess"   json          NOT NULL,
  "expire" timestamp(6)  NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
) WITH (OIDS=FALSE);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "erp_password_history" (
  "id"            uuid          NOT NULL DEFAULT gen_random_uuid(),
  "user_id"       uuid          NOT NULL REFERENCES "erp_users"("id") ON DELETE CASCADE,
  "password_hash" text          NOT NULL,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "erp_password_history_pkey" PRIMARY KEY ("id")
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pwd_history_user_created"
  ON "erp_password_history" ("user_id", "created_at" DESC);
