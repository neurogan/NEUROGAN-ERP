import type { DriveStep } from "driver.js";

export const purchaseOrdersSteps: DriveStep[] = [
  {
    element: "[data-tour='po-new-button']",
    popover: {
      title: "Create purchase order",
      description: "Start a new PO by selecting a supplier and adding line items. Only approved suppliers appear in the dropdown.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='po-list']",
    popover: {
      title: "Purchase orders",
      description: "All open and recently closed POs. Each row shows the supplier, status, and how much has been received vs. ordered.",
      side: "right",
    },
  },
  {
    element: "[data-tour='po-receive-button']",
    popover: {
      title: "Receive against a PO",
      description: "Click Receive to record a delivery against a PO line. This creates a lot and a receiving record, and automatically places the lot in QUARANTINED status.",
      side: "left",
    },
  },
];
