/**
 * Integration tests for migration 0013's safety guards. Each test wraps the
 * migration SQL in a transaction that is rolled back, so no schema changes
 * persist. Tests run against the same disposable Postgres CI uses.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { hashPassword } from "../auth/password";

const MIGRATION_SQL = readFileSync(
  resolve(__dirname, "../../migrations/0013_cleanup_placeholder_users.sql"),
  "utf-8",
);

const dbUrl = process.env.DATABASE_URL;
const describeIfDb = dbUrl ? describe : describe.skip;

const PLACEHOLDER_001 = "00000000-0000-0001-0000-000000000001";

async function runMigrationInTx(setup: (tx: typeof db) => Promise<void>): Promise<string> {
  let raised = "";
  try {
    await db.transaction(async (tx) => {
      await setup(tx as unknown as typeof db);
      await tx.execute(sql.raw(MIGRATION_SQL));
      throw new Error("__test_rollback_after_success__");
    });
  } catch (e: unknown) {
    raised = e instanceof Error ? e.message : String(e);
  }
  return raised;
}

describeIfDb("migration 0013 — safety guards", () => {
  it("GUARD 1: aborts when a placeholder UUID has audit_trail entries", async () => {
    const adminPwHash = await hashPassword("Neurogan1!Secure");
    const raised = await runMigrationInTx(async (tx) => {
      // Seed a real admin so GUARD 2 can't fire first
      const email = `guard-test-admin-${Date.now()}@test.local`;
      const adminRows = await tx.execute(sql`
        INSERT INTO erp_users (email, full_name, password_hash, status, created_by_user_id)
        VALUES (${email}, 'Guard Admin', ${adminPwHash}, 'ACTIVE', NULL)
        RETURNING id
      `);
      const adminId = (adminRows.rows[0] as { id: string }).id;
      await tx.execute(sql`
        INSERT INTO erp_user_roles (user_id, role, granted_by_user_id)
        VALUES (${adminId}::uuid, 'ADMIN', ${adminId}::uuid)
      `);
      // Placeholder + audit entry
      await tx.execute(sql`
        INSERT INTO erp_users (id, email, full_name, password_hash, status)
        VALUES (${PLACEHOLDER_001}::uuid, ${`placeholder-${Date.now()}@test.local`},
                'Placeholder', 'x', 'DISABLED')
        ON CONFLICT (id) DO NOTHING
      `);
      await tx.execute(sql`
        INSERT INTO erp_audit_trail (user_id, action, entity_type, entity_id, occurred_at)
        VALUES (${PLACEHOLDER_001}::uuid, 'TEST_ACTION', 'TEST', 'test-id', NOW())
      `);
    });
    expect(raised).toContain("production-use guard");
  });

  it("GUARD 1: aborts when a placeholder UUID is older than 24 hours", async () => {
    const adminPwHash = await hashPassword("Neurogan1!Secure");
    const raised = await runMigrationInTx(async (tx) => {
      const email = `guard-test-age-${Date.now()}@test.local`;
      const adminRows = await tx.execute(sql`
        INSERT INTO erp_users (email, full_name, password_hash, status, created_by_user_id)
        VALUES (${email}, 'Guard Admin Age', ${adminPwHash}, 'ACTIVE', NULL)
        RETURNING id
      `);
      const adminId = (adminRows.rows[0] as { id: string }).id;
      await tx.execute(sql`
        INSERT INTO erp_user_roles (user_id, role, granted_by_user_id)
        VALUES (${adminId}::uuid, 'ADMIN', ${adminId}::uuid)
      `);
      // Placeholder created 48h ago — older than 24h threshold
      await tx.execute(sql`
        INSERT INTO erp_users (id, email, full_name, password_hash, status, created_at)
        VALUES (${PLACEHOLDER_001}::uuid, ${`aged-${Date.now()}@test.local`},
                'Aged Placeholder', 'x', 'DISABLED', NOW() - INTERVAL '48 hours')
        ON CONFLICT (id) DO NOTHING
      `);
    });
    expect(raised).toContain("production-use guard");
  });

  it("GUARD 2: aborts when no admin would remain after placeholder removal", async () => {
    const raised = await runMigrationInTx(async (tx) => {
      // Wipe any pre-existing admin grants in this transaction
      await tx.execute(sql`DELETE FROM erp_user_roles WHERE role = 'ADMIN'`);
    });
    expect(raised).toContain("admin-survival guard");
  });

  it("succeeds on a fresh DB with admin and no production-state placeholders", async () => {
    const adminPwHash = await hashPassword("Neurogan1!Secure");
    const raised = await runMigrationInTx(async (tx) => {
      const email = `guard-test-fresh-${Date.now()}@test.local`;
      const adminRows = await tx.execute(sql`
        INSERT INTO erp_users (email, full_name, password_hash, status, created_by_user_id)
        VALUES (${email}, 'Guard Admin Fresh', ${adminPwHash}, 'ACTIVE', NULL)
        RETURNING id
      `);
      const adminId = (adminRows.rows[0] as { id: string }).id;
      await tx.execute(sql`
        INSERT INTO erp_user_roles (user_id, role, granted_by_user_id)
        VALUES (${adminId}::uuid, 'ADMIN', ${adminId}::uuid)
      `);
      // No placeholder UUIDs present.
    });
    // Migration ran successfully → only the test rollback marker thrown
    expect(raised).toContain("__test_rollback_after_success__");
  });
});
