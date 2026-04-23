#!/usr/bin/env tsx
// F-08: Restore-check — validates that a Postgres backup is readable and
// contains the core regulated tables required by 21 CFR §111.605 and
// Part 11 §11.10(c).
//
// Usage:
//   RESTORE_CHECK_DATABASE_URL=postgres://... tsx scripts/restore-check.ts
//
// The script exits 0 on success and non-zero on any failure so it can be
// used as a CI gate. Results are printed to stdout in a format that a QA
// reviewer can sign off in the validation scaffold.
//
// Railway backup workflow (manual step, run monthly):
//   1. In Railway dashboard → Postgres service → Backups → Restore to new service.
//   2. Copy the new service's DATABASE_URL.
//   3. Run:  RESTORE_CHECK_DATABASE_URL=<url> pnpm restore:check
//   4. Archive the output in FDA/validation/restore-check-YYYY-MM.txt.
//   5. QA signs the archived file (electronic signature via the ERP UI or wet
//      signature on printed copy per SOP).

import { Pool } from "pg";

const RESTORE_DB_URL =
  process.env.RESTORE_CHECK_DATABASE_URL ?? process.env.DATABASE_URL;

if (!RESTORE_DB_URL) {
  console.error(
    "ERROR: Set RESTORE_CHECK_DATABASE_URL (or DATABASE_URL) to the restored database URL.",
  );
  process.exit(1);
}

interface CheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function pass(check: string, detail: string) {
  results.push({ check, passed: true, detail });
  console.log(`  ✓  ${check} — ${detail}`);
}

function fail(check: string, detail: string) {
  results.push({ check, passed: false, detail });
  console.error(`  ✗  ${check} — ${detail}`);
}

async function run() {
  console.log("=".repeat(60));
  console.log("NEUROGAN ERP — Restore Check");
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log(`Target: ${RESTORE_DB_URL!.replace(/:[^:@]+@/, ":***@")}`);
  console.log("=".repeat(60));

  const ssl =
    RESTORE_DB_URL!.includes("sslmode=require") ||
    RESTORE_DB_URL!.includes("railway.app")
      ? { rejectUnauthorized: false }
      : false;

  const pool = new Pool({ connectionString: RESTORE_DB_URL, ssl, connectionTimeoutMillis: 15_000 });

  try {
    // ── 1. Connectivity ─────────────────────────────────────────────────────
    console.log("\n[1/5] Connectivity");
    try {
      const { rows } = await pool.query<{ now: Date }>("SELECT NOW() AS now");
      pass("connect", `DB time: ${rows[0]?.now.toISOString()}`);
    } catch (e) {
      fail("connect", String(e));
      process.exit(1);
    }

    // ── 2. Core tables exist ─────────────────────────────────────────────────
    console.log("\n[2/5] Core table presence");
    const requiredTables = [
      "erp_lots",
      "erp_products",
      "erp_transactions",
      "erp_production_batches",
      "erp_audit_trail",
      "erp_users",
      "erp_batch_production_records",
      "erp_receiving_records",
    ];
    for (const table of requiredTables) {
      try {
        await pool.query(`SELECT 1 FROM ${table} LIMIT 1`);
        pass(`table:${table}`, "present");
      } catch (e) {
        fail(`table:${table}`, String(e));
      }
    }

    // ── 3. Row counts (non-zero confirms data survived the restore) ──────────
    console.log("\n[3/5] Data presence (non-zero row counts expected)");
    const dataTables = [
      { table: "erp_audit_trail", label: "audit rows" },
      { table: "erp_users",       label: "users" },
    ];
    for (const { table, label } of dataTables) {
      try {
        const { rows } = await pool.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM ${table}`,
        );
        const n = parseInt(rows[0]?.count ?? "0", 10);
        if (n > 0) {
          pass(`rows:${table}`, `${n} ${label}`);
        } else {
          fail(`rows:${table}`, `0 ${label} — table is empty, backup may be incomplete`);
        }
      } catch (e) {
        fail(`rows:${table}`, String(e));
      }
    }

    // ── 4. Audit trail immutability constraint ───────────────────────────────
    console.log("\n[4/5] Audit trail write-protection");
    try {
      await pool.query(`
        UPDATE erp_audit_trail
        SET action = action
        WHERE FALSE
      `);
      // If we get here the role has UPDATE — that's a finding.
      fail(
        "audit:immutable",
        "erp_app role can UPDATE audit_trail — immutability constraint missing on this DB",
      );
    } catch (e: unknown) {
      const msg = String(e);
      if (msg.includes("permission denied") || msg.includes("42501")) {
        pass("audit:immutable", "UPDATE on erp_audit_trail denied (correct)");
      } else {
        // Some other error (e.g. table doesn't exist) — already caught above.
        fail("audit:immutable", msg);
      }
    }

    // ── 5. Lot / batch readable ──────────────────────────────────────────────
    console.log("\n[5/5] Regulated record readability");
    for (const table of ["erp_lots", "erp_production_batches", "erp_batch_production_records"]) {
      try {
        const { rows } = await pool.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM ${table}`,
        );
        pass(`readable:${table}`, `${rows[0]?.count ?? 0} rows`);
      } catch (e) {
        fail(`readable:${table}`, String(e));
      }
    }
  } finally {
    await pool.end();
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log("\n" + "=".repeat(60));
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(60));

  if (failed > 0) {
    console.error("\nRestore check FAILED. Do not sign off. Escalate to DBA.");
    process.exit(1);
  }

  console.log("\nRestore check PASSED. Archive this output and obtain QA signature.");
  process.exit(0);
}

run().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
