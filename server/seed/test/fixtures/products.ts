import { db } from "../../../db";
import * as schema from "@shared/schema";
import { seedIds } from "../../ids";

export async function seedProducts() {
  await db.insert(schema.productCategories).values([
    { id: seedIds.productCategories.rawMaterial,   name: "Raw Material" },
    { id: seedIds.productCategories.packaging,     name: "Packaging" },
    { id: seedIds.productCategories.finishedGoods, name: "Finished Goods" },
  ]).onConflictDoNothing();

  await db.insert(schema.products).values([
    {
      id: seedIds.products.urolithinRaw,
      sku: "RM-UA-001",
      name: "Urolithin A — Raw",
      category: "ACTIVE_INGREDIENT",
      defaultUom: "g",
      status: "ACTIVE",
    },
    {
      id: seedIds.products.nmnRaw,
      sku: "RM-NMN-001",
      name: "NMN — Raw",
      category: "ACTIVE_INGREDIENT",
      defaultUom: "g",
      status: "ACTIVE",
    },
    {
      id: seedIds.products.gelcaps,
      sku: "PKG-GC-001",
      name: "Gelatin capsules size 00",
      category: "PRIMARY_PACKAGING",
      defaultUom: "pcs",
      status: "ACTIVE",
    },
    {
      id: seedIds.products.proUroFinished,
      sku: "FG-UA-1000",
      name: "Pro+ Urolithin A 1000 mg — 30 ct",
      category: "FINISHED_GOOD",
      defaultUom: "pcs",
      status: "ACTIVE",
    },
    {
      id: seedIds.products.nmnFinished,
      sku: "FG-NMN-900",
      name: "NMN 900 mg — 60 ct",
      category: "FINISHED_GOOD",
      defaultUom: "pcs",
      status: "ACTIVE",
    },
  ]).onConflictDoNothing();

  // Category assignments
  await db.insert(schema.productCategoryAssignments).values([
    { productId: seedIds.products.urolithinRaw,   categoryId: seedIds.productCategories.rawMaterial },
    { productId: seedIds.products.nmnRaw,         categoryId: seedIds.productCategories.rawMaterial },
    { productId: seedIds.products.gelcaps,        categoryId: seedIds.productCategories.packaging },
    { productId: seedIds.products.proUroFinished, categoryId: seedIds.productCategories.finishedGoods },
    { productId: seedIds.products.nmnFinished,    categoryId: seedIds.productCategories.finishedGoods },
  ]).onConflictDoNothing();
}
