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
