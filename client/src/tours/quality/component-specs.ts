import type { DriveStep } from "driver.js";

export const componentSpecsSteps: DriveStep[] = [
  {
    element: "[data-tour='component-specs-list']",
    popover: {
      title: "Component specifications",
      description: "Approved quality specifications for each raw material and packaging component. Each SKU can have multiple versions — only the APPROVED version is used for COA evaluation at receiving.",
      side: "right",
    },
  },
  {
    element: "[data-tour='component-specs-new-button']",
    popover: {
      title: "Add a spec",
      description: "Create a new specification for a component SKU. Set acceptance limits for each analyte — these are compared against COA values when QC reviews an incoming lot.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='component-specs-version-badge']",
    popover: {
      title: "Version control",
      description: "Spec versions start as DRAFT. QA approves with an electronic signature. Once approved, creating a new version supersedes the previous one — the old version is retained for audit purposes.",
      side: "left",
    },
  },
];
