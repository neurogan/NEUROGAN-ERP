import { useEffect } from "react";
import { useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PurchaseOrders from "@/pages/purchase-orders";
import { SuppliersContent } from "@/pages/suppliers-tab";
import Receiving from "@/pages/receiving";

type ProcurementTab = "purchase-orders" | "suppliers" | "receiving";

const TABS: { value: ProcurementTab; label: string }[] = [
  { value: "purchase-orders", label: "Purchase Orders" },
  { value: "suppliers", label: "Suppliers" },
  { value: "receiving", label: "Receiving" },
];

export default function ProcurementPage() {
  const [location, setLocation] = useLocation();
  const tabParam = location.split("/")[2] as string | undefined;

  const validTabs: ProcurementTab[] = ["purchase-orders", "suppliers", "receiving"];

  useEffect(() => {
    if (!tabParam || !validTabs.includes(tabParam as ProcurementTab)) {
      setLocation("/procurement/purchase-orders", { replace: true });
    }
  }, [tabParam, setLocation]);

  const activeTab: ProcurementTab =
    tabParam === "suppliers" ? "suppliers"
    : tabParam === "receiving" ? "receiving"
    : "purchase-orders";

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
      {activeTab === "purchase-orders" && <PurchaseOrders />}
      {activeTab === "suppliers" && <SuppliersContent />}
      {activeTab === "receiving" && <Receiving />}
    </div>
  );
}
