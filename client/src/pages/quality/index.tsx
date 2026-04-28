import { useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import LabelingPage from "./labeling";
import SopsPage from "./sops";

type QualityTab = "labeling" | "sops";

const ACTIVE_TABS: { value: QualityTab; label: string }[] = [
  { value: "labeling", label: "Labeling" },
  { value: "sops", label: "SOPs" },
];

const DISABLED_TABS: { value: string; label: string; tooltip: string }[] = [
  { value: "complaints", label: "Complaints", tooltip: "Coming in R-05" },
  { value: "returns", label: "Returns", tooltip: "Coming in R-05" },
  { value: "validation", label: "Validation", tooltip: "Coming in R-06" },
];

export default function QualityPage() {
  const [, params] = useRoute<{ tab?: string }>("/quality/:tab");
  const [, setLocation] = useLocation();
  const tabParam = params?.tab;

  useEffect(() => {
    if (!tabParam || (tabParam !== "labeling" && tabParam !== "sops")) {
      setLocation("/quality/labeling", { replace: true });
    }
  }, [tabParam, setLocation]);

  const activeTab: QualityTab =
    tabParam === "sops" ? "sops" : "labeling";

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Quality</h1>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setLocation(`/quality/${v}`)}
      >
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
                  <TabsTrigger
                    value={t.value}
                    disabled
                    data-testid={`tab-quality-${t.value}`}
                    className="cursor-not-allowed opacity-40"
                  >
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
    </div>
  );
}
