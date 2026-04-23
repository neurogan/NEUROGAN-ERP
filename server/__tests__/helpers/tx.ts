// F-09: Transaction-per-test wrapper for integration tests.
//
// Usage:
//
//   import { withRollback } from "./helpers/tx";
//
//   it("does something", () =>
//     withRollback(async (tx) => {
//       // use tx instead of db for all mutations; they roll back at test end
//       await tx.insert(schema.lots).values({ ... });
//       const result = await tx.select().from(schema.lots);
//       expect(result).toHaveLength(1);
//     })
//   );
//
// The outer `seed` data is NOT rolled back — seedOnce() commits permanently
// so that data is available across the full test run. Only within-test
// mutations are rolled back.

import { db } from "../../db";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class RollbackSentinel extends Error {
  constructor() { super("rollback"); }
}

export function withRollback<T>(
  fn: (tx: DrizzleTx) => Promise<T>,
): Promise<T | undefined> {
  return db
    .transaction(async (tx) => {
      await fn(tx);
      throw new RollbackSentinel();
    })
    .catch((err) => {
      if (err instanceof RollbackSentinel) return undefined;
      throw err;
    });
}

// Re-export db type for tests that need it without importing db directly.
export type { DrizzleTx };
export type { NodePgDatabase };
