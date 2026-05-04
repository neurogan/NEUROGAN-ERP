import type { DriveStep } from "driver.js";

export const complaintsSteps: DriveStep[] = [
  {
    element: "[data-tour='complaints-list']",
    popover: {
      title: "Complaint queue",
      description: "Customer complaints pulled from HelpCore. Each complaint shows the HelpCore reference, customer, linked lot, severity, and current status.",
      side: "right",
    },
  },
  {
    element: "[data-tour='complaints-status-filter']",
    popover: {
      title: "Filter by status",
      description: "Use the status filter to focus on TRIAGE (new, unreviewed), INVESTIGATION (in progress), or AE_URGENT_REVIEW (adverse event — must be reviewed within 24 hours).",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='complaints-ae-flag']",
    popover: {
      title: "Adverse event flag",
      description: "The AE flag marks complaints that may constitute an adverse event. AE-flagged complaints trigger a mandatory urgent review workflow and must be documented per 21 CFR Part 111.",
      side: "left",
    },
  },
];
