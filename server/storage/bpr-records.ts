import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";

export async function getCleaningLogIdForBpr(bprId: string): Promise<string | null | undefined> {
  const [row] = await db
    .select({ cleaningLogId: schema.batchProductionRecords.cleaningLogId })
    .from(schema.batchProductionRecords)
    .where(eq(schema.batchProductionRecords.id, bprId))
    .limit(1);
  return row?.cleaningLogId;
}
