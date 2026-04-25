/**
 * Static checker for migration files. Fails CI if any migration contains a
 * dangerous SQL pattern that risks deleting real users without an explicit
 * safety guard. See incident report 2026-04-24 (migration 0013 wiped staging
 * admin) and feedback_migration_user_safety memory rule.
 *
 * Rules enforced:
 *   1. DELETE FROM erp_users / erp_user_roles must use a WHERE clause that
 *      lists explicit UUIDs — never email LIKE, name LIKE, or any pattern.
 *   2. Any migration that touches erp_users or erp_user_roles in a DELETE
 *      must contain a `RAISE EXCEPTION` safety guard.
 *
 * Run: pnpm check:migrations
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS_DIR = resolve(process.cwd(), "migrations");
const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const violations: string[] = [];

const USER_TABLES = ["erp_users", "erp_user_roles"];
const PATTERN_LIKE = /\bLIKE\s+'[^']*%[^']*'/i;

for (const file of files) {
  const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf-8");
  const lower = sql.toLowerCase();

  const touchesUsers = USER_TABLES.some((t) =>
    new RegExp(`delete\\s+from\\s+${t}\\b`, "i").test(sql),
  );

  if (!touchesUsers) continue;

  // Rule 1: must not contain LIKE pattern in any DELETE involving user tables
  // Look for any DELETE statement that contains a LIKE pattern on the same line
  // or within a few lines (multi-line WHERE clauses).
  const deleteBlocks = sql.match(/delete\s+from\s+\w+[\s\S]*?(?=delete\s+from|;|$)/gi) ?? [];
  for (const block of deleteBlocks) {
    if (
      USER_TABLES.some((t) => new RegExp(`delete\\s+from\\s+${t}\\b`, "i").test(block))
      && PATTERN_LIKE.test(block)
    ) {
      violations.push(
        `${file}: DELETE on user-adjacent table uses a LIKE pattern. ` +
          `Pattern matches are too broad — delete by explicit UUID array only.`,
      );
    }
    // Also block DELETE FROM erp_users WHERE email = ... unless guarded
    if (
      /delete\s+from\s+erp_users\s+where\s+email\s*=/i.test(block)
    ) {
      violations.push(
        `${file}: DELETE FROM erp_users by email. Use UUID-based deletion instead.`,
      );
    }
  }

  // Rule 2: must contain a RAISE EXCEPTION safety guard
  if (!/raise\s+exception/i.test(lower)) {
    violations.push(
      `${file}: deletes from a user-adjacent table without a RAISE EXCEPTION ` +
        `safety guard. Add a DO $$ ... IF ... THEN RAISE EXCEPTION ... END IF block.`,
    );
  }
}

if (violations.length > 0) {
  console.error("\n❌ Migration safety check FAILED:\n");
  for (const v of violations) console.error(`  • ${v}`);
  console.error(
    "\nSee feedback_migration_user_safety memory and AGENTS.md §5.2 for the rules.",
  );
  process.exit(1);
}

console.log(`✅ Migration safety check passed (${files.length} files scanned).`);
process.exit(0);
