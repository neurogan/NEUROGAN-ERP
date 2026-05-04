import type { DriveStep } from "driver.js";

export const skuManagerSteps: DriveStep[] = [
  {
    element: "[data-tour='sku-list']",
    popover: {
      title: "SKU / product catalog",
      description: "Every item in the system — raw materials, packaging, and finished goods — must exist here before it can be received or produced. Category determines the QC workflow applied at receiving.",
      side: "right",
    },
  },
  {
    element: "[data-tour='sku-new-button']",
    popover: {
      title: "Add a SKU",
      description: "Register a new product. Set the category carefully: active ingredients get full lab testing; secondary packaging is exempt. Category cannot be changed after the first receiving record is created.",
      side: "bottom",
    },
  },
];
