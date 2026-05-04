import { useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ArtworkTab from "./labeling/artwork";
import SpoolsTab from "./labeling/spools";
import ReconciliationQueueTab from "./labeling/reconciliation-queue";

type LabelingTab = "artwork" | "spools" | "reconciliation";

const TABS: { value: LabelingTab; label: string }[] = [
  { value: "artwork", label: "Artwork" },
  { value: "spools", label: "Spools" },
  { value: "reconciliation", label: "Reconciliation Queue" },
];

export default function LabelingPage() {
  const [, params] = useRoute<{ subtab?: string }>("/quality/labeling/:subtab");
  const [, setLocation] = useLocation();
  const subtabParam = params?.subtab;

  useEffect(() => {
    if (!subtabParam || !["artwork", "spools", "reconciliation"].includes(subtabParam)) {
      setLocation("/quality/labeling/artwork", { replace: true });
    }
  }, [subtabParam, setLocation]);

  const activeTab: LabelingTab =
    subtabParam === "spools" ? "spools"
    : subtabParam === "reconciliation" ? "reconciliation"
    : "artwork";

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={(v) => setLocation(`/quality/labeling/${v}`)}>
        <TabsList data-tour="labeling-tabs">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} data-testid={`tab-labeling-${t.value}`}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {activeTab === "artwork" && <ArtworkTab />}
      {activeTab === "spools" && <SpoolsTab />}
      {activeTab === "reconciliation" && <ReconciliationQueueTab />}
    </div>
  );
}
