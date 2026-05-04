import type { DriveStep } from "driver.js";

export const trainingSteps: DriveStep[] = [
  {
    element: "[data-tour='training-programs-list']",
    popover: {
      title: "Training programs",
      description: "The catalogue of required training courses. Each program has a validity period and is assigned to specific roles. When a new user is added with a role, the system generates training assignments automatically.",
      side: "right",
    },
  },
  {
    element: "[data-tour='training-compliance-matrix']",
    popover: {
      title: "Compliance matrix",
      description: "Shows every user's training status per program: CURRENT, EXPIRING_SOON, EXPIRED, or NEVER_TRAINED. Expired training blocks the user from performing certain quality actions until retraining is recorded.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='training-record-completion']",
    popover: {
      title: "Record a completion",
      description: "Log that a user has completed a training program. The next expiry date is calculated automatically from the program's validity period. Training records are permanent — they cannot be deleted.",
      side: "left",
    },
  },
];
