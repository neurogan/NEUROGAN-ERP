import type { DriveStep } from "driver.js";

export const dashboardSteps: DriveStep[] = [
  {
    element: "[data-testid='summary-batches']",
    popover: {
      title: "Live summary",
      description: "Quick-glance counts for active batches, open POs, and supply chain alerts. Click any pill to jump straight to that section.",
      side: "bottom",
    },
  },
  {
    element: "[data-testid='card-active-batches']",
    popover: {
      title: "Active production batches",
      description: "All Batch Production Records currently in progress. Click any row to open the BPR and record steps, deviations, or yield.",
      side: "left",
    },
  },
  {
    element: "[data-testid='card-open-pos']",
    popover: {
      title: "Open purchase orders",
      description: "POs with outstanding receipts. Click a row to go directly to the receiving record for that line.",
      side: "left",
    },
  },
  {
    element: "[data-testid='card-supply-chain']",
    popover: {
      title: "Supply chain alerts",
      description: "Materials at risk of running out based on open batches and current stock. Acts as an early warning before production is blocked.",
      side: "left",
    },
  },
  {
    element: "[data-testid='card-calibrations-due']",
    popover: {
      title: "Calibrations due",
      description: "Equipment with calibration overdue or coming due within 7 days. Overdue calibration blocks any BPR that uses that equipment.",
      side: "left",
    },
  },
  {
    element: "[data-testid='card-artwork-pending-qa']",
    popover: {
      title: "Artwork pending QA",
      description: "Label artwork versions awaiting QA approval. Unapproved artwork cannot be used in production.",
      side: "left",
    },
  },
  {
    element: "[data-testid='card-complaints-triage']",
    popover: {
      title: "Compliance actions",
      description: "QC actions requiring attention: complaints to triage, adverse events with approaching SAER deadlines, returns to disposition. Click any card to jump to the relevant workflow.",
      side: "top",
    },
  },
];
