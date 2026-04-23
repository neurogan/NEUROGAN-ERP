import { db } from "../../../db";
import * as schema from "@shared/schema";
import { seedIds } from "../../ids";

export async function seedRecipes() {
  await db.insert(schema.recipes).values([
    {
      id: seedIds.recipes.proUroV1,
      productId: seedIds.products.proUroFinished,
      name: "Pro+ Urolithin A 1000 mg — 30 ct (v1)",
      notes: "Standard encapsulation procedure. Batch size: 1000 units. See SOP-MFG-001.",
    },
  ]).onConflictDoNothing();

  await db.insert(schema.recipeLines).values([
    {
      id: seedIds.recipeLines.proUroUa,
      recipeId: seedIds.recipes.proUroV1,
      productId: seedIds.products.urolithinRaw,
      quantity: "1000",
      uom: "g",
      notes: "1g Urolithin A per 30-ct bottle × 1000 bottles",
    },
    {
      id: seedIds.recipeLines.proUroGelcaps,
      recipeId: seedIds.recipes.proUroV1,
      productId: seedIds.products.gelcaps,
      quantity: "30000",
      uom: "pcs",
      notes: "30 capsules × 1000 bottles",
    },
  ]).onConflictDoNothing();
}
