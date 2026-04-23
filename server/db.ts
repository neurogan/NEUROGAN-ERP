import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: Pool | null = null;

export function getDb() {
  if (!_db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    _pool = new Pool({
      connectionString,
      ssl: connectionString.includes("sslmode=require") || connectionString.includes("railway.app")
        ? { rejectUnauthorized: false }
        : false,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 10,
    });
    _db = drizzle(_pool, { schema });
  }
  return _db;
}

// For backwards compatibility, also export as db (lazy getter)
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    return Reflect.get(getDb(), prop);
  },
});

// Expose the underlying pg.Pool so the session store can share the same
// connection (including SSL config) rather than creating its own.
export function getPool(): Pool {
  getDb(); // ensure pool is initialised
  if (!_pool) throw new Error("Pool not initialised");
  return _pool;
}

// Drizzle transaction type — the object passed to db.transaction() callbacks.
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// F-03 boot check: verify that the erp_app role cannot UPDATE erp_audit_trail.
// If it can, the append-only guarantee is broken and the server should refuse
// to start. Logs a warning rather than crashing when erp_app doesn't exist
// (common in fresh dev environments before the migration runs).
export async function checkAuditTrailImmutability(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ can_update: boolean }>(
      `SELECT has_table_privilege('erp_app', 'erp_audit_trail', 'UPDATE') AS can_update`,
    );
    if (rows[0]?.can_update) {
      throw new Error(
        "BOOT CHECK FAILED: erp_app role has UPDATE privilege on erp_audit_trail. " +
        "Revoke it immediately — append-only audit trail is a Part 11 requirement (D-07).",
      );
    }
    console.log("[boot] audit trail append-only check passed");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("does not exist")) {
      // erp_app role hasn't been created yet (migration not run). Warn and continue.
      console.warn("[boot] erp_app role not found — run pnpm migrate:up to create it");
    } else {
      throw err;
    }
  } finally {
    client.release();
  }
}
