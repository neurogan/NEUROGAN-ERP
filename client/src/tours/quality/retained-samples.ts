import type { DriveStep } from "driver.js";

export const retainedSamplesSteps: DriveStep[] = [
  {
    element: "[data-tour='retained-samples-list']",
    popover: {
      title: "Retained sample registry",
      description: "One retained sample record per batch. Samples are held for the full shelf-life period plus one year. ACTIVE = within retention window. Due for destruction = retention period has elapsed.",
      side: "right",
    },
  },
  {
    element: "[data-tour='retained-samples-add-button']",
    popover: {
      title: "Log a retained sample",
      description: "Record the pulled quantity, storage location, and retention expiry for a batch. Link it to the BPR so the sample is traceable to the batch record.",
      side: "bottom",
    },
  },
  {
    element: "[data-tour='retained-samples-destroy-button']",
    popover: {
      title: "Record destruction",
      description: "When a sample's retention period expires, log the destruction event here. The record is preserved permanently — destruction closes the loop but does not delete the entry.",
      side: "left",
    },
  },
];
