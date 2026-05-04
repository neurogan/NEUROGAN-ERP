import type { DriveStep } from "driver.js";

export const oosSteps: DriveStep[] = [
  {
    element: "[data-tour='oos-list']",
    popover: {
      title: "OOS investigations",
      description: "Out-of-Specification results from lab testing. Any COA result that falls outside the approved specification limits triggers an OOS investigation that must be closed before the lot can be released.",
      side: "right",
    },
  },
  {
    element: "[data-tour='oos-status-filter']",
    popover: {
      title: "Filter by status",
      description: "OPEN = investigation started. PHASE_2 = initial lab error review complete, phase 2 (manufacturing) investigation in progress. CLOSED = resolved with documented root cause and disposition.",
      side: "bottom",
    },
  },
];
