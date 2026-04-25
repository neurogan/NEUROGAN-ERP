/**
 * Dry-run: attempts to apply the migration 0013 SQL inside a transaction
 * that is ALWAYS rolled back. Reports which guard fired (or would fire)
 * for the current DB state. Does not modify any data.
 */
import { db } from "../db.ts";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = readFileSync(
  resolve(__dirname, "../../migrations/0013_cleanup_placeholder_users.sql"),
  "utf-8",
);

console.log("\nDry-running migration 0013 against current DB...\n");

try {
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(MIGRATION_SQL));
    throw new Error("__rollback_after_success__");
  });
  console.log("⚠️  unreachable");
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("production-use guard")) {
    console.log("✅ PROTECTED: GUARD 1 (production-use) fired.");
    console.log("   This DB is recognised as production-state.");
    console.log("   No users were touched. Migration would be aborted.\n");
    console.log("   Full error message from PostgreSQL:");
    console.log("   " + msg.split("\n")[0]);
    process.exit(0);
  }
  if (msg.includes("admin-survival guard")) {
    console.log("⚠️  GUARD 2 (admin-survival) fired.");
    console.log("   No admin would remain after migration — migration aborted.\n");
    console.log("   " + msg.split("\n")[0]);
    process.exit(0);
  }
  if (msg.includes("__rollback_after_success__")) {
    console.log("ℹ️  Migration would RUN successfully on this DB.");
    console.log("   (No production-state placeholders detected.)");
    console.log("   Transaction rolled back; no changes applied.");
    process.exit(0);
  }
  console.log("❌ Unexpected error: " + msg);
  process.exit(1);
}
