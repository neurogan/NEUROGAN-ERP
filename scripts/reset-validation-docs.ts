// One-off ops script: force-update validation document content and reset VSR to DRAFT.
//
// Use when: seed content is stale (ON CONFLICT DO NOTHING skips updates), or a test
// signing needs to be cleared on staging before the real QA sign-off.
//
// Usage: DATABASE_URL=... tsx scripts/reset-validation-docs.ts
// Via Railway: DATABASE_URL=<public-url> pnpm reset:validation-docs
//
// Safe on staging only — do not run against a production VSR that has been
// formally signed and accepted.

import { db } from "../server/db";
import * as schema from "@shared/schema";
import { seedIds } from "../server/seed/ids";
import { eq } from "drizzle-orm";
import { seedValidationDocuments } from "../server/seed/test/fixtures/validationDocuments";

async function main() {
  // 1. Reset VSR to DRAFT (clears any test-run signature)
  const updated = await db
    .update(schema.validationDocuments)
    .set({ status: "DRAFT", signatureId: null })
    .where(eq(schema.validationDocuments.id, seedIds.validationDocuments.vsrPlatform))
    .returning({ id: schema.validationDocuments.id, status: schema.validationDocuments.status });

  if (updated.length === 0) {
    console.log("VSR row not found — seeding fresh documents instead.");
  } else {
    console.log(`VSR reset to DRAFT (id: ${updated[0].id})`);
  }

  // 2. Force-update content on all four documents to the current fixture text.
  //    Delete first so seedValidationDocuments() INSERT replaces them cleanly.
  await db.delete(schema.validationDocuments).where(
    eq(schema.validationDocuments.id, seedIds.validationDocuments.iqPlatform)
  );
  await db.delete(schema.validationDocuments).where(
    eq(schema.validationDocuments.id, seedIds.validationDocuments.oqPlatform)
  );
  await db.delete(schema.validationDocuments).where(
    eq(schema.validationDocuments.id, seedIds.validationDocuments.pqPlatform)
  );
  await db.delete(schema.validationDocuments).where(
    eq(schema.validationDocuments.id, seedIds.validationDocuments.vsrPlatform)
  );

  await seedValidationDocuments();
  console.log("All four validation documents refreshed with current fixture content.");
  console.log("VSR is now DRAFT — Steven Burgueno can sign it in the Quality tab.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
