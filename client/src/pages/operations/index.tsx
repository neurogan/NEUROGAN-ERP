import { useEffect } from "react";
import { useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Production from "@/pages/production";
import EquipmentPage from "@/pages/equipment";

type ManufacturingTab = "production-batches" | "mmr" | "equipment";

const TABS: { value: ManufacturingTab; label: string }[] = [
  { value: "production-batches", label: "Production Batches" },
  { value: "mmr", label: "Master Manufacturing Records" },
  { value: "equipment", label: "Equipment" },
];

function MmrPlaceholder() {
  return (
    <div className="px-6 pt-8 text-sm text-muted-foreground">
      Master Manufacturing Records — coming in R-07.
    </div>
  );
}

export default function ManufacturingPage() {
  const [location, setLocation] = useLocation();
  const tabParam = location.split("/")[2] as string | undefined;

  const validTabs: ManufacturingTab[] = ["production-batches", "mmr", "equipment"];

  useEffect(() => {
    if (!tabParam || !validTabs.includes(tabParam as ManufacturingTab)) {
      setLocation("/operations/production-batches", { replace: true });
    }
  }, [tabParam, setLocation]);

  const activeTab: ManufacturingTab =
    tabParam === "mmr" ? "mmr"
    : tabParam === "equipment" ? "equipment"
    : "production-batches";

  return (
    <div>
      <div className="px-6 pt-4 pb-0">
        <Tabs value={activeTab} onValueChange={(v) => setLocation(`/operations/${v}`)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} data-testid={`tab-manufacturing-${t.value}`}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {activeTab === "production-batches" && <Production />}
      {activeTab === "mmr" && <MmrPlaceholder />}
      {activeTab === "equipment" && <EquipmentPage />}
    </div>
  );
}
