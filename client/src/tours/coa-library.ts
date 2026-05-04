import type { DriveStep } from "driver.js";

export const coaLibrarySteps: DriveStep[] = [
  {
    element: "[data-tour='coa-list']",
    popover: {
      title: "COA library",
      description: "All Certificates of Analysis on file, searchable by lot, product, or lab. COAs are linked to receiving records and batch records for full traceability.",
      side: "right",
    },
  },
  {
    element: "[data-tour='coa-upload-button']",
    popover: {
      title: "Upload a COA",
      description: "Attach a new COA and link it to a lot or batch. The issuing lab must be in the accredited labs registry — disqualified labs are blocked.",
      side: "bottom",
    },
  },
];
