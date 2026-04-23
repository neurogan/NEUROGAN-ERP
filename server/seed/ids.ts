// F-09: Stable UUID constants for all seed records.
//
// Every ID here is fixed. The seeder uses INSERT ... ON CONFLICT DO NOTHING so
// running it twice produces the same state. Tests reference fixtures by name:
//
//   import { seedIds } from "../../seed/ids";
//   expect(row.userId).toBe(seedIds.users.carrieTreat);

export const seedIds = {
  users: {
    admin:       "00000001-seed-0000-0000-000000000001",
    carrieTreat: "00000001-seed-0000-0000-000000000002",
    prod:        "00000001-seed-0000-0000-000000000003",
    prod2:       "00000001-seed-0000-0000-000000000004",
    recv:        "00000001-seed-0000-0000-000000000005",
    viewer:      "00000001-seed-0000-0000-000000000006",
    disabled:    "00000001-seed-0000-0000-000000000007",
  },
  locations: {
    quarantine: "00000002-seed-0000-0000-000000000001",
    bulk:       "00000002-seed-0000-0000-000000000002",
    fg:         "00000002-seed-0000-0000-000000000003",
    retain:     "00000002-seed-0000-0000-000000000004",
    destroy:    "00000002-seed-0000-0000-000000000005",
  },
  suppliers: {
    primaryUA:    "00000003-seed-0000-0000-000000000001",
    primaryNMN:   "00000003-seed-0000-0000-000000000002",
    pending:      "00000003-seed-0000-0000-000000000003",
    disqualified: "00000003-seed-0000-0000-000000000004",
  },
  supplierQualifications: {
    primaryUA:    "00000004-seed-0000-0000-000000000001",
    primaryNMN:   "00000004-seed-0000-0000-000000000002",
    pending:      "00000004-seed-0000-0000-000000000003",
    disqualified: "00000004-seed-0000-0000-000000000004",
  },
  productCategories: {
    rawMaterial:   "00000005-seed-0000-0000-000000000001",
    packaging:     "00000005-seed-0000-0000-000000000002",
    finishedGoods: "00000005-seed-0000-0000-000000000003",
  },
  products: {
    urolithinRaw: "00000006-seed-0000-0000-000000000001",
    nmnRaw:       "00000006-seed-0000-0000-000000000002",
    gelcaps:      "00000006-seed-0000-0000-000000000003",
    proUroFinished: "00000006-seed-0000-0000-000000000004",
    nmnFinished:  "00000006-seed-0000-0000-000000000005",
  },
  lots: {
    uaQuarantined: "00000007-seed-0000-0000-000000000001",
    uaSampling:    "00000007-seed-0000-0000-000000000002",
    uaPendingQC:   "00000007-seed-0000-0000-000000000003",
    uaApproved:    "00000007-seed-0000-0000-000000000004",
    uaRejected:    "00000007-seed-0000-0000-000000000005",
    nmnPendingQC:  "00000007-seed-0000-0000-000000000006",
    fgProUro:      "00000007-seed-0000-0000-000000000007",
    fgNmn:         "00000007-seed-0000-0000-000000000008",
  },
  receivingRecords: {
    uaQuarantined: "00000008-seed-0000-0000-000000000001",
    uaSampling:    "00000008-seed-0000-0000-000000000002",
    uaPendingQC:   "00000008-seed-0000-0000-000000000003",
    uaApproved:    "00000008-seed-0000-0000-000000000004",
    uaRejected:    "00000008-seed-0000-0000-000000000005",
    nmnPendingQC:  "00000008-seed-0000-0000-000000000006",
    fgProUro:      "00000008-seed-0000-0000-000000000007",
    fgNmn:         "00000008-seed-0000-0000-000000000008",
  },
  coas: {
    uaApprovedIdentity: "00000009-seed-0000-0000-000000000001",
    uaApprovedPurity:   "00000009-seed-0000-0000-000000000002",
    uaApprovedLead:     "00000009-seed-0000-0000-000000000003",
    uaRejectedLead:     "00000009-seed-0000-0000-000000000004",
    nmnPendingQC:       "00000009-seed-0000-0000-000000000005",
  },
  recipes: {
    proUroV1: "00000010-seed-0000-0000-000000000001",
  },
  recipeLines: {
    proUroUa:      "00000011-seed-0000-0000-000000000001",
    proUroGelcaps: "00000011-seed-0000-0000-000000000002",
  },
} as const;

export type SeedIds = typeof seedIds;
