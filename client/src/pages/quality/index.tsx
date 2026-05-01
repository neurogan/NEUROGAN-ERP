import { useEffect } from "react";
import { useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import LabelingPage from "./labeling";
import SopsPage from "./sops";
import ComplaintsPage from "./complaints";
import ReturnsPage from "./returns";
import OosInvestigations from "@/pages/OosInvestigations";
import ComponentSpecifications from "./ComponentSpecifications";
import FinishedGoodsSpecifications from "./FinishedGoodsSpecifications";

type QualityTab = "labeling" | "sops" | "complaints" | "returns" | "oos" | "component-specifications" | "fg-specifications";

const ACTIVE_TABS: { value: QualityTab; label: string }[] = [
  { value: "labeling", label: "Labeling" },
  { value: "sops", label: "SOPs" },
  { value: "complaints", label: "Complaints" },
  { value: "returns", label: "Returns" },
  { value: "oos", label: "OOS" },
  { value: "component-specifications", label: "Component Specifications" },
  { value: "fg-specifications", label: "FG Specifications" },
];

const DISABLED_TABS: { value: string; label: string; tooltip: string }[] = [
  { value: "validation", label: "Validation", tooltip: "Coming soon" },
];

export default function QualityPage() {
  const [location, setLocation] = useLocation();
  // useRoute("/quality/:tab") doesn't match three-segment paths like /quality/labeling/artwork
  // because wouter's :param stops at "/". Extract the tab segment directly from location instead.
  const tabParam = location.split("/")[2] as string | undefined;

  const validTabs: QualityTab[] = ["labeling", "sops", "complaints", "returns", "oos", "component-specifications", "fg-specifications"];

  useEffect(() => {
    if (!tabParam || !validTabs.includes(tabParam as QualityTab)) {
      setLocation("/quality/labeling", { replace: true });
    }
  }, [tabParam, setLocation]);

  const activeTab: QualityTab =
    tabParam === "sops" ? "sops"
    : tabParam === "complaints" ? "complaints"
    : tabParam === "returns" ? "returns"
    : tabParam === "oos" ? "oos"
    : tabParam === "component-specifications" ? "component-specifications"
    : tabParam === "fg-specifications" ? "fg-specifications"
    : "labeling";

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Quality</h1>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setLocation(`/quality/${v}`)}>
        <TabsList>
          {ACTIVE_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} data-testid={`tab-quality-${t.value}`}>
              {t.label}
            </TabsTrigger>
          ))}
          {DISABLED_TABS.map((t) => (
            <Tooltip key={t.value}>
              <TooltipTrigger asChild>
                <span>
                  <TabsTrigger value={t.value} disabled data-testid={`tab-quality-${t.value}`} className="cursor-not-allowed opacity-40">
                    {t.label}
                  </TabsTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t.tooltip}</TooltipContent>
            </Tooltip>
          ))}
        </TabsList>
      </Tabs>

      {activeTab === "labeling" && <LabelingPage />}
      {activeTab === "sops" && <SopsPage />}
      {activeTab === "complaints" && <ComplaintsPage />}
      {activeTab === "returns" && <ReturnsPage />}
      {activeTab === "oos" && <OosInvestigations />}
      {activeTab === "component-specifications" && <ComponentSpecifications />}
      {activeTab === "fg-specifications" && <FinishedGoodsSpecifications />}
    </div>
  );
}
