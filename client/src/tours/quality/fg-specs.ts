import type { DriveStep } from "driver.js";

export const fgSpecsSteps: DriveStep[] = [
  {
    element: "[data-tour='fg-specs-list']",
    popover: {
      title: "Finished goods specifications",
      description: "Release specifications for finished products. Each finished product SKU has a versioned spec defining the analytical, microbiological, and nutrient content limits required for batch release.",
      side: "right",
    },
  },
  {
    element: "[data-tour='fg-specs-new-button']",
    popover: {
      title: "Add a finished goods spec",
      description: "Create a new spec for a finished product. Attributes are grouped by category: Nutrient Content, Contaminant, and Microbiological. Set target, min, and max values for each analyte.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='fg-specs-approve-button']",
    popover: {
      title: "Approve the spec",
      description: "QA approves the spec with an electronic signature. APPROVED specs are used to evaluate batch COAs before a production lot can be released to inventory.",
      side: "left",
    },
  },
];
