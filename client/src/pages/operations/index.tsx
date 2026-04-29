import { useEffect } from "react";
import { useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Production from "@/pages/production";
import EquipmentPage from "@/pages/equipment";

type OperationsTab = "production" | "equipment";

const TABS: { value: OperationsTab; label: string }[] = [
  { value: "production", label: "Production" },
  { value: "equipment", label: "Equipment" },
];

export default function OperationsPage() {
  const [location, setLocation] = useLocation();
  const tabParam = location.split("/")[2] as string | undefined;

  const validTabs: OperationsTab[] = ["production", "equipment"];

  useEffect(() => {
    if (!tabParam || !validTabs.includes(tabParam as OperationsTab)) {
      setLocation("/operations/production", { replace: true });
    }
  }, [tabParam, setLocation]);

  const activeTab: OperationsTab =
    tabParam === "equipment" ? "equipment" : "production";

  return (
    <div>
      <div className="px-6 pt-4 pb-0">
        <Tabs value={activeTab} onValueChange={(v) => setLocation(`/operations/${v}`)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} data-testid={`tab-operations-${t.value}`}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {activeTab === "production" && <Production />}
      {activeTab === "equipment" && <EquipmentPage />}
    </div>
  );
}
