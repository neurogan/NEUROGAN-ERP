import type { DriveStep } from "driver.js";

export const suppliersSteps: DriveStep[] = [
  {
    element: "[data-tour='suppliers-list']",
    popover: {
      title: "Approved suppliers",
      description: "All suppliers on file. Active ingredient suppliers must be qualified — the system tracks approval status per supplier/material combination.",
      side: "right",
    },
  },
  {
    element: "[data-tour='suppliers-new-button']",
    popover: {
      title: "Add supplier",
      description: "Register a new supplier. New active ingredient suppliers start as unqualified and will require FULL_LAB_TEST for their first receipt.",
      side: "bottom",
    },
  },
];
