// F-09: Stable UUID constants for all seed records.
//
// Every ID here is fixed. The seeder uses INSERT ... ON CONFLICT DO NOTHING so
// running it twice produces the same state. Tests reference fixtures by name:
//
//   import { seedIds } from "../../seed/ids";
//   expect(row.userId).toBe(seedIds.users.carrieTreat);

// All IDs use only hex characters so they are valid for both uuid and varchar
// columns. Pattern: 00000000-0000-00NN-0000-00000000000K where NN = namespace
// (01..0b) and K = sequence within namespace.
export const HELPCORE_SYSTEM_USER_ID = "00000000-0000-0000-cafe-000000000001";

export const seedIds = {
  users: {
    frederik:       "00000000-0000-0001-0000-000000000008",
    steven:         "00000000-0000-0001-0000-000000000009",
    carrieTreat:    "00000000-0000-0001-0000-000000000002",
  },
  locations: {
    quarantine:     "00000000-0000-0002-0000-000000000001",
    bulk:           "00000000-0000-0002-0000-000000000002",
    fg:             "00000000-0000-0002-0000-000000000003",
    retain:         "00000000-0000-0002-0000-000000000004",
    destroy:        "00000000-0000-0002-0000-000000000005",
  },
  suppliers: {
    primaryUA:      "00000000-0000-0003-0000-000000000001",
    primaryNMN:     "00000000-0000-0003-0000-000000000002",
    pending:        "00000000-0000-0003-0000-000000000003",
    disqualified:   "00000000-0000-0003-0000-000000000004",
  },
  supplierQualifications: {
    primaryUA:      "00000000-0000-0004-0000-000000000001",
    primaryNMN:     "00000000-0000-0004-0000-000000000002",
    pending:        "00000000-0000-0004-0000-000000000003",
    disqualified:   "00000000-0000-0004-0000-000000000004",
  },
  productCategories: {
    rawMaterial:    "00000000-0000-0005-0000-000000000001",
    packaging:      "00000000-0000-0005-0000-000000000002",
    finishedGoods:  "00000000-0000-0005-0000-000000000003",
  },
  products: {
    urolithinRaw:   "00000000-0000-0006-0000-000000000001",
    nmnRaw:         "00000000-0000-0006-0000-000000000002",
    gelcaps:        "00000000-0000-0006-0000-000000000003",
    proUroFinished: "00000000-0000-0006-0000-000000000004",
    nmnFinished:    "00000000-0000-0006-0000-000000000005",
  },
  lots: {
    uaQuarantined:  "00000000-0000-0007-0000-000000000001",
    uaSampling:     "00000000-0000-0007-0000-000000000002",
    uaPendingQC:    "00000000-0000-0007-0000-000000000003",
    uaApproved:     "00000000-0000-0007-0000-000000000004",
    uaRejected:     "00000000-0000-0007-0000-000000000005",
    nmnPendingQC:   "00000000-0000-0007-0000-000000000006",
    fgProUro:       "00000000-0000-0007-0000-000000000007",
    fgNmn:          "00000000-0000-0007-0000-000000000008",
  },
  receivingRecords: {
    uaQuarantined:  "00000000-0000-0008-0000-000000000001",
    uaSampling:     "00000000-0000-0008-0000-000000000002",
    uaPendingQC:    "00000000-0000-0008-0000-000000000003",
    uaApproved:     "00000000-0000-0008-0000-000000000004",
    uaRejected:     "00000000-0000-0008-0000-000000000005",
    nmnPendingQC:   "00000000-0000-0008-0000-000000000006",
    fgProUro:       "00000000-0000-0008-0000-000000000007",
    fgNmn:          "00000000-0000-0008-0000-000000000008",
  },
  coas: {
    uaApprovedIdentity: "00000000-0000-0009-0000-000000000001",
    uaApprovedPurity:   "00000000-0000-0009-0000-000000000002",
    uaApprovedLead:     "00000000-0000-0009-0000-000000000003",
    uaRejectedLead:     "00000000-0000-0009-0000-000000000004",
    nmnPendingQC:       "00000000-0000-0009-0000-000000000005",
  },
  recipes: {
    proUroV1:       "00000000-0000-000a-0000-000000000001",
  },
  recipeLines: {
    proUroUa:       "00000000-0000-000b-0000-000000000001",
    proUroGelcaps:  "00000000-0000-000b-0000-000000000002",
  },
  validationDocuments: {
    iqPlatform:   "00000000-0000-000c-0000-000000000001",
    oqPlatform:   "00000000-0000-000c-0000-000000000002",
    pqPlatform:   "00000000-0000-000c-0000-000000000003",
    vsrPlatform:  "00000000-0000-000c-0000-000000000004",
    iqReceiving:  "00000000-0000-000c-0000-000000000005",
    oqReceiving:  "00000000-0000-000c-0000-000000000006",
    pqReceiving:  "00000000-0000-000c-0000-000000000007",
    vsrReceiving: "00000000-0000-000c-0000-000000000008",
  },
} as const;

export type SeedIds = typeof seedIds;
