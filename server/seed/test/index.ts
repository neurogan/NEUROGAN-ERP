// F-09: Test seed orchestrator — loads deterministic fixtures in FK order.
//
// `seedOnce()` is idempotent: every INSERT uses ON CONFLICT DO NOTHING
// with stable UUIDs from server/seed/ids.ts. Running it twice yields the
// same state. It does NOT write to erp_audit_trail or erp_electronic_signatures
// — seed rows are infrastructure, not regulated actions.
//
// Usage in integration tests:
//
//   import { seedOnce } from "../../seed/test";
//   beforeAll(() => seedOnce());
//
// After seeding, wrap each test in withRollback() from helpers/tx.ts so
// mutations don't bleed between tests.

import { seedUsers }     from "./fixtures/users";
import { seedLocations } from "./fixtures/locations";
import { seedSuppliers } from "./fixtures/suppliers";
import { seedProducts }  from "./fixtures/products";
import { seedLots }      from "./fixtures/lots";
import { seedRecipes }   from "./fixtures/recipes";
import { seedValidationDocuments } from "./fixtures/validationDocuments";

let seeded = false;

export async function seedOnce(): Promise<void> {
  if (seeded) return;
  await seed();
  seeded = true;
}

// Exported for the CLI script (pnpm seed:test) which always runs in full.
export async function seed(): Promise<void> {
  await seedUsers();
  await seedLocations();
  await seedSuppliers();
  await seedProducts();
  await seedLots();      // depends on products, suppliers, locations
  await seedRecipes();   // depends on products
  await seedValidationDocuments();
}
