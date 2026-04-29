import { useEffect } from "react";
import { useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SuppliersTab from "@/pages/suppliers-tab";
import Receiving from "@/pages/receiving";

type ProcurementTab = "purchasing" | "receiving";

const TABS: { value: ProcurementTab; label: string }[] = [
  { value: "purchasing", label: "Purchasing" },
  { value: "receiving", label: "Receiving" },
];

export default function ProcurementPage() {
  const [location, setLocation] = useLocation();
  const tabParam = location.split("/")[2] as string | undefined;

  const validTabs: ProcurementTab[] = ["purchasing", "receiving"];

  useEffect(() => {
    if (!tabParam || !validTabs.includes(tabParam as ProcurementTab)) {
      setLocation("/procurement/purchasing", { replace: true });
    }
  }, [tabParam, setLocation]);

  const activeTab: ProcurementTab =
    tabParam === "receiving" ? "receiving" : "purchasing";

  return (
    <div>
      <div className="px-6 pt-4 pb-0">
        <Tabs value={activeTab} onValueChange={(v) => setLocation(`/procurement/${v}`)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} data-testid={`tab-procurement-${t.value}`}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {activeTab === "purchasing" && <SuppliersTab />}
      {activeTab === "receiving" && <Receiving />}
    </div>
  );
}
