import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { SignatureCeremony } from "@/components/SignatureCeremony";

interface ReturnedProduct {
  id: string;
  returnRef: string;
  source: string;
  lotId: string | null;
  lotCodeRaw: string;
  qtyReturned: number;
  uom: string;
  wholesaleCustomerName: string | null;
  carrierTrackingRef: string | null;
  conditionNotes: string | null;
  status: "QUARANTINE" | "DISPOSED";
  disposition: string | null;
  dispositionNotes: string | null;
  dispositionedAt: string | null;
  investigationTriggered: boolean;
  receivedAt: string;
}

interface ReturnInvestigation {
  id: string;
  status: "OPEN" | "CLOSED";
}

const SOURCE_LABELS: Record<string, string> = {
  AMAZON_FBA: "Amazon FBA",
  WHOLESALE: "Wholesale",
  OTHER: "Other",
};

export default function ReturnDetail() {
  const [, params] = useRoute<{ id: string }>("/quality/returns/:id");
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const id = params?.id ?? "";

  const { data: rp, isLoading } = useQuery<ReturnedProduct>({
    queryKey: [`/api/returned-products/${id}`],
    queryFn: () => apiRequest("GET", `/api/returned-products/${id}`).then(r => r.json()),
    enabled: !!id,
  });

  const { data: investigations = [] } = useQuery<ReturnInvestigation[]>({
    queryKey: [`/api/return-investigations`, id],
    queryFn: () => apiRequest("GET", `/api/return-investigations?lotId=${rp?.lotId ?? ""}`).then(r => r.json()),
    enabled: !!rp?.lotId,
  });

  const openInvestigation = investigations.find(i => i.status === "OPEN");

  const [dispositionForm, setDispositionForm] = useState({ disposition: "DESTROY" as "DESTROY" | "RETURN_TO_INVENTORY", dispositionNotes: "" });
  const [showCeremony, setShowCeremony] = useState(false);

  const dispositionMutation = useMutation({
    mutationFn: (password: string) =>
      apiRequest("POST", `/api/returned-products/${id}/disposition`, { ...dispositionForm, password }).then(r => r.json()),
    onSuccess: () => {
      setShowCeremony(false);
      void qc.invalidateQueries({ queryKey: [`/api/returned-products/${id}`] });
    },
  });

  if (isLoading || !rp) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/quality/returns")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to returns
        </Button>
        <h1 className="text-xl font-semibold">{rp.returnRef}</h1>
        {rp.status === "QUARANTINE"
          ? <Badge className="bg-amber-500/20 text-amber-300 border-0">Quarantine</Badge>
          : rp.disposition === "DESTROY"
            ? <Badge className="bg-destructive/20 text-destructive border-0">Destroyed</Badge>
            : <Badge className="bg-green-500/20 text-green-300 border-0">Returned to inventory</Badge>
        }
      </div>

      {openInvestigation && (
        <div className="flex items-center gap-2 p-3 rounded-md border border-amber-500/30 bg-amber-500/10 text-sm text-amber-300">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          This lot has an open return investigation.
          <Button size="sm" variant="ghost" className="ml-auto text-xs" onClick={() => navigate("/quality/return-investigations")}>
            View investigation
          </Button>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">Return details</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          <div><span className="text-muted-foreground">Source:</span> {SOURCE_LABELS[rp.source] ?? rp.source}</div>
          <div><span className="text-muted-foreground">Lot code (raw):</span> {rp.lotCodeRaw}</div>
          <div><span className="text-muted-foreground">Quantity:</span> {rp.qtyReturned} {rp.uom}</div>
          <div><span className="text-muted-foreground">Received:</span> {new Date(rp.receivedAt).toLocaleString()}</div>
          {rp.wholesaleCustomerName && <div><span className="text-muted-foreground">Customer:</span> {rp.wholesaleCustomerName}</div>}
          {rp.carrierTrackingRef && <div><span className="text-muted-foreground">Tracking ref:</span> {rp.carrierTrackingRef}</div>}
          {rp.conditionNotes && <div><span className="text-muted-foreground">Condition notes:</span> {rp.conditionNotes}</div>}
        </CardContent>
      </Card>

      {rp.status === "QUARANTINE" && (
        <Card>
          <CardHeader><CardTitle className="text-sm">QA Disposition</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-4">
              {(["DESTROY", "RETURN_TO_INVENTORY"] as const).map((d) => (
                <label key={d} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="disposition"
                    checked={dispositionForm.disposition === d}
                    onChange={() => setDispositionForm(f => ({ ...f, disposition: d }))}
                  />
                  {d === "DESTROY" ? "Destroy" : "Return to inventory"}
                </label>
              ))}
            </div>
            <div>
              <Label className="text-xs">Disposition notes (optional)</Label>
              <Textarea rows={2} value={dispositionForm.dispositionNotes} onChange={e => setDispositionForm(f => ({ ...f, dispositionNotes: e.target.value }))} />
            </div>
            <Button size="sm" onClick={() => setShowCeremony(true)}>
              Sign disposition (F-04)
            </Button>
          </CardContent>
        </Card>
      )}

      {rp.status === "DISPOSED" && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Disposition record</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div><span className="text-muted-foreground">Decision:</span> {rp.disposition === "DESTROY" ? "Destroy" : "Return to inventory"}</div>
            <div><span className="text-muted-foreground">Signed at:</span> {rp.dispositionedAt ? new Date(rp.dispositionedAt).toLocaleString() : "—"}</div>
            {rp.dispositionNotes && <div><span className="text-muted-foreground">Notes:</span> {rp.dispositionNotes}</div>}
          </CardContent>
        </Card>
      )}

      <SignatureCeremony
        open={showCeremony}
        onOpenChange={setShowCeremony}
        entityDescription={`Return ${rp.returnRef} — disposition: ${dispositionForm.disposition === "DESTROY" ? "Destroy" : "Return to inventory"}`}
        meaning="RETURNED_PRODUCT_DISPOSITION"
        isPending={dispositionMutation.isPending}
        onSign={async (password) => { dispositionMutation.mutate(password); }}
      />
    </div>
  );
}
