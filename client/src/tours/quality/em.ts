import type { DriveStep } from "driver.js";

export const emSteps: DriveStep[] = [
  {
    element: "[data-tour='em-sites-list']",
    popover: {
      title: "Monitoring sites",
      description: "All registered environmental monitoring locations: air sampling points, non-contact surfaces, and contact surfaces. Each site has a sampling schedule and organism-specific alert and action limits.",
      side: "right",
    },
  },
  {
    element: "[data-tour='em-due-today']",
    popover: {
      title: "Due for sampling",
      description: "Sites where a scheduled sampling event is due or overdue. Complete these before starting any production run on the affected area.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='em-log-result']",
    popover: {
      title: "Log a result",
      description: "Enter the CFU count per organism for a completed sampling event. The system evaluates against alert and action limits automatically. Action-level exceedances open a Non-Conformance record immediately.",
      side: "left",
    },
  },
  {
    element: "[data-tour='em-excursions']",
    popover: {
      title: "Excursions",
      description: "Results that exceeded the alert or action limit. Each excursion links to its NC and tracks investigation status. Unresolved action-level excursions block production in the affected area.",
      side: "left",
    },
  },
];
