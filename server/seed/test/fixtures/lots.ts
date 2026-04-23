import { db } from "../../../db";
import * as schema from "@shared/schema";
import { seedIds } from "../../ids";

const TODAY = "2026-04-22";
const EXP_2Y = "2028-04-22";

export async function seedLots() {
  await db.insert(schema.lots).values([
    {
      id: seedIds.lots.uaQuarantined,
      productId: seedIds.products.urolithinRaw,
      lotNumber: "UA-2026-Q01",
      supplierName: "Primary Urolithin A Supplier",
      receivedDate: TODAY,
      expirationDate: EXP_2Y,
      quarantineStatus: "QUARANTINED",
    },
    {
      id: seedIds.lots.uaSampling,
      productId: seedIds.products.urolithinRaw,
      lotNumber: "UA-2026-Q02",
      supplierName: "Primary Urolithin A Supplier",
      receivedDate: TODAY,
      expirationDate: EXP_2Y,
      quarantineStatus: "SAMPLING",
    },
    {
      id: seedIds.lots.uaPendingQC,
      productId: seedIds.products.urolithinRaw,
      lotNumber: "UA-2026-Q03",
      supplierName: "Primary Urolithin A Supplier",
      receivedDate: TODAY,
      expirationDate: EXP_2Y,
      quarantineStatus: "PENDING_QC",
    },
    {
      id: seedIds.lots.uaApproved,
      productId: seedIds.products.urolithinRaw,
      lotNumber: "UA-2026-A01",
      supplierName: "Primary Urolithin A Supplier",
      receivedDate: "2026-03-01",
      expirationDate: EXP_2Y,
      quarantineStatus: "APPROVED",
    },
    {
      id: seedIds.lots.uaRejected,
      productId: seedIds.products.urolithinRaw,
      lotNumber: "UA-2026-R01",
      supplierName: "Primary Urolithin A Supplier",
      receivedDate: "2026-02-15",
      expirationDate: EXP_2Y,
      quarantineStatus: "REJECTED",
      notes: "OOS: lead 1.2 µg/g (limit 0.5 µg/g)",
    },
    {
      id: seedIds.lots.nmnPendingQC,
      productId: seedIds.products.nmnRaw,
      lotNumber: "NMN-2026-Q01",
      supplierName: "Primary NMN Supplier",
      receivedDate: TODAY,
      expirationDate: EXP_2Y,
      quarantineStatus: "PENDING_QC",
      notes: "COA from disqualified lab — intentional test fixture",
    },
    {
      id: seedIds.lots.fgProUro,
      productId: seedIds.products.proUroFinished,
      lotNumber: "FG-UA-2026-001",
      receivedDate: "2026-03-15",
      expirationDate: "2028-03-15",
      quarantineStatus: "APPROVED",
    },
    {
      id: seedIds.lots.fgNmn,
      productId: seedIds.products.nmnFinished,
      lotNumber: "FG-NMN-2026-001",
      receivedDate: "2026-03-15",
      expirationDate: "2028-03-15",
      quarantineStatus: "APPROVED",
    },
  ]).onConflictDoNothing();

  // Receiving records — one per lot
  await db.insert(schema.receivingRecords).values([
    { id: seedIds.receivingRecords.uaQuarantined, lotId: seedIds.lots.uaQuarantined, uniqueIdentifier: "RCV-20260422-001", supplierId: seedIds.suppliers.primaryUA,  dateReceived: TODAY,        quantityReceived: "25000", uom: "g",   status: "QUARANTINED" },
    { id: seedIds.receivingRecords.uaSampling,    lotId: seedIds.lots.uaSampling,    uniqueIdentifier: "RCV-20260422-002", supplierId: seedIds.suppliers.primaryUA,  dateReceived: TODAY,        quantityReceived: "25000", uom: "g",   status: "SAMPLING" },
    { id: seedIds.receivingRecords.uaPendingQC,   lotId: seedIds.lots.uaPendingQC,   uniqueIdentifier: "RCV-20260422-003", supplierId: seedIds.suppliers.primaryUA,  dateReceived: TODAY,        quantityReceived: "25000", uom: "g",   status: "PENDING_QC" },
    { id: seedIds.receivingRecords.uaApproved,    lotId: seedIds.lots.uaApproved,    uniqueIdentifier: "RCV-20260301-001", supplierId: seedIds.suppliers.primaryUA,  dateReceived: "2026-03-01", quantityReceived: "25000", uom: "g",   status: "APPROVED",  qcDisposition: "APPROVED",  qcReviewedBy: seedIds.users.carrieTreat, qcNotes: "All COAs pass" },
    { id: seedIds.receivingRecords.uaRejected,    lotId: seedIds.lots.uaRejected,    uniqueIdentifier: "RCV-20260215-001", supplierId: seedIds.suppliers.primaryUA,  dateReceived: "2026-02-15", quantityReceived: "25000", uom: "g",   status: "REJECTED",  qcDisposition: "REJECTED",  qcReviewedBy: seedIds.users.carrieTreat, qcNotes: "Lead OOS: 1.2 µg/g" },
    { id: seedIds.receivingRecords.nmnPendingQC,  lotId: seedIds.lots.nmnPendingQC,  uniqueIdentifier: "RCV-20260422-004", supplierId: seedIds.suppliers.primaryNMN, dateReceived: TODAY,        quantityReceived: "10000", uom: "g",   status: "PENDING_QC" },
    { id: seedIds.receivingRecords.fgProUro,      lotId: seedIds.lots.fgProUro,      uniqueIdentifier: "RCV-20260315-001", dateReceived: "2026-03-15",               quantityReceived: "1000",  uom: "pcs", status: "APPROVED",  qcDisposition: "APPROVED",  qcReviewedBy: seedIds.users.carrieTreat },
    { id: seedIds.receivingRecords.fgNmn,         lotId: seedIds.lots.fgNmn,         uniqueIdentifier: "RCV-20260315-002", dateReceived: "2026-03-15",               quantityReceived: "500",   uom: "pcs", status: "APPROVED",  qcDisposition: "APPROVED",  qcReviewedBy: seedIds.users.carrieTreat },
  ]).onConflictDoNothing();

  // COA documents
  await db.insert(schema.coaDocuments).values([
    {
      id: seedIds.coas.uaApprovedIdentity,
      lotId: seedIds.lots.uaApproved,
      receivingRecordId: seedIds.receivingRecords.uaApproved,
      sourceType: "THIRD_PARTY_LAB",
      labName: "Eurofins Scientific",
      analysisDate: "2026-02-20",
      overallResult: "PASS",
      identityTestPerformed: "true",
      identityConfirmed: "true",
      identityTestMethod: "HPLC (USP method)",
      qcAccepted: "true",
      qcReviewedBy: seedIds.users.carrieTreat,
      testsPerformed: JSON.stringify([{ testName: "Identity", method: "HPLC", specification: "Conforms", result: "Conforms", passFail: "PASS" }]),
    },
    {
      id: seedIds.coas.uaApprovedPurity,
      lotId: seedIds.lots.uaApproved,
      receivingRecordId: seedIds.receivingRecords.uaApproved,
      sourceType: "THIRD_PARTY_LAB",
      labName: "Eurofins Scientific",
      analysisDate: "2026-02-20",
      overallResult: "PASS",
      qcAccepted: "true",
      qcReviewedBy: seedIds.users.carrieTreat,
      testsPerformed: JSON.stringify([{ testName: "Purity", method: "HPLC", specification: "≥98.0%", result: "99.2%", passFail: "PASS" }]),
    },
    {
      id: seedIds.coas.uaApprovedLead,
      lotId: seedIds.lots.uaApproved,
      receivingRecordId: seedIds.receivingRecords.uaApproved,
      sourceType: "THIRD_PARTY_LAB",
      labName: "Eurofins Scientific",
      analysisDate: "2026-02-20",
      overallResult: "PASS",
      qcAccepted: "true",
      qcReviewedBy: seedIds.users.carrieTreat,
      testsPerformed: JSON.stringify([{ testName: "Lead", method: "ICP-MS", specification: "≤0.5 µg/g", result: "0.12 µg/g", passFail: "PASS" }]),
    },
    {
      id: seedIds.coas.uaRejectedLead,
      lotId: seedIds.lots.uaRejected,
      receivingRecordId: seedIds.receivingRecords.uaRejected,
      sourceType: "THIRD_PARTY_LAB",
      labName: "Eurofins Scientific",
      analysisDate: "2026-02-10",
      overallResult: "FAIL",
      qcAccepted: "false",
      qcReviewedBy: seedIds.users.carrieTreat,
      qcNotes: "Lead OOS — reject and quarantine",
      testsPerformed: JSON.stringify([{ testName: "Lead", method: "ICP-MS", specification: "≤0.5 µg/g", result: "1.2 µg/g", passFail: "FAIL" }]),
    },
    {
      id: seedIds.coas.nmnPendingQC,
      lotId: seedIds.lots.nmnPendingQC,
      receivingRecordId: seedIds.receivingRecords.nmnPendingQC,
      sourceType: "THIRD_PARTY_LAB",
      labName: "Symbio Labs",
      analysisDate: TODAY,
      overallResult: "PASS",
      // intentionally not reviewed — exists to trigger DISQUALIFIED_LAB check
    },
  ]).onConflictDoNothing();
}

