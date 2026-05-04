import type { DriveStep } from "driver.js";

export const settingsSteps: DriveStep[] = [
  {
    element: "[data-tour='settings-validation']",
    popover: {
      title: "Validation documents",
      description: "IQ, OQ, PQ, and VSR documents for each system module. Documents start as DRAFT and become legally binding records once signed with an electronic signature by the Head of Quality Control.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='settings-labs']",
    popover: {
      title: "Accredited labs",
      description: "Registry of testing laboratories. Set a lab to DISQUALIFIED to block all new COAs from that lab. The system prevents QC approval on any lot with a COA from a disqualified lab.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='settings-users']",
    popover: {
      title: "Users and roles",
      description: "Manage system access here. Roles control what each person can do: ADMIN can do everything; QA can sign off on quality actions; WAREHOUSE handles receiving; LAB_TECH handles testing.",
      side: "bottom",
    },
  },
];
