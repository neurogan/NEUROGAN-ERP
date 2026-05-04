import type { DriveStep } from "driver.js";

export const mmrSteps: DriveStep[] = [
  {
    element: "[data-tour='mmr-list']",
    popover: {
      title: "Master Manufacturing Records",
      description: "Each MMR defines the recipe, steps, equipment, and materials for one product. Only APPROVED versions can be used to start production.",
      side: "right",
    },
  },
  {
    element: "[data-tour='mmr-version-badge']",
    popover: {
      title: "Version control",
      description: "MMRs are versioned. Approving a new version does not change historical batches — each batch is permanently locked to the version that was active when it started.",
      side: "left",
    },
  },
  {
    element: "[data-tour='mmr-steps']",
    popover: {
      title: "Process steps",
      description: "Define the manufacturing steps, critical parameters, and required equipment here. Steps are copied into each new BPR at batch start.",
      side: "left",
    },
  },
  {
    element: "[data-tour='mmr-inventory-link']",
    popover: {
      title: "Product inventory link",
      description: "Jump directly to this product's inventory to see current stock across all lots.",
      side: "bottom",
    },
  },
];
