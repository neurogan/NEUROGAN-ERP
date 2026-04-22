import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";

// Integration smoke test: proves CI's disposable Postgres + supertest harness
// can talk to the DB. Expands in F-01 once the first regulated endpoint ships.
//
// Skips cleanly when DATABASE_URL is unset so `pnpm test:integration` can be
// invoked without a local DB during dev (CI always has it set via services).
const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

describeIfDb("integration: postgres smoke", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({
      connectionString: dbUrl,
      ssl: dbUrl!.includes("sslmode=require") || dbUrl!.includes("railway.app")
        ? { rejectUnauthorized: false }
        : false,
      connectionTimeoutMillis: 10_000,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("can SELECT 1", async () => {
    const { rows } = await pool.query<{ one: number }>("SELECT 1 AS one");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.one).toBe(1);
  });

  it("can read the current database name", async () => {
    const { rows } = await pool.query<{ current_database: string }>(
      "SELECT current_database()",
    );
    expect(rows[0]?.current_database).toMatch(/.+/);
  });
});
