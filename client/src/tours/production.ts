import type { DriveStep } from "driver.js";

export const productionSteps: DriveStep[] = [
  {
    element: "[data-tour='production-start-button']",
    popover: {
      title: "New batch",
      description: "Create a new Batch Production Record linked to an approved MMR. Specify the planned quantity and input lot assignments. Only APPROVED lots can be consumed.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='production-list']",
    popover: {
      title: "Batch Production Records",
      description: "All batches in the system. Status flows: DRAFT → IN_PROGRESS → COMPLETED. Click any batch to view its full BPR — steps, deviations, and label reconciliation.",
      side: "right",
    },
  },
];

export const bprSteps: DriveStep[] = [
  {
    element: "[data-tour='production-steps']",
    popover: {
      title: "Process steps",
      description: "Complete each manufacturing step in sequence. Steps are pre-populated from the MMR. Record actual values, equipment used, and the performing operator per step.",
      side: "left",
    },
  },
  {
    element: "[data-tour='production-deviations']",
    popover: {
      title: "Deviations",
      description: "Log any departure from the approved process here. Each deviation requires a QA electronic signature. Unresolved deviations block batch completion.",
      side: "left",
    },
  },
  {
    element: "[data-tour='production-label-recon']",
    popover: {
      title: "Label reconciliation",
      description: "Reconcile labels before closing: issued − applied − destroyed − returned must balance within tolerance. Discrepancies must be investigated before the batch can be released.",
      side: "left",
    },
  },
  {
    element: "[data-tour='production-qc-release']",
    popover: {
      title: "QC release",
      description: "After all steps, deviations, and label reconciliation are complete, QA reviews and signs the batch release. A released batch moves finished goods into inventory.",
      side: "top",
    },
  },
];
