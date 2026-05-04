import type { DriveStep } from "driver.js";

export const stabilitySteps: DriveStep[] = [
  {
    element: "[data-tour='stability-protocols-list']",
    popover: {
      title: "Stability protocols",
      description: "Each protocol defines the storage condition, test intervals (e.g. 3, 6, 12, 24 months), and which analytes to test. Protocols are linked to finished goods SKUs.",
      side: "right",
    },
  },
  {
    element: "[data-tour='stability-batches-list']",
    popover: {
      title: "Stability batches",
      description: "Batches enrolled in a stability program. Each enrolled batch generates a timepoint schedule. Overdue timepoints are flagged — completing them on time is required for continued shelf-life support.",
      side: "right",
    },
  },
  {
    element: "[data-tour='stability-timepoint-results']",
    popover: {
      title: "Timepoint results",
      description: "Enter test results for each analyte at each scheduled timepoint. Pass/Fail is evaluated automatically against the protocol limits. A single FAIL triggers an OOS investigation.",
      side: "left",
    },
  },
  {
    element: "[data-tour='stability-conclusion']",
    popover: {
      title: "Stability conclusion",
      description: "When sufficient data is collected, QA signs a stability conclusion supporting the product's shelf-life claim. This conclusion must be in place before the shelf-life date can be locked on production labels.",
      side: "left",
    },
  },
];
