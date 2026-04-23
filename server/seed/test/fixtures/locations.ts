import { db } from "../../../db";
import * as schema from "@shared/schema";
import { seedIds } from "../../ids";

export async function seedLocations() {
  await db.insert(schema.locations).values([
    { id: seedIds.locations.quarantine, name: "Quarantine Cage 1",  description: "Default landing zone for new lots and returns" },
    { id: seedIds.locations.bulk,       name: "Raw Bulk A",         description: "Raw material storage after QC release" },
    { id: seedIds.locations.fg,         name: "FG Staging",         description: "Finished goods post-release" },
    { id: seedIds.locations.retain,     name: "Retain Samples",     description: "QC retained-sample shelf" },
    { id: seedIds.locations.destroy,    name: "Destroy Bin",        description: "REJECTED lots pending disposal" },
  ]).onConflictDoNothing();
}
