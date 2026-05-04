import type { DriveStep } from "driver.js";

export const returnsSteps: DriveStep[] = [
  {
    element: "[data-tour='returns-list']",
    popover: {
      title: "Returned products",
      description: "All physical product returns from Amazon FBA, wholesale customers, or other channels. Each return is quarantined on receipt and must be dispositioned before inventory is affected.",
      side: "right",
    },
  },
  {
    element: "[data-tour='returns-new-button']",
    popover: {
      title: "Log a return",
      description: "Record a new return: source, lot code, quantity, and condition notes. The return enters QUARANTINE status automatically — it will not affect inventory until a disposition decision is made.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='returns-status-filter']",
    popover: {
      title: "Filter by status",
      description: "QUARANTINE = awaiting disposition. DISPOSED = investigation complete, product written off. Click any return row to open the investigation and record the disposition decision.",
      side: "bottom",
    },
  },
];
