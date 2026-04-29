import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ReturnedProduct {
  id: string;
  returnRef: string;
  source: string;
  lotId: string | null;
  lotCodeRaw: string;
  qtyReturned: number;
  uom: string;
  status: "QUARANTINE" | "DISPOSED";
  disposition: string | null;
  receivedAt: string;
}

const SOURCE_LABELS: Record<string, string> = {
  AMAZON_FBA: "Amazon FBA",
  WHOLESALE: "Wholesale",
  OTHER: "Other",
};

export default function ReturnsPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const { data: returns = [], isLoading } = useQuery<ReturnedProduct[]>({
    queryKey: ["/api/returned-products", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const res = await apiRequest("GET", `/api/returned-products?${params}`);
      return res.json();
    },
  });

  const [form, setForm] = useState({
    source: "AMAZON_FBA" as string,
    lotCodeRaw: "",
    qtyReturned: "",
    uom: "UNITS",
    wholesaleCustomerName: "",
    carrierTrackingRef: "",
    conditionNotes: "",
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/returned-products", {
      source: form.source,
      lotCodeRaw: form.lotCodeRaw,
      qtyReturned: parseInt(form.qtyReturned, 10),
      uom: form.uom,
      wholesaleCustomerName: form.wholesaleCustomerName || undefined,
      carrierTrackingRef: form.carrierTrackingRef || undefined,
      conditionNotes: form.conditionNotes || undefined,
      receivedAt: new Date().toISOString(),
    }).then(r => r.json()),
    onSuccess: () => {
      setShowModal(false);
      setForm({ source: "AMAZON_FBA", lotCodeRaw: "", qtyReturned: "", uom: "UNITS", wholesaleCustomerName: "", carrierTrackingRef: "", conditionNotes: "" });
      void qc.invalidateQueries({ queryKey: ["/api/returned-products"] });
    },
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(["", "QUARANTINE", "DISPOSED"] as const).map((s) => (
            <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)}>
              {s === "" ? "All" : s === "QUARANTINE" ? "Quarantine" : "Disposed"}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate("/quality/return-investigations")}>
            Investigations
          </Button>
          <Button size="sm" onClick={() => setShowModal(true)}>Log return</Button>
        </div>
      </div>

      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Ref</th>
              <th className="text-left p-3 font-medium">Source</th>
              <th className="text-left p-3 font-medium">Lot</th>
              <th className="text-left p-3 font-medium">Qty</th>
              <th className="text-left p-3 font-medium">Received</th>
              <th className="text-left p-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {returns.length === 0 && (
              <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No returns found.</td></tr>
            )}
            {returns.map((r) => (
              <tr key={r.id} className="border-t cursor-pointer hover:bg-muted/30" onClick={() => navigate(`/quality/returns/${r.id}`)}>
                <td className="p-3 font-mono text-xs">{r.returnRef}</td>
                <td className="p-3">{SOURCE_LABELS[r.source] ?? r.source}</td>
                <td className="p-3 text-xs">{r.lotCodeRaw}</td>
                <td className="p-3">{r.qtyReturned} {r.uom}</td>
                <td className="p-3 text-xs">{new Date(r.receivedAt).toLocaleDateString()}</td>
                <td className="p-3">
                  {r.status === "QUARANTINE"
                    ? <Badge className="bg-amber-500/20 text-amber-300 border-0">Quarantine</Badge>
                    : r.disposition === "DESTROY"
                      ? <Badge className="bg-destructive/20 text-destructive border-0">Destroyed</Badge>
                      : <Badge className="bg-green-500/20 text-green-300 border-0">Returned to inventory</Badge>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Log return</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Source</Label>
              <Select value={form.source} onValueChange={(v) => setForm(f => ({ ...f, source: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AMAZON_FBA">Amazon FBA</SelectItem>
                  <SelectItem value="WHOLESALE">Wholesale</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Lot code (on box)</Label>
              <Input value={form.lotCodeRaw} onChange={e => setForm(f => ({ ...f, lotCodeRaw: e.target.value }))} placeholder="e.g. LOT-20240101-001" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Qty returned</Label>
                <Input type="number" value={form.qtyReturned} onChange={e => setForm(f => ({ ...f, qtyReturned: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">UOM</Label>
                <Input value={form.uom} onChange={e => setForm(f => ({ ...f, uom: e.target.value }))} />
              </div>
            </div>
            {form.source === "WHOLESALE" && (
              <div>
                <Label className="text-xs">Wholesale customer name</Label>
                <Input value={form.wholesaleCustomerName} onChange={e => setForm(f => ({ ...f, wholesaleCustomerName: e.target.value }))} />
              </div>
            )}
            <div>
              <Label className="text-xs">Carrier / Amazon tracking ref (optional)</Label>
              <Input value={form.carrierTrackingRef} onChange={e => setForm(f => ({ ...f, carrierTrackingRef: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Condition notes</Label>
              <Textarea rows={2} value={form.conditionNotes} onChange={e => setForm(f => ({ ...f, conditionNotes: e.target.value }))} placeholder="Seal intact? Damage? Labels correct?" />
            </div>
            <Button
              className="w-full"
              onClick={() => createMutation.mutate()}
              disabled={!form.lotCodeRaw || parseInt(form.qtyReturned, 10) <= 0 || isNaN(parseInt(form.qtyReturned, 10)) || createMutation.isPending}
            >
              {createMutation.isPending ? "Logging…" : "Log return"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
