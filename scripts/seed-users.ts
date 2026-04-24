// Bootstrap tool: seed the core user accounts on a FRESH database.
// Only runs if the users table is completely empty — will NOT modify or
// overwrite any existing accounts. Safe to run at any time.
//
// Usage (one-time, when setting up a new environment):
//   railway run --service NEUROGAN-ERP --environment staging -- pnpm seed:users
//
// This script is intentionally NOT in the Railway release command.
// Deploys ONLY run migrations. User data is never touched by deployment.

import { db } from "../server/db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import { seedIds } from "../server/seed/ids";
import { seedUsers } from "../server/seed/test/fixtures/users";

async function main() {
  // Guard: check by stable seed ID, not total count. Test-fixture users left
  // over from integration tests should not prevent real user bootstrapping.
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, seedIds.users.admin));

  if (existing) {
    console.log(
      "Skipping seed — admin seed user already exists. " +
      "This environment is already bootstrapped. " +
      "To reset a specific user's password, use: tsx scripts/reset-password.ts <email> <password>"
    );
    process.exit(0);
  }

  console.log("Fresh database detected — seeding users…");
  await seedUsers();
  console.log(
    "Done. Log in with the Change_Me_Now! passwords and rotate immediately."
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
