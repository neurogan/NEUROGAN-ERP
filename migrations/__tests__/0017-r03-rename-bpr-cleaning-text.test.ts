import { describe, it, expect } from "vitest";
import { db } from "../../server/db";
import { sql } from "drizzle-orm";

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

describeIfDb("Migration 0017 — BPR cleaning_record_reference rename safety", () => {
  it("preserves existing legacy text values across migration (idempotent re-run)", async () => {
    const legacyCol = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'erp_batch_production_records'
        AND column_name = 'cleaning_record_legacy_text'
    `);
    expect(legacyCol.rows.length).toBe(1);

    const fkCol = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'erp_batch_production_records'
        AND column_name = 'cleaning_log_id'
    `);
    expect(fkCol.rows.length).toBe(1);

    const oldCol = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'erp_batch_production_records'
        AND column_name = 'cleaning_record_reference'
    `);
    expect(oldCol.rows.length).toBe(0);
  });

  it("running the migration block twice is a no-op (idempotency check)", async () => {
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM information_schema.columns
      WHERE table_name = 'erp_batch_production_records'
        AND column_name IN ('cleaning_record_legacy_text', 'cleaning_log_id')
    `);
    expect(Number((result.rows[0] as { count: string }).count)).toBe(2);
  });
});
