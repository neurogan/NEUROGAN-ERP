import type { DriveStep } from "driver.js";

export const inventorySteps: DriveStep[] = [
  {
    element: "[data-tour='inventory-tabs']",
    popover: {
      title: "Inventory views",
      description: "Materials shows current stock by product and lot. Transactions is the append-only ledger of every inventory movement — receipts, production consumption, and adjustments.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='inventory-materials-list']",
    popover: {
      title: "Products and lots",
      description: "Each product expands to show its individual lots. Available quantity is stock cleared for use; Quarantine is stock still under QC hold.",
      side: "right",
    },
  },
  {
    element: "[data-tour='inventory-lot-quantities']",
    popover: {
      title: "Available vs. quarantine",
      description: "Quarantined stock is visible but blocked from production until QC approves the lot. Once approved in Receiving, quantity moves from quarantine to available automatically.",
      side: "left",
    },
  },
  {
    element: "[data-tour='inventory-export']",
    popover: {
      title: "Export",
      description: "Download the current inventory view as a CSV — includes lot numbers, status, available and quarantine quantities.",
      side: "left",
    },
  },
];
