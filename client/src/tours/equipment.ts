import type { DriveStep } from "driver.js";

export const equipmentSteps: DriveStep[] = [
  {
    element: "[data-tour='equipment-tabs']",
    popover: {
      title: "Equipment sections",
      description: "Master is the equipment register. Calibration tracks calibration schedules and history. Cleaning logs cleaning events. Line Clearance records pre-batch clearance checks.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='equipment-list']",
    popover: {
      title: "Equipment register",
      description: "All equipment with current calibration status. Red = overdue. Overdue calibration automatically blocks any BPR that requires that piece of equipment.",
      side: "right",
    },
  },
  {
    element: "[data-tour='equipment-calibration']",
    popover: {
      title: "Calibration schedule",
      description: "Calibration records per instrument. Log new calibrations here after each service. The next due date is calculated automatically from the calibration interval.",
      side: "left",
    },
  },
  {
    element: "[data-tour='equipment-cleaning']",
    popover: {
      title: "Cleaning logs",
      description: "Required cleaning records per batch. The cleaner and verifier must be different people — the system enforces this separation.",
      side: "left",
    },
  },
  {
    element: "[data-tour='equipment-line-clearance']",
    popover: {
      title: "Line clearance",
      description: "Pre-production checklist confirming no materials, labels, or residue from a previous run remain. Must be completed before a new batch can start on that line.",
      side: "left",
    },
  },
];
