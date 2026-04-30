/**
 * Mark migration 0013_cleanup_placeholder_users as "applied" on production
 * so drizzle-kit migrate skips it on the next deploy.
 *
 * Reason: production placeholder UUIDs are real DISABLED user accounts (not
 * fresh-seed bootstrap fixtures). Migration 0013's GUARD 1 correctly aborts on
 * production state, but that abort fails the entire releaseCommand pipeline
 * and blocks legitimate feature deploys. Manually marking 0013 as applied is
 * the documented escape hatch (see comment at top of 0013_cleanup_placeholder_users.sql).
 *
 * Idempotent. Safe to re-run. Only inserts if no row with created_at=1745500500000 exists.
 *
 * Run: DATABASE_URL=<prod-url> npx tsx server/scripts/mark-0013-skipped-on-prod.ts
 */
import { Pool } from "pg";

const FOLDER_MILLIS = 1745500500000; // matches "when" for 0013 in migrations/meta/_journal.json
const SKIP_HASH = "manually-skipped-0013-prod-2026-04-25";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT hash, created_at FROM drizzle.__drizzle_migrations WHERE created_at = $1`,
      [FOLDER_MILLIS],
    );

    if (existing.rowCount && existing.rowCount > 0) {
      console.log("0013 ALREADY MARKED on production:");
      existing.rows.forEach((r: { hash: string; created_at: number | string }) =>
        console.log(`  hash=${r.hash} created_at=${r.created_at}`),
      );
      await client.query("ROLLBACK");
      console.log("\nNo change needed. Migration 0013 will be skipped on next deploy.");
      return;
    }

    await client.query(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      [SKIP_HASH, FOLDER_MILLIS],
    );

    const verify = await client.query(
      `SELECT hash, created_at FROM drizzle.__drizzle_migrations WHERE created_at = $1`,
      [FOLDER_MILLIS],
    );
    if (verify.rowCount !== 1) {
      throw new Error(`Verify failed: expected 1 row, got ${verify.rowCount}`);
    }

    await client.query("COMMIT");
    console.log("0013 marked as skipped on production:");
    verify.rows.forEach((r: { hash: string; created_at: number | string }) =>
      console.log(`  hash=${r.hash} created_at=${r.created_at}`),
    );
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
