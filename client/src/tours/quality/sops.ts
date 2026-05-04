import type { DriveStep } from "driver.js";

export const sopsSteps: DriveStep[] = [
  {
    element: "[data-tour='sops-list']",
    popover: {
      title: "Standard Operating Procedures",
      description: "All SOPs in the system. Each SOP has a code, title, and version. Status flows DRAFT → APPROVED → RETIRED. Only APPROVED SOPs are considered in-effect.",
      side: "right",
    },
  },
  {
    element: "[data-tour='sops-new-button']",
    popover: {
      title: "Create a new SOP",
      description: "Register a new SOP with a unique code and version number. New SOPs start as DRAFT and require QA approval before taking effect.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='sops-approve-button']",
    popover: {
      title: "Approve or retire",
      description: "Approving a DRAFT SOP locks it with an electronic signature. Retiring removes it from active use without deleting the record — the full version history is preserved.",
      side: "left",
    },
  },
];
