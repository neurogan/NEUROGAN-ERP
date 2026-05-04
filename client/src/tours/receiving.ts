import type { DriveStep } from "driver.js";

export const receivingSteps: DriveStep[] = [
  {
    element: "[data-tour='receiving-status-filter']",
    popover: {
      title: "Status filter",
      description: "Filter records by QC stage. QUARANTINED = arrived, awaiting inspection. SAMPLING = samples being pulled. PENDING_QC = ready for disposition. APPROVED / REJECTED = complete.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='receiving-list']",
    popover: {
      title: "Receiving records",
      description: "Each row is one receiving event linked to a PO line and a lot. Click any row to open the detail and work through the QC workflow.",
      side: "right",
    },
  },
  {
    element: "[data-tour='receiving-detail']",
    popover: {
      title: "Record detail",
      description: "The detail panel shows the lot, supplier, quantity, and the current QC stage. Work through the steps here: visual inspection → sampling → COA attachment → disposition.",
      side: "left",
    },
  },
  {
    element: "[data-tour='receiving-visual-exam']",
    popover: {
      title: "Visual inspection",
      description: "Complete all visual inspection fields before the lot can advance. Required by 21 CFR Part 111 §111.75(a)(1)(i). Missing fields block the status transition.",
      side: "top",
    },
  },
  {
    element: "[data-tour='receiving-sampling-plan']",
    popover: {
      title: "Sampling plan",
      description: "For active and supporting ingredients, the system calculates how many containers to sample using ANSI/ASQ Z1.4 AQL 2.5. Pull exactly this many samples for the lab.",
      side: "top",
    },
  },
  {
    element: "[data-tour='receiving-coa']",
    popover: {
      title: "Certificate of Analysis",
      description: "Attach the supplier's COA from an accredited lab. Disqualified labs are blocked automatically. Identity confirmation is required for active ingredients.",
      side: "top",
    },
  },
  {
    element: "[data-tour='receiving-qc-review']",
    popover: {
      title: "QC disposition",
      description: "Submit APPROVED, REJECTED, or APPROVED WITH CONDITIONS with an electronic signature. Approval releases the lot to available inventory. Rejection locks the lot permanently.",
      side: "top",
    },
  },
];
