import { db } from "../../../db";
import * as schema from "@shared/schema";
import { seedIds } from "../../ids";

export async function seedSuppliers() {
  await db.insert(schema.suppliers).values([
    { id: seedIds.suppliers.primaryUA,    name: "Primary Urolithin A Supplier", notes: "Country: IN" },
    { id: seedIds.suppliers.primaryNMN,   name: "Primary NMN Supplier",         notes: "Country: CN" },
    { id: seedIds.suppliers.pending,      name: "Pending Qualification Supplier", notes: "Country: US" },
    { id: seedIds.suppliers.disqualified, name: "Disqualified Supplier",         notes: "Country: US" },
  ]).onConflictDoNothing();

  await db.insert(schema.supplierQualifications).values([
    {
      id: seedIds.supplierQualifications.primaryUA,
      supplierId: seedIds.suppliers.primaryUA,
      status: "QUALIFIED",
      qualificationDate: "2025-01-15",
      qualificationMethod: "Audit + COA review",
      qualifiedBy: "Head of QC",
      approvedBy: "Head of QC",
      requalificationFrequency: "12 months",
      nextRequalificationDue: "2026-01-15",
    },
    {
      id: seedIds.supplierQualifications.primaryNMN,
      supplierId: seedIds.suppliers.primaryNMN,
      status: "QUALIFIED",
      qualificationDate: "2025-03-01",
      qualificationMethod: "Audit + COA review",
      qualifiedBy: "Head of QC",
      approvedBy: "Head of QC",
      requalificationFrequency: "12 months",
      nextRequalificationDue: "2026-03-01",
    },
    {
      id: seedIds.supplierQualifications.pending,
      supplierId: seedIds.suppliers.pending,
      status: "PENDING",
      notes: "Qualification audit scheduled Q3 2026",
    },
    {
      id: seedIds.supplierQualifications.disqualified,
      supplierId: seedIds.suppliers.disqualified,
      status: "DISQUALIFIED",
      notes: "Failed requalification audit 2025-11-10 — identity confirm method not scientifically valid",
    },
  ]).onConflictDoNothing();
}
