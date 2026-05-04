import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import type { DriveStep } from "driver.js";

import { dashboardSteps } from "./dashboard";
import { inventorySteps } from "./inventory";
import { receivingSteps } from "./receiving";
import { purchaseOrdersSteps } from "./purchase-orders";
import { suppliersSteps } from "./suppliers";
import { productionSteps, bprSteps } from "./production";
import { mmrSteps } from "./mmr";
import { equipmentSteps } from "./equipment";
import { skuManagerSteps } from "./sku-manager";
import { coaLibrarySteps } from "./coa-library";
import { settingsSteps } from "./settings";
import { labelingSteps } from "./quality/labeling";
import { sopsSteps } from "./quality/sops";
import { complaintsSteps } from "./quality/complaints";
import { returnsSteps } from "./quality/returns";
import { oosSteps } from "./quality/oos";
import { componentSpecsSteps } from "./quality/component-specs";
import { fgSpecsSteps } from "./quality/fg-specs";
import { retainedSamplesSteps } from "./quality/retained-samples";
import { capaSteps } from "./quality/capa";
import { trainingSteps } from "./quality/training";
import { stabilitySteps } from "./quality/stability";
import { emSteps } from "./quality/em";

interface TourEntry {
  pattern: RegExp;
  steps: DriveStep[];
}

const REGISTRY: TourEntry[] = [
  { pattern: /^\/$/, steps: dashboardSteps },
  { pattern: /^\/inventory/, steps: inventorySteps },
  { pattern: /^\/procurement\/receiving/, steps: receivingSteps },
  { pattern: /^\/procurement\/purchase-orders/, steps: purchaseOrdersSteps },
  { pattern: /^\/procurement\/suppliers/, steps: suppliersSteps },
  { pattern: /^\/procurement/, steps: purchaseOrdersSteps },
  { pattern: /^\/bpr\//, steps: bprSteps },
  { pattern: /^\/operations\/production-batches/, steps: productionSteps },
  { pattern: /^\/operations\/mmr/, steps: mmrSteps },
  { pattern: /^\/operations\/equipment/, steps: equipmentSteps },
  { pattern: /^\/operations/, steps: productionSteps },
  { pattern: /^\/sku-manager/, steps: skuManagerSteps },
  { pattern: /^\/coa/, steps: coaLibrarySteps },
  { pattern: /^\/settings/, steps: settingsSteps },
  { pattern: /^\/quality\/labeling/, steps: labelingSteps },
  { pattern: /^\/quality\/sops/, steps: sopsSteps },
  { pattern: /^\/quality\/complaints/, steps: complaintsSteps },
  { pattern: /^\/quality\/returns/, steps: returnsSteps },
  { pattern: /^\/quality\/oos/, steps: oosSteps },
  { pattern: /^\/quality\/component-specifications/, steps: componentSpecsSteps },
  { pattern: /^\/quality\/fg-specifications/, steps: fgSpecsSteps },
  { pattern: /^\/quality\/retained-samples/, steps: retainedSamplesSteps },
  { pattern: /^\/quality\/capa/, steps: capaSteps },
  { pattern: /^\/quality\/training/, steps: trainingSteps },
  { pattern: /^\/quality\/stability/, steps: stabilitySteps },
  { pattern: /^\/quality\/em/, steps: emSteps },
];

export function startTour(location: string): boolean {
  const entry = REGISTRY.find((r) => r.pattern.test(location));
  if (!entry || entry.steps.length === 0) return false;

  const d = driver({
    showProgress: true,
    animate: true,
    overlayOpacity: 0.6,
    nextBtnText: "Next →",
    prevBtnText: "← Back",
    doneBtnText: "Done",
    onDestroyStarted: () => { d.destroy(); },
    steps: entry.steps,
  });

  d.drive();
  return true;
}
