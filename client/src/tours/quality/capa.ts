import type { DriveStep } from "driver.js";

export const capaSteps: DriveStep[] = [
  {
    element: "[data-tour='capa-nc-list']",
    popover: {
      title: "Non-conformances",
      description: "Every deviation, OOS result, complaint, or audit finding that triggers a formal investigation is tracked here as a Non-Conformance (NC). NCs can be OPEN, UNDER_INVESTIGATION, CAPA_OPEN, or CLOSED.",
      side: "right",
    },
  },
  {
    element: "[data-tour='capa-new-nc-button']",
    popover: {
      title: "Open a non-conformance",
      description: "Log a new NC with type (OOS, Complaint, Deviation, etc.), severity (Critical/Major/Minor), and a description. The NC drives the CAPA if root cause investigation identifies a systemic issue.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='capa-capa-list']",
    popover: {
      title: "CAPA actions",
      description: "Corrective and Preventive Actions linked to NCs. Each CAPA has an assigned root cause, a list of actions with due dates, and an effectiveness check scheduled after actions are complete.",
      side: "right",
    },
  },
  {
    element: "[data-tour='capa-effectiveness-check']",
    popover: {
      title: "Effectiveness verification",
      description: "After CAPA actions are complete, schedule an effectiveness check to confirm the root cause is resolved. The CAPA cannot be closed until the check is marked EFFECTIVE.",
      side: "left",
    },
  },
];
