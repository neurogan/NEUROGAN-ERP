import type { DriveStep } from "driver.js";

export const labelingSteps: DriveStep[] = [
  {
    element: "[data-tour='labeling-tabs']",
    popover: {
      title: "Labeling module",
      description: "Three sub-sections: Artwork (version-controlled label designs), Spools (label inventory), and Reconciliation (issued vs. used balance per batch).",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='labeling-artwork-list']",
    popover: {
      title: "Artwork versions",
      description: "Each label design is versioned. Only APPROVED artwork can be issued for production. QA approves new versions with an electronic signature.",
      side: "right",
    },
  },
  {
    element: "[data-tour='labeling-new-artwork']",
    popover: {
      title: "New artwork version",
      description: "Upload a new label design and submit for QA review. The previous approved version remains active until the new one is explicitly approved.",
      side: "bottom",
    },
  },
];
