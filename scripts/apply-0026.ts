import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(`
  ALTER TABLE erp_users
    ADD COLUMN IF NOT EXISTS reset_token_hash TEXT,
    ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ
`);
await client.query(`
  INSERT INTO __drizzle_migrations (hash, created_at)
  VALUES ('48be822eb1447681cff4310a61d304781709e9a79b65db64d9d425399225e955', extract(epoch from now()) * 1000)
  ON CONFLICT DO NOTHING
`);
console.log("Migration 0026 applied.");
await client.end();
