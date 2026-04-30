/**
 * Dry-run every pending migration against the connected DB inside a single
 * outer transaction that ALWAYS rolls back. Reports per-migration pass/fail.
 *
 * Reads `migrations/meta/_journal.json` for migration order, then SELECTs the
 * applied set from `drizzle.__drizzle_migrations` (matching by `created_at`).
 *
 * Run: DATABASE_URL=<prod-url> npx tsx server/scripts/dryrun-prod-pending.ts
 */
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}
interface Journal {
  entries: JournalEntry[];
}

const journal: Journal = JSON.parse(
  readFileSync(resolve(process.cwd(), "migrations/meta/_journal.json"), "utf-8"),
);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const applied = await pool.query(`SELECT created_at FROM drizzle.__drizzle_migrations`);
  const appliedSet = new Set(applied.rows.map((r: { created_at: number | string }) => Number(r.created_at)));

  const pending = journal.entries.filter((e) => !appliedSet.has(e.when));
  console.log(`Applied: ${appliedSet.size}, Pending: ${pending.length}\n`);
  if (!pending.length) {
    console.log("Nothing to dry-run. DB is up to date.");
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let allOk = true;
    for (const entry of pending) {
      const sql = readFileSync(
        resolve(process.cwd(), "migrations", `${entry.tag}.sql`),
        "utf-8",
      );
      try {
        await client.query(`SAVEPOINT m_${entry.idx}`);
        // drizzle splits on `--> statement-breakpoint` and runs each separately.
        const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
        for (const stmt of statements) {
          await client.query(stmt);
        }
        console.log(`  ✅ ${entry.tag}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`  ❌ ${entry.tag}\n     ${msg.split("\n")[0]}`);
        allOk = false;
        // rollback to savepoint so subsequent migrations can still be tested
        await client.query(`ROLLBACK TO SAVEPOINT m_${entry.idx}`);
      }
    }
    await client.query("ROLLBACK"); // outer transaction — never persist
    console.log(allOk ? "\n✅ All pending migrations would apply cleanly." : "\n❌ One or more pending migrations would fail.");
    process.exit(allOk ? 0 : 1);
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
