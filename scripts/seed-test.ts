#!/usr/bin/env tsx
// F-09: CLI entry point for `pnpm seed:test`.
//
// Runs the full seed against DATABASE_URL. Idempotent — safe to run multiple
// times. Intended for:
//   - Local dev setup after a fresh migration
//   - CI integration-test setup (already handled by beforeAll, but this
//     script lets you pre-populate a staging DB for manual OQ walkthroughs)
//
// Never run against production.

import { seed } from "../server/seed/test/index";
import { getPool } from "../server/db";

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is required.");
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  console.error("ERROR: seed:test must not run against production.");
  process.exit(1);
}

console.log("Seeding test fixtures...");
console.log(`Target: ${process.env.DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);

seed()
  .then(() => {
    console.log("Done. All fixtures inserted (idempotent — duplicates skipped).");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => getPool().end());
